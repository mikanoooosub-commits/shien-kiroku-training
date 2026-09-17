import { z } from "zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { CATEGORY_META, MonitoringDraftSchema, MonitoringGoalInputSchema, type SavedRecord } from "../../record";
import { createClient } from "../../supabase-server";
import { getMyFacility } from "../../facility";
import { loadRecordsForChild } from "../../records";

export const runtime = "nodejs";

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で指定してください。");

const RequestSchema = z
  .object({
    childId: z.string().trim().min(1, "対象児童を指定してください。"),
    dateFrom: DateStringSchema,
    dateTo: DateStringSchema,
    goals: z.array(MonitoringGoalInputSchema).min(1, "支援目標を1件以上入力してください。").max(20),
  })
  .refine((v) => v.dateFrom <= v.dateTo, {
    message: "開始日は終了日以前にしてください。",
    path: ["dateFrom"],
  });

const MONITORING_SYSTEM_PROMPT = `あなたは放課後等デイサービス(障害児通所支援)の児童発達支援管理責任者が作成する「個別支援計画モニタリング」の下書きを、蓄積された支援記録から作成するアシスタントです。

厳守事項:
- 日付付きで渡される時系列の記録データに実際に書かれている情報のみを使い、書かれていないことを創作・推測で補わないこと。
- 支援目標ごとの評価は「達成した/できていない」のような二値評価にせず、記録から引用できる具体的なエピソードや回数を示す、客観的な事実の記述にすること。
- 根拠にできる記録が一つも見つからない項目は、無理に何か書かず「該当する記録なし」とだけ書くこと。
- 保護者・本人との面接の実施状況や、個別支援計画の変更の要否についての判断は、この下書きの対象外である。それらについて一切言及しないこと(職員が別途記入する)。
- 児童や保護者を傷つけるような表現・断定的な診断的表現は避け、事実に基づいた記述にすること。
- 文体は、記録の文体に関わらず、必ず「ですます調」に統一して書くこと。`;

/** 記録を日付順の「YYYY-MM-DD 項目名: 内容 / 項目名: 内容」形式のテキストへ整形する(空文字項目は省略)。 */
function buildTranscript(records: SavedRecord[]): string {
  const lines = records
    .map((entry) => {
      const parts = CATEGORY_META.map((m) => {
        const value = entry.record[m.key].trim();
        return value ? `${m.label}: ${value}` : null;
      }).filter((v): v is string => v !== null);
      return parts.length > 0 ? `${entry.recordDate} ${parts.join(" / ")}` : null;
    })
    .filter((line): line is string => line !== null);
  return lines.join("\n");
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
  const { childId, dateFrom, dateTo, goals } = parsedRequest.data;

  const supabase = await createClient();
  const facilityResult = await getMyFacility(supabase);
  if (!facilityResult.ok) {
    return Response.json({ error: facilityResult.reason }, { status: 500 });
  }
  if (!facilityResult.value) {
    return Response.json({ error: "施設に所属していません。" }, { status: 400 });
  }

  const recordsResult = await loadRecordsForChild(supabase, facilityResult.value.id, childId, dateFrom, dateTo);
  if (!recordsResult.ok) {
    return Response.json({ error: recordsResult.reason }, { status: 500 });
  }

  const transcript = buildTranscript(recordsResult.value);
  const goalsText = goals.map((g, i) => `${i + 1}. [${g.category}] ${g.text}`).join("\n");
  const userMessage = `# 支援目標一覧\n${goalsText}\n\n# 時系列の記録データ(${dateFrom}〜${dateTo})\n${
    transcript || "(この期間の記録はありません)"
  }`;

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.responses.parse({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: MONITORING_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      text: { format: zodTextFormat(MonitoringDraftSchema, "monitoring_draft") },
    });

    const parsed = response.output_parsed;
    if (!parsed) {
      return Response.json({ error: "AIの応答を解析できませんでした。もう一度お試しください。" }, { status: 502 });
    }
    if (parsed.goalEvaluations.length !== goals.length) {
      return Response.json(
        { error: "AIの出力が目標数と一致しませんでした。もう一度お試しください。" },
        { status: 502 }
      );
    }

    return Response.json({ draft: parsed });
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
