-- rollback.sql
-- schema.sql を取り消す。破壊的操作(records テーブルの削除でデータが失われる)。
-- 実行前にバックアップを取ること(Supabase Freeプランには日次バックアップが無い)。
-- 依存関係の逆順(records → children → facility_members → facilities、関数・トリガーは先に)で削除する。

-- records.child_id が children を参照しているため、children を消す前に列を落とす。
alter table records drop column if exists record_date;
alter table records drop column if exists child_id;

drop policy if exists "children: members can delete" on children;
drop policy if exists "children: members can update" on children;
drop policy if exists "children: members can insert" on children;
drop policy if exists "children: members can select" on children;

drop table if exists children;

drop trigger if exists records_set_updated_at on records;
drop function if exists set_updated_at();

drop trigger if exists on_facility_created on facilities;
drop function if exists handle_new_facility();

drop policy if exists "records: members can delete" on records;
drop policy if exists "records: members can update" on records;
drop policy if exists "records: members can insert" on records;
drop policy if exists "records: members can select" on records;
drop policy if exists "facility_members: members can select roster" on facility_members;
drop policy if exists "facilities: authenticated can insert" on facilities;
drop policy if exists "facilities: members can select" on facilities;

drop function if exists invite_to_facility(uuid, text);
drop function if exists is_facility_member(uuid);

drop table if exists records;
drop table if exists facility_members;
drop table if exists facilities;
