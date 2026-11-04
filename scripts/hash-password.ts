// DBなし体験版の合言葉のハッシュ(DEMO_PASSWORD_HASH に入れる1行)を作る。
//   npx tsx scripts/hash-password.ts
// つもる(tsumoru-poc)の scripts/hash-password.ts を移植。
// ・合言葉は画面に出さずに入れる(打った字は表示しない)。確かめのため2回入れる。12文字未満は断る。
// ・出すのはハッシュの1行だけ。合言葉はファイルにもログにも残さない(引数・環境変数でも受け取らない=シェル履歴に残さない)。
import { hashPassword, PASSWORD_MIN } from "../app/demo-password-hash";

type RawInput = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => unknown };

// 1行を、打った字を表示せずに読む。Enter で終わり、Ctrl+C でやめる、Backspace で1字消す
export function readHidden(
  prompt: string,
  input: RawInput = process.stdin,
  output: NodeJS.WritableStream = process.stderr
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(
        new Error(
          "キー入力を1字ずつ受け取れない画面のため、合言葉を隠して入れられません。PowerShell か Windows Terminal で実行してください"
        )
      );
      return;
    }
    output.write(prompt);
    let value = "";
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    const finish = (err?: Error) => {
      input.setRawMode?.(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          return;
        }
        if (ch === "\u0003") {
          finish(new Error("やめました"));
          return;
        } // Ctrl+C
        if (ch === "\u007f" || ch === "\b") {
          value = [...value].slice(0, -1).join("");
          continue;
        } // Backspace
        if (ch < " ") continue; // ほかの制御文字は無視
        value += ch;
      }
    };
    input.on("data", onData);
  });
}

// 案内は stderr、ハッシュの1行だけを stdout に出す
export async function main(
  input: RawInput = process.stdin,
  info: NodeJS.WritableStream = process.stderr,
  out: NodeJS.WritableStream = process.stdout
) {
  const first = await readHidden(`合言葉(${PASSWORD_MIN}文字以上・画面には出ません): `, input, info);
  if (first.length < PASSWORD_MIN) throw new Error(`合言葉が短すぎます(${PASSWORD_MIN}文字以上にしてください)`);
  const second = await readHidden("もう一度(確かめ): ", input, info);
  if (first !== second) throw new Error("1回目と2回目が違います。もう一度やり直してください");
  const line = await hashPassword(first);
  info.write("DEMO_PASSWORD_HASH に入れる1行(この行だけをコピーする):\n");
  out.write(line + "\n"); // 出すのはハッシュの1行だけ
}

// tsx で直接動かしたときだけ実行する
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/hash-password.ts")) {
  main().catch((e: unknown) => {
    process.stderr.write(`中止: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
