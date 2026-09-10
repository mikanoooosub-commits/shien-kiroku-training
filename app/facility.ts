import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type Facility = { id: string; name: string };
export type FacilityResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type Client = SupabaseClient<Database>;

/**
 * ログインユーザーが所属する最初の施設を返す(所属していなければ null)。
 * 1ユーザーが複数施設に所属するケースはこのPoCの対象外(先頭の1件のみ扱う)。
 */
export async function getMyFacility(supabase: Client): Promise<FacilityResult<Facility | null>> {
  const { data: membership, error: membershipError } = await supabase
    .from("facility_members")
    .select("facility_id")
    .limit(1)
    .maybeSingle();
  if (membershipError) return { ok: false, reason: membershipError.message };
  if (!membership) return { ok: true, value: null };

  const { data: facility, error: facilityError } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", membership.facility_id)
    .single();
  if (facilityError) return { ok: false, reason: facilityError.message };
  return { ok: true, value: facility };
}

/**
 * 施設を新規作成する。DB側のトリガー(`handle_new_facility`)が作成者を owner として自動的にメンバーへ加える。
 *
 * ここで `.select()` を付けない(= RETURNING を要求しない)のが重要。
 * RETURNING はSELECTポリシー `is_facility_member(id)` で可視性を判定されるが、
 * メンバー登録は AFTER INSERT トリガーで文の終わりに実行されるため、
 * RETURNING の時点ではまだメンバーではなく「自分が今作った行が見えない」判定になり、
 * `new row violates row-level security policy` で失敗する(docs/issue-log.md ISSUE-003)。
 * 作成後に改めて getMyFacility() で取り直す。
 */
export async function createFacility(supabase: Client, name: string): Promise<FacilityResult<Facility>> {
  const { error } = await supabase.from("facilities").insert({ name });
  if (error) return { ok: false, reason: error.message };

  const created = await getMyFacility(supabase);
  if (!created.ok) return created;
  if (!created.value) {
    return { ok: false, reason: "施設を作成しましたが、読み出しに失敗しました。画面を再読み込みしてください。" };
  }
  return { ok: true, value: created.value };
}

/** メールアドレスで既存ユーザーを施設に招待する(先にサインアップ済みである必要がある)。 */
export async function inviteMember(
  supabase: Client,
  facilityId: string,
  email: string
): Promise<FacilityResult<null>> {
  const { error } = await supabase.rpc("invite_to_facility", {
    target_facility_id: facilityId,
    invitee_email: email,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, value: null };
}
