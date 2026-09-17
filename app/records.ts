import type { SupabaseClient } from "@supabase/supabase-js";
import { SavedRecordSchema, type SavedRecord } from "./record";
import type { Database, Json } from "./database.types";

export type RecordsResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["records"]["Row"];

function rowToSavedRecord(row: Row): SavedRecord | null {
  const candidate = {
    id: row.id,
    savedAt: row.saved_at,
    label: row.label,
    sourceText: row.source_text,
    record: row.record,
    childId: row.child_id,
    recordDate: row.record_date,
  };
  // DBの内容も「壊れていない」保証はない(手動編集・アプリ更新途中など)ため、
  // localStorage時代と同じくzodで1件ずつ検証し、壊れたものは読み捨てる。
  const parsed = SavedRecordSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** 施設の記録一覧を新しい順で読み出す。RLSにより自分が所属する施設の分しか返らない。 */
export async function loadRecords(supabase: Client, facilityId: string): Promise<RecordsResult<SavedRecord[]>> {
  const { data, error } = await supabase
    .from("records")
    .select("id, facility_id, created_by, label, source_text, record, child_id, record_date, saved_at, updated_at")
    .eq("facility_id", facilityId)
    .order("saved_at", { ascending: false });

  if (error) return { ok: false, reason: error.message };
  const valid = (data ?? []).map(rowToSavedRecord).filter((r): r is SavedRecord => r !== null);
  return { ok: true, value: valid };
}

/**
 * 施設内の、特定の児童・期間の記録を記録対象日の昇順(時系列順)で読み出す。
 * RLSにより自分が所属する施設の分しか返らない。モニタリング下書き生成(/api/monitoring)で使う。
 */
export async function loadRecordsForChild(
  supabase: Client,
  facilityId: string,
  childId: string,
  dateFrom: string,
  dateTo: string
): Promise<RecordsResult<SavedRecord[]>> {
  const { data, error } = await supabase
    .from("records")
    .select("id, facility_id, created_by, label, source_text, record, child_id, record_date, saved_at, updated_at")
    .eq("facility_id", facilityId)
    .eq("child_id", childId)
    .gte("record_date", dateFrom)
    .lte("record_date", dateTo)
    .order("record_date", { ascending: true });

  if (error) return { ok: false, reason: error.message };
  const valid = (data ?? []).map(rowToSavedRecord).filter((r): r is SavedRecord => r !== null);
  return { ok: true, value: valid };
}

/** 1件を保存する(既存IDなら上書き)。 */
export async function saveRecord(
  supabase: Client,
  facilityId: string,
  entry: SavedRecord
): Promise<RecordsResult<null>> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("records").upsert(
    {
      id: entry.id,
      facility_id: facilityId,
      created_by: userData.user?.id ?? null,
      label: entry.label,
      source_text: entry.sourceText,
      record: entry.record as unknown as Json,
      child_id: entry.childId,
      record_date: entry.recordDate,
      saved_at: entry.savedAt,
    },
    { onConflict: "id" }
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true, value: null };
}

/** 1件削除する。 */
export async function deleteRecord(supabase: Client, id: string): Promise<RecordsResult<null>> {
  const { error } = await supabase.from("records").delete().eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, value: null };
}
