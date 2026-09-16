import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** 児童マスタ1件。氏名・生年月日は持たない(仮名・ニックネームのみ、CLAUDE.mdのデータ取扱い方針)。 */
export type Child = { id: string; nickname: string; enrollmentYear: number };
export type ChildrenResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type Client = SupabaseClient<Database>;

/** 4月始まりの年度(その日が属する学校年度の西暦)を返す。 */
function schoolYearOf(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed: 3 = 4月
  return month >= 3 ? year : year - 1;
}

/**
 * 入学年度(小学校入学年度)から学年ラベルを算出する(学齢期=小1〜高3を想定)。
 * 生年月日は持たない設計のため、学年は保存せずこの関数で都度導出する。
 */
export function gradeLabel(enrollmentYear: number, asOf: Date = new Date()): string {
  const grade = schoolYearOf(asOf) - enrollmentYear + 1;
  if (grade < 1) return "就学前";
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  if (grade <= 12) return `高${grade - 9}`;
  return "高校卒業以降";
}

/**
 * 児童登録フォームで選べる学年の選択肢。value は gradeLabel の学年番号(就学前=0、小1〜高3=1〜12)。
 * 「小学校入学年度」を職員が暗算する代わりに、現在の学年を直接選んでもらうために使う。
 */
export const GRADE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "就学前" },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `小${n}` })),
  ...[1, 2, 3].map((n) => ({ value: n + 6, label: `中${n}` })),
  ...[1, 2, 3].map((n) => ({ value: n + 9, label: `高${n}` })),
];

/** gradeLabel の逆算。選択した学年(GRADE_OPTIONS の value)から、保存すべき入学年度を求める。 */
export function enrollmentYearForGrade(grade: number, asOf: Date = new Date()): number {
  return schoolYearOf(asOf) - grade + 1;
}

/** 施設の児童一覧をニックネーム順で読み出す。RLSにより自分が所属する施設の分しか返らない。 */
export async function listChildren(supabase: Client, facilityId: string): Promise<ChildrenResult<Child[]>> {
  const { data, error } = await supabase
    .from("children")
    .select("id, nickname, enrollment_year")
    .eq("facility_id", facilityId)
    .order("nickname", { ascending: true });

  if (error) return { ok: false, reason: error.message };
  const children = (data ?? []).map((row) => ({
    id: row.id,
    nickname: row.nickname,
    enrollmentYear: row.enrollment_year,
  }));
  return { ok: true, value: children };
}

/** 児童を1件登録する。ニックネーム・入学年度のみを持つ(実名・生年月日は持たない)。 */
export async function createChild(
  supabase: Client,
  facilityId: string,
  nickname: string,
  enrollmentYear: number
): Promise<ChildrenResult<Child>> {
  const { data, error } = await supabase
    .from("children")
    .insert({ facility_id: facilityId, nickname, enrollment_year: enrollmentYear })
    .select("id, nickname, enrollment_year")
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, value: { id: data.id, nickname: data.nickname, enrollmentYear: data.enrollment_year } };
}
