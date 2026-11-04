import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// DBなし体験版(/demo)の合言葉のハッシュ。合言葉そのものは環境変数に置かず、
// scrypt のハッシュを1行にしたもの(DEMO_PASSWORD_HASH)だけを置く。
// つもる(ai-consulting-research / tsumoru-poc)の src/lib/password-hash.ts を移植。
// ・サーバー(app/demo-session.ts)と、ハッシュを作るスクリプト(scripts/hash-password.ts)の両方から使う。
//   そのため 'server-only' は付けない(Next.js の外の tsx からも読むため)。
// ・Node 標準の crypto.scrypt だけを使う(依存を増やさない)。
//
// 1行の形: scrypt:<N>:<r>:<p>:<ソルト base64url>:<ハッシュ base64url>
//   区切りに $ を使わないのは、Next.js が .env.local を読むときに $… を変数として展開してしまうため。
//
// 強さ: N=2^15・r=8・p=3(メモリ 32 MiB)。OWASP Password Storage Cheat Sheet の scrypt の最低ラインの1つ。

export const HASH_PREFIX = "scrypt";
export const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LEN = 32; // ハッシュの長さ(バイト)
const SALT_LEN = 16; // ソルトの長さ(バイト。Node のドキュメントの推奨「16バイト以上の乱数」)
export const PASSWORD_MIN = 12; // 合言葉の長さの下限。サーバーは合言葉の長さを知らないので、作るスクリプトで確かめる

// 読み込んでよいパラメータの範囲。壊れた値・大きすぎる値(サーバーが重くなる)は「未設定」と同じ扱い
const LIMITS = { NMin: 2 ** 14, NMax: 2 ** 17, rMin: 8, rMax: 16, pMin: 1, pMax: 8 };
const MAXMEM = 256 * 1024 * 1024;

export type ParsedHash = { N: number; r: number; p: number; salt: Buffer; hash: Buffer };

function scryptAsync(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { ...opts, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const isPow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
const intIn = (s: string, min: number, max: number) => /^\d{1,7}$/.test(s) && Number(s) >= min && Number(s) <= max;

// 1行を読む。形が違えば null(=誰も入れない)
export function parsePasswordHash(line: string): ParsedHash | null {
  const parts = line.split(":");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return null;
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!intIn(n, LIMITS.NMin, LIMITS.NMax) || !isPow2(Number(n))) return null;
  if (!intIn(r, LIMITS.rMin, LIMITS.rMax) || !intIn(p, LIMITS.pMin, LIMITS.pMax)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(saltB64) || !/^[A-Za-z0-9_-]+$/.test(hashB64)) return null;
  const salt = Buffer.from(saltB64, "base64url");
  const hash = Buffer.from(hashB64, "base64url");
  if (salt.length < SALT_LEN || hash.length !== KEY_LEN) return null;
  return { N: Number(n), r: Number(r), p: Number(p), salt, hash };
}

// 合言葉からハッシュの1行を作る(スクリプト用)。下限より短い合言葉は断る
export async function hashPassword(
  password: string,
  params: { N: number; r: number; p: number } = DEFAULT_PARAMS
): Promise<string> {
  if (password.length < PASSWORD_MIN) throw new Error(`合言葉は${PASSWORD_MIN}文字以上にしてください`);
  const salt = randomBytes(SALT_LEN);
  const hash = await scryptAsync(password, salt, params);
  return [HASH_PREFIX, params.N, params.r, params.p, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

// 入力をその1行のソルトとパラメータでハッシュにし、timingSafeEqual で比べる(長さは KEY_LEN で常に同じ)
export async function verifyPassword(input: string, parsed: ParsedHash): Promise<boolean> {
  const key = await scryptAsync(input, parsed.salt, { N: parsed.N, r: parsed.r, p: parsed.p });
  return timingSafeEqual(key, parsed.hash);
}
