-- schema.sql
-- 支援記録オートドラフト: 施設単位で記録を共有するためのスキーマ。
-- db-changeスキルの方針に従い、冪等(何度流しても同じ結果)に書く。
-- 適用手順: 本番反映の前に `begin; ...(このファイル全体)... rollback;` で予行演習してから、
-- 問題なければ `commit;` に変えて再実行する(Supabase SQL Editorは実行ごとに接続が変わるため、
-- begin〜rollbackは必ず1回の実行にまとめる)。
-- 戻す場合は rollback.sql を使う。

create extension if not exists pgcrypto;

-- ============================================================
-- facilities: 記録を共有する単位(施設)
-- ============================================================
create table if not exists facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  created_at timestamptz not null default now()
);

comment on table facilities is '記録を共有する単位。1施設に複数スタッフが所属する。';

-- ============================================================
-- facility_members: どのユーザーがどの施設に所属するか
-- ============================================================
create table if not exists facility_members (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  unique (facility_id, user_id)
);

comment on table facility_members is '施設への所属。role: owner(施設作成者) / staff(招待されたスタッフ)。';

-- ============================================================
-- records: 支援記録本体(旧 localStorage の SavedRecord に対応)
-- ============================================================
create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  label text not null default '',
  source_text text not null default '',
  record jsonb not null,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table records is '支援記録。record列は app/record.ts の RecordSchema と対応する(6項目+uncertainNotes)。形の検証はアプリ層(zod)で行い、DB側はjsonbで柔軟に受ける。';

create index if not exists records_facility_id_saved_at_idx
  on records (facility_id, saved_at desc);

-- updated_at を自動更新する
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists records_set_updated_at on records;
create trigger records_set_updated_at
  before update on records
  for each row execute function set_updated_at();

-- ============================================================
-- 施設作成者を自動的にメンバー(owner)にする
-- ============================================================
create or replace function handle_new_facility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into facility_members (facility_id, user_id, role)
  values (new.id, auth.uid(), 'owner')
  on conflict (facility_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_facility_created on facilities;
create trigger on_facility_created
  after insert on facilities
  for each row execute function handle_new_facility();

-- ============================================================
-- RLS判定用ヘルパー(security definer で facility_members への
-- 再帰的なRLS参照を避ける。Supabaseで一般的なパターン)
-- ============================================================
create or replace function is_facility_member(target_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from facility_members
    where facility_id = target_facility_id
      and user_id = auth.uid()
  );
$$;

-- ============================================================
-- スタッフ招待: メールアドレスで既存ユーザーを施設に追加する。
-- auth.users はクライアントから直接読めないため、
-- security definer 関数経由でメールからuser_idを引く。
-- ============================================================
create or replace function invite_to_facility(target_facility_id uuid, invitee_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invitee_id uuid;
begin
  if not is_facility_member(target_facility_id) then
    raise exception 'この施設のメンバーのみが招待できます。';
  end if;

  select id into invitee_id from auth.users where email = invitee_email;
  if invitee_id is null then
    raise exception 'そのメールアドレスのユーザーが見つかりません。先にサインアップしてもらってください。';
  end if;

  insert into facility_members (facility_id, user_id, role)
  values (target_facility_id, invitee_id, 'staff')
  on conflict (facility_id, user_id) do nothing;
end;
$$;

-- ============================================================
-- RLS有効化 + ポリシー
-- ============================================================
alter table facilities enable row level security;
alter table facility_members enable row level security;
alter table records enable row level security;

drop policy if exists "facilities: members can select" on facilities;
create policy "facilities: members can select" on facilities
  for select
  using (is_facility_member(id));

drop policy if exists "facilities: authenticated can insert" on facilities;
create policy "facilities: authenticated can insert" on facilities
  for insert
  to authenticated
  with check (true);

drop policy if exists "facility_members: members can select roster" on facility_members;
create policy "facility_members: members can select roster" on facility_members
  for select
  using (is_facility_member(facility_id));

drop policy if exists "records: members can select" on records;
create policy "records: members can select" on records
  for select
  using (is_facility_member(facility_id));

drop policy if exists "records: members can insert" on records;
create policy "records: members can insert" on records
  for insert
  to authenticated
  with check (is_facility_member(facility_id) and created_by = auth.uid());

drop policy if exists "records: members can update" on records;
create policy "records: members can update" on records
  for update
  using (is_facility_member(facility_id))
  with check (is_facility_member(facility_id));

drop policy if exists "records: members can delete" on records;
create policy "records: members can delete" on records
  for delete
  using (is_facility_member(facility_id));

-- ============================================================
-- children: 施設に所属する児童マスタ(仮名・ニックネームのみ)。
-- 実名・生年月日は持たない(データ最小化)。学年は enrollment_year(入学年度)
-- からアプリ側(app/children.ts の gradeLabel)で都度算出し、DBには保持しない。
-- ============================================================
create table if not exists children (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities (id) on delete cascade,
  nickname text not null,
  enrollment_year integer not null,
  created_at timestamptz not null default now()
);

comment on table children is '施設に所属する児童マスタ。氏名・生年月日は持たない(仮名・ニックネームのみ、学年は入学年度から都度算出)。';

create index if not exists children_facility_id_idx on children (facility_id);

alter table children enable row level security;

drop policy if exists "children: members can select" on children;
create policy "children: members can select" on children
  for select
  using (is_facility_member(facility_id));

drop policy if exists "children: members can insert" on children;
create policy "children: members can insert" on children
  for insert
  to authenticated
  with check (is_facility_member(facility_id));

drop policy if exists "children: members can update" on children;
create policy "children: members can update" on children
  for update
  using (is_facility_member(facility_id))
  with check (is_facility_member(facility_id));

drop policy if exists "children: members can delete" on children;
create policy "children: members can delete" on children
  for delete
  using (is_facility_member(facility_id));

-- ============================================================
-- records: 対象児童(child_id)・記録対象日(record_date)を追加。
-- 既存の記録は child_id = NULL(未設定として表示)、record_date は
-- 適用時点の日付が入る(以後の保存はアプリが明示的に指定する)。
-- ============================================================
alter table records add column if not exists child_id uuid references children (id) on delete restrict;
alter table records add column if not exists record_date date not null default current_date;

create index if not exists records_facility_id_record_date_idx on records (facility_id, record_date desc);
create index if not exists records_child_id_idx on records (child_id);

-- ============================================================
-- grant: RLSは行を絞るだけで、テーブル自体への権限は別途必要
-- ============================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on facilities to authenticated;
grant select, insert on facility_members to authenticated;
grant select, insert, update, delete on records to authenticated;
grant select, insert, update, delete on children to authenticated;
grant execute on function invite_to_facility(uuid, text) to authenticated;
grant execute on function is_facility_member(uuid) to authenticated;
