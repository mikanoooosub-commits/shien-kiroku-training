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
  /** 同じ児童の直近の記録(健康面)。参照オプションがOFF、または直近記録が無ければ null/未指定。 */
  previousHealthNote: z
    .object({ recordDate: z.string().min(1), health: z.string() })
    .nullable()
    .optional(),
});

const SYSTEM_PROMPT = `あなたは放課後等デイサービス(障害児通所支援)の職員が書いた1日の活動記録メモを、6つの項目に振り分けて下書きを作成するアシスタントです。

厳守事項:
- メモに実際に書かれている情報のみを使い、書かれていないことを創作・推測で補わないこと。
- 該当する記述が一つもない項目は、空文字を返すこと(無理に何か書かない)。
- どの項目に分類すべきか自信が持てない文、または複数の項目にまたがって判断が難しい文があれば、無理に振り分けずその原文を uncertainNotes に入れること。
- 事故・ヒヤリハット・トラブル・けが・かみつき・パニック等、安全に関わる語を含む文は、その日の活動の一部として語られていても、必ず incident 欄にも含めること。activity 等の他の項目と内容が重複してもよい(安全に関わる記述を見落とさないことを最優先する)。
- contact と handover は「誰に伝える内容か」で分けること。保護者・家族に伝えるなら contact、施設内の他の職員(次の担当者・遅番のスタッフ等)に伝えるなら handover。どちらも「〜してください」という依頼の形になるが、形ではなく宛先で判断する。
- 依頼形の文が続けて書かれていても、まとめて同じ項目に入れないこと。文ごとに宛先を見て振り分ける。
- 児童や保護者を傷つけるような表現・断定的な診断的表現は避け、事実に基づいた記述にすること。`;

/**
 * 健康面の「直近の記録との関連」の一言だけを書く、専用の小さいスキーマ・プロンプト。
 * 6項目の分類プロンプトに混ぜて1回で済ませようとすると、他の指示に埋もれてほぼ発火しない
 * (実測: gpt-4o-mini で明確な発熱→回復の例でも4回中3回は何も書き足さなかった)ため、
 * 「前回と今回を比べて一言書く」だけを仕事にする専用の呼び出しに分離する。
 * 呼び出しが1つ増える分のコスト・遅延は、参考情報がある(=直近記録が存在する)場合のみ発生する。
 */
const ContinuityNoteSchema = z.object({
  note: z
    .string()
    .describe(
      "前回と今回の健康面の記述を比べ、話題が同じ(体温・食欲・睡眠等)で具体的な関連が読み取れれば、" +
        "「前回は〜、今回は〜」という事実の並びで一文書く。断定的な評価語(悪化した/改善した/治った/良くなった等)は使わないこと。" +
        "話題が無関係なら空文字にすること。文体は「ですます調」で統一すること(記録本文の続きに付け足すため、体言止めや「である」調は使わない)。"
    ),
});

const CONTINUITY_SYSTEM_PROMPT = `あなたは、支援記録の「健康面」欄について、前回と今回の記述を比較する専門の補助係です。
今回の記述そのものは書き直さず、前回との関連が読み取れる場合にだけ、それを一文で書き添えるのがあなたの唯一の仕事です。
前回の記述に無い事実を作らない。今回の記述にある事実を否定・弱化しない。断定的な評価語(悪化した/改善した/治った/良くなった等)は使わず、数値や事実だけを並べる。
文体は必ず「ですます調」で書くこと。付け足す先の記録本文はですます調で書かれているため、である調・体言止めが混ざると読み手に違和感を与える。`;

/** 今回のhealthと前回のhealthを比較し、関連があれば短い一言を返す(無ければ空文字)。失敗時も空文字(呼び出し全体は失敗させない)。 */
async function buildContinuityNote(
  client: OpenAI,
  todayHealth: string,
  previousHealthNote: { recordDate: string; health: string }
): Promise<string> {
  if (!todayHealth.trim() || !previousHealthNote.health.trim()) return "";
  try {
    const response = await client.responses.parse({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: CONTINUITY_SYSTEM_PROMPT },
        {
          role: "user",
          content: `前回(健康面): ${previousHealthNote.health}\n今回(健康面): ${todayHealth}`,
        },
      ],
      text: { format: zodTextFormat(ContinuityNoteSchema, "continuity_note") },
    });
    return response.output_parsed?.note.trim() ?? "";
  } catch (err) {
    console.error(err);
    return "";
  }
}

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

    const previousHealthNote = parsedRequest.data.previousHealthNote;
    if (previousHealthNote) {
      const note = await buildContinuityNote(client, parsed.health, previousHealthNote);
      if (note) parsed.health = `${parsed.health} ${note}`;
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
