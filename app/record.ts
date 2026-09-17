import { z } from "zod";

/**
 * 支援記録の構造化スキーマ。
 * サーバー(OpenAIへ渡すJSON Schema)・クライアント(表示/保存)の双方がここを唯一の定義として参照する。
 * 各 .describe() はそのまま JSON Schema に載り、項目ごとの指示としてモデルに届く。
 */
export const RecordSchema = z.object({
  attendance: z
    .string()
    .describe(
      "出欠・入退室(登所・退所時刻、欠席・遅刻・早退、送迎の授受)に関する下書き文。該当する記述がなければ空文字。"
    ),
  health: z
    .string()
    .describe(
      "健康面(検温、体調、食欲、睡眠、服薬、通院等)に関する下書き文。該当する記述がなければ空文字。" +
        "今回のメモ本文に書かれている内容のみを過不足なく書くこと(直近の記録との比較は、この分類とは別の処理で後から付け足される)。"
    ),
  activity: z
    .string()
    .describe("その日行った活動・プログラムの内容に関する下書き文。該当する記述がなければ空文字。"),
  incident: z
    .string()
    .describe(
      "特記事項。事故・ヒヤリハット・トラブル・けが等に関する下書き文。該当する記述がなければ空文字。"
    ),
  contact: z
    .string()
    .describe(
      "【宛先が保護者・家族】の連絡・お願い事項に関する下書き文。持ち物の依頼、面談日程の確認依頼など。該当する記述がなければ空文字。"
    ),
  handover: z
    .string()
    .describe(
      "【宛先が施設内の他の職員】(次の担当者・遅番のスタッフ等)への引き継ぎ・申し送り事項に関する下書き文。該当する記述がなければ空文字。"
    ),
  uncertainNotes: z
    .array(z.string())
    .describe(
      "どの項目に分類すべきか自信が持てなかった、または複数の項目にまたがって判断が難しかった原文の抜粋一覧。無理に振り分けず、ここに残すこと。"
    ),
});

export type StructuredRecord = z.infer<typeof RecordSchema>;

/** uncertainNotes を除いた、画面に6つ並ぶ記入項目のキー。 */
export type CategoryKey = Exclude<keyof StructuredRecord, "uncertainNotes">;

export const CATEGORY_META: { key: CategoryKey; label: string }[] = [
  { key: "attendance", label: "出欠・入退室" },
  { key: "health", label: "健康面" },
  { key: "activity", label: "活動内容" },
  { key: "incident", label: "特記事項(事故・ヒヤリハット)" },
  { key: "contact", label: "連絡事項" },
  { key: "handover", label: "引き継ぎ" },
];

/** /api/structure のレスポンス。自前のAPIでもネットワークを跨ぐので、型注釈ではなく実際に検証する。 */
export const ApiResponseSchema = z.object({
  record: RecordSchema.optional(),
  error: z.string().optional(),
});

/**
 * 保存済み記録1件。
 * localStorage は利用者が編集できる領域なので、読み出し時に必ずこのスキーマで検証する。
 */
export const SavedRecordSchema = z.object({
  id: z.string().min(1),
  savedAt: z.string().min(1),
  label: z.string(),
  sourceText: z.string(),
  record: RecordSchema,
  /** 対象児童のID。未設定(古い記録・児童未選択)は null。 */
  childId: z.string().nullable(),
  /** 記録対象日(yyyy-mm-dd)。作成/更新日時(savedAt)とは別に、いつの出来事の記録かを表す。 */
  recordDate: z.string().min(1),
});

export type SavedRecord = z.infer<typeof SavedRecordSchema>;

/**
 * 個別支援計画モニタリング下書き生成(/api/monitoring)で使う型。
 * 個別支援計画そのものを保存する機能はまだ無いため、支援目標(計画の目標行)は
 * 下書きを生成するたびにここで入力してもらう(次回モニタリング時は同じ内容を再入力/コピペする運用)。
 */
export const MonitoringGoalInputSchema = z.object({
  category: z.string().trim().min(1).max(20),
  text: z.string().trim().min(1).max(300),
});

export type MonitoringGoalInput = z.infer<typeof MonitoringGoalInputSchema>;

/**
 * 支援目標ごとの評価は「目標1行=評価1行」で対応させる(事業所側の個別支援計画参考様式への転記しやすさのため)。
 * goalText はAIに入力の目標文をそのまま転記させる(順序・対応のズレをサーバー側で検知できるようにするため)。
 */
export const MonitoringDraftSchema = z.object({
  goalEvaluations: z.array(
    z.object({
      goalText: z.string().describe("入力された支援目標の文言をそのまま転記する(要約・言い換えしない)。"),
      evaluation: z
        .string()
        .describe(
          "この目標に関連する記録を時系列データの中から探し、日付付きのエピソードや回数を引用しながら実施状況を一段落で書く。" +
            "「達成した/できていない」のような二値の評価はせず、支援の実施状況を事実に基づいて記述すること。" +
            "記録にない事実を創作しないこと。文体はですます調に統一する。" +
            "この目標に関連する記述が期間中の記録に一つも見つからない場合は、他には何も書かず「該当する記録なし」とだけ書くこと。"
        ),
    })
  ),
  newIssues: z
    .string()
    .describe(
      "時系列データ全体を通じて、上記の支援目標には無いが新たに把握された課題があれば一段落で書く。" +
        "記録にない事実を創作しないこと。該当する記述が見つからなければ「該当する記録なし」とだけ書くこと。"
    ),
  nextProposal: z
    .string()
    .describe(
      "実施状況・新たな課題を踏まえ、次期(概ね6か月以内。1〜3か月の短期の提案も可)に向けた支援の方向性の提案を一段落で書く。" +
        "断定はせず提案の形で書くこと。根拠にできる記録が無い場合は「該当する記録なし」とだけ書くこと。"
    ),
});

export type MonitoringDraft = z.infer<typeof MonitoringDraftSchema>;

/** /api/monitoring のレスポンス。自前のAPIでもネットワークを跨ぐので、型注釈ではなく実際に検証する。 */
export const MonitoringApiResponseSchema = z.object({
  draft: MonitoringDraftSchema.optional(),
  error: z.string().optional(),
});
