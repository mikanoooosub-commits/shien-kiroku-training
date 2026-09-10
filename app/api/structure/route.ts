import { z } from "zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { RecordSchema } from "../../record";

export const runtime = "nodejs";

const RequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "本文が空です。")
    .max(4000, "4000文字以内で入力してください。"),
});

const SYSTEM_PROMPT = `あなたは放課後等デイサービス(障害児通所支援)の職員が書いた1日の活動記録メモを、6つの項目に振り分けて下書きを作成するアシスタントです。

厳守事項:
- メモに実際に書かれている情報のみを使い、書かれていないことを創作・推測で補わないこと。
- 該当する記述が一つもない項目は、空文字を返すこと(無理に何か書かない)。
- どの項目に分類すべきか自信が持てない文、または複数の項目にまたがって判断が難しい文があれば、無理に振り分けずその原文を uncertainNotes に入れること。
- 事故・ヒヤリハット・トラブル・けが・かみつき・パニック等、安全に関わる語を含む文は、その日の活動の一部として語られていても、必ず incident 欄にも含めること。activity 等の他の項目と内容が重複してもよい(安全に関わる記述を見落とさないことを最優先する)。
- 児童や保護者を傷つけるような表現・断定的な診断的表現は避け、事実に基づいた記述にすること。`;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY が設定されていません。.env.local を確認してください。" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const parsedRequest = RequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return Response.json(
      { error: parsedRequest.error.issues[0]?.message ?? "入力内容を確認してください。" },
      { status: 400 }
    );
  }

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.responses.parse({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: parsedRequest.data.text },
      ],
      text: { format: zodTextFormat(RecordSchema, "shien_kiroku_record") },
    });

    const parsed = response.output_parsed;
    if (!parsed) {
      return Response.json({ error: "AIの応答を解析できませんでした。もう一度お試しください。" }, { status: 502 });
    }

    return Response.json({ record: parsed });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      const status = err.status ?? 502;
      const message =
        status === 401
          ? "OpenAI APIキーが無効です。.env.local の OPENAI_API_KEY を確認してください。"
          : status === 429
            ? "OpenAI APIのレート制限に達しました。しばらく待ってから再試行してください。"
            : `OpenAI APIエラー: ${err.message}`;
      return Response.json({ error: message }, { status });
    }
    console.error(err);
    return Response.json({ error: "予期しないエラーが発生しました。" }, { status: 500 });
  }
}
