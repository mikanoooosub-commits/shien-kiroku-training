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
      "健康面(検温、体調、食欲、睡眠、服薬、通院等)に関する下書き文。該当する記述がなければ空文字。"
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
