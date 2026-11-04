import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parsePasswordHash, verifyPassword, type ParsedHash } from "./demo-password-hash";

// DBなし体験版(/demo)の合言葉ログインの中心。画面・DB には触らない、計算だけの部品。
// つもる(tsumoru-poc)の src/lib/session.ts を移植し、デモモード限定で使う。
// proxy(proxy.ts)・ログイン画面(app/demo/login/*)・/api/structure から使う。
//
// ・合言葉のハッシュ DEMO_PASSWORD_HASH(scrypt)と署名の鍵 DEMO_SESSION_SECRET は、サーバーの環境変数だけに置く
//   (NEXT_PUBLIC_ を付けない=ブラウザに出ない)。合言葉そのものはどこにも置かない。
// ・どちらかが未設定・形が壊れている・鍵が短すぎるときは「誰も入れない」に倒す(fail-closed)。
// ・ログの中に合言葉・鍵・cookie の値は出さない。

export const DEMO_SESSION_COOKIE = "demo_session";
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 有効期限7日。開くたびの延長はしない
export const PASSWORD_INPUT_MAX = 200; // 入力の上限。超えたら比べずに「違います」
const SECRET_MIN = 32; // 鍵の長さの下限

/** DBなしデモモードか(Supabaseの公開環境変数が未設定ならデモモード)。 */
export function isDemoMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
}

// 環境変数の値。前後の空白・囲みの引用符は除く
function envValue(name: string): string {
  return process.env[name]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

export type AuthConfig = { ok: true; passwordHash: ParsedHash; secret: string } | { ok: false };

// 設定がそろっているか。そろっていなければ ok: false(=誰も入れない)
export function authConfig(): AuthConfig {
  const passwordHash = parsePasswordHash(envValue("DEMO_PASSWORD_HASH"));
  const secret = envValue("DEMO_SESSION_SECRET");
  if (!passwordHash || secret.length < SECRET_MIN) return { ok: false };
  return { ok: true, passwordHash, secret };
}

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body, "utf8").digest();

// 合言葉の照合。入力を保存されたソルトとパラメータで scrypt にかけ、timingSafeEqual で比べる
export async function passwordMatches(input: string, passwordHash: ParsedHash): Promise<boolean> {
  if (input.length === 0 || input.length > PASSWORD_INPUT_MAX) return false;
  return verifyPassword(input, passwordHash);
}

// ログイン状態の札(cookie の値)を作る。中身は「版.期限(ミリ秒).乱数」に HMAC-SHA256 の署名を付けたもの。
export function createSessionToken(secret: string, now = Date.now()): string {
  const exp = now + SESSION_MAX_AGE_SEC * 1000;
  const body = `v1.${exp}.${randomBytes(16).toString("base64url")}`;
  return `${body}.${sign(secret, body).toString("base64url")}`;
}

// 札を確かめる。署名が合い、期限内のときだけ true。形が違う・設定が無いときは必ず false(安全側)
export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  const cfg = authConfig();
  if (!cfg.ok || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !/^\d{1,16}$/.test(parts[1])) return false;
  const body = parts.slice(0, 3).join(".");
  const expected = sign(cfg.secret, body);
  const given = Buffer.from(parts[3], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const exp = Number(parts[1]);
  return exp > now && exp <= now + SESSION_MAX_AGE_SEC * 1000 + 60_000;
}

// ── 間違いが続いたときの抑え ──
// 15分のあいだに5回間違えたら、その IP は15分受け付けない。加えて、失敗のたびに約1秒待ってから返す(login 側)。
// 限界: 回数はこのサーバーのメモリにだけある(Vercelはサーバーを複数立て、使われないと止めるので共有されない)。本当の守りは長い合言葉。
export const FAIL_LIMIT = 5;
export const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const FAIL_DELAY_MS = 1000;
const MAX_TRACKED = 1000;

type FailEntry = { count: number; first: number; lockedUntil: number };
const failures = new Map<string, FailEntry>();

function prune(now: number) {
  for (const [ip, e] of failures) {
    if (e.lockedUntil <= now && now - e.first > FAIL_WINDOW_MS) failures.delete(ip);
  }
  while (failures.size > MAX_TRACKED) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

export function isLocked(ip: string, now = Date.now()): boolean {
  const e = failures.get(ip);
  return !!e && e.lockedUntil > now;
}

export function recordFailure(ip: string, now = Date.now()): boolean {
  prune(now);
  let e = failures.get(ip);
  if (!e || now - e.first > FAIL_WINDOW_MS) {
    e = { count: 0, first: now, lockedUntil: 0 };
    failures.set(ip, e);
  }
  e.count += 1;
  if (e.count >= FAIL_LIMIT) e.lockedUntil = now + LOCK_MS;
  return e.lockedUntil > now;
}

export function clearFailures(ip: string) {
  failures.delete(ip);
}
