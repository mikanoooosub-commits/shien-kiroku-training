# PoC 停止記録・再開手順書

対象: AI記録支援(本番PoC) — `poc-app/`
作成: 2026-09-24

このPoCを一旦停止し、後から本番稼働(Vercel + Supabase + OpenAI)へ戻すための記録と手順。
**秘密値(APIキー・パスワード・anon key)はこのファイルに書かない。** 名前と設定先だけを書く。

---

## 1. 停止時の記録

### 停止理由
Supabaseの無料枠を別案件のPoCに使うため。**今回はSupabaseのみ停止する**(OpenAIキー・Vercelは現状維持)。

### 停止したもの(実施したら `[x]` にして日付を入れる)

| 対象 | 停止内容 | 実施 | 日付 |
|---|---|---|---|
| OpenAI | **今回は対象外**(キーは有効のまま)。ただしSupabase削除後は誰もログインできず、`proxy.ts` が未ログインの `/api/*` を401にするため、課金経路は実質閉じる。より確実にするなら後日Revoke | — | — |
| Supabase | バックアップ(Table EditorからCSV出力)取得後、プロジェクトを**削除**(ユーザーがダッシュボードで実施) | [x] | 2026-09-24 |
| Vercel | 変更なし(プロジェクト・環境変数とも残す) | — | — |
| GitHub | 変更なし(`mikanoooosub-commits/shien-kiroku-training` の `main`) | — | — |

### 停止直前の状態

- コードの最終コミット: `b9de859`(2026-09-17)。ドキュメント整理のコミットが以降に追加される場合がある(`git log` で確認)。
- 本番URL: https://shien-kiroku-training.vercel.app(Supabase削除後はログインできない・エラーになる。これは想定内)
- Supabaseプロジェクト: Free プラン、Tokyoリージョン推奨で作成(実際のリージョン・ref は削除前にダッシュボードで確認し、下に追記する)
  - 削除前の記録(2026-09-24、ダッシュボードのスクリーンショットより): プロジェクト名 `shien-kiroku-training` / プロジェクトID(ref) `tvebbuvsgsesjdmzkvrb` / リージョン `ap-northeast-1`(Northeast Asia, Tokyo) / プラン: 未確認
  - Auth設定(User Signups、同日確認): Allow new users to sign up = **オフ** / Allow manual linking = オフ / Allow anonymous sign-ins = オフ / Confirm email = **オフ**
    (サインアップはオフに戻っていた。`docs/security-notes.md` §2 の運用メモは対応済み。Confirm emailは開発用にオフだったので、再作成時に必要ならオンにする)
- 削除されるデータ: ダミー/仮名のテストデータのみ(施設C・施設E、児童、記録、RLS検証用アカウント)。実データは扱っていない(`CLAUDE.md` データ取扱い方針)。
- 定期実行ジョブ(cron / GitHub Actions / Edge Functions)は**存在しない**。停止対象は上の表のみ。

---

## 2. 環境変数(名前のみ)

コード上で `process.env` から読んでいるのは次の3つだけ。

| 名前 | 用途 | 使用箇所 | 公開可否 | 取得元 |
|---|---|---|---|---|
| `OPENAI_API_KEY` | 記録の6項目生成・モニタリング下書き(`gpt-4o-mini`) | `app/api/structure/route.ts`, `app/api/monitoring/route.ts`(サーバーのみ) | **秘密**。クライアントに出さない | platform.openai.com → API keys で**再発行** |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase接続先 | `app/supabase-browser.ts`, `app/supabase-server.ts`, `proxy.ts` | 公開前提 | 新Supabaseプロジェクトの Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable(anon)キー | 同上 | 公開前提(防御はRLS+GRANT) | 同上 |

設定先は2か所:

1. **Vercel**: プロジェクト設定 → Environment Variables(Production / Preview 両方)
2. **ローカル**: `poc-app/.env.local`(`.env.local.example` をコピーして作る。`.gitignore` 済み)

注意:

- **Supabaseを削除するため、`NEXT_PUBLIC_SUPABASE_*` の2つは再開時に新しい値へ差し替える**。古い値のままだと接続できない。
- `service_role` キーは**使わない**(RLSを丸ごと迂回するため。`CLAUDE.md` 実装規約3)。
- 環境変数を変更したら、Vercelは**再デプロイしないと反映されない**(§4)。

---

## 3. Supabaseの再セットアップ(削除済み前提)

DBスキーマの一次情報は `supabase/schema.sql`(冪等)。戻しSQLは `supabase/rollback.sql`。

1. [supabase.com](https://supabase.com) で「New Project」。
   - リージョン: Tokyo 推奨(ただし越境移転の論点は消えない。`docs/security-notes.md` §3)
   - **「Automatically expose new tables」のチェックを外す**。
     理由: オンだと `anon` に自動でGRANTされ、防御がRLS一枚になる(`docs/security-notes.md` §2)。
2. Project Settings → API から `Project URL` と anon(publishable)キーを取得。§2 の2か所へ設定。
3. SQL Editor で `supabase/schema.sql` を適用。
   1. まず `begin; …(全文)… rollback;` で**予行演習**
   2. エラーが無ければ `commit;` に変えて再実行(db-changeスキルの方針)
4. Authentication の設定:
   - Email + パスワードを有効
   - **「Allow new users to sign up」はオフを基本にする**(防御3層の1層目。サインアップ可否 / GRANT / RLS)。テストアカウントを作る間だけ一時的にオンにし、終わったら**必ずオフに戻して「Save changes」を押す**
   - 開発時のみ「Confirm email」をオフにしてよい(オンだと無料枠のメール送信上限に当たり `email rate limit exceeded` になる)。設定は**「Save changes」を押さないと反映されない**
5. Supabase Authは実在しないドメイン(`@example.com` 等)を拒否する。テストアカウントには実在するドメインを使う。過去は `mailinator.com` を使用(公開受信箱のため、実データ・パスワードリセットには使わない)。
6. RLS検証用の第三者アカウント(旧: 施設E)は削除で失われるので、必要なら作り直す(§5)。

Freeプランには日次バックアップが無い(`supabase/rollback.sql` 冒頭の注記)。データを残したい場合は削除前にCSVエクスポートしておく。

2026-09-24の削除前に、Table EditorからCSVを出力済み(保存場所はリポジトリ外のローカル。パスはここに書かない)。CSVからの復元が必要になったら、再作成後にTable EditorのImport(CSV)を使う。外部キーの都合上、`facilities` → `facility_members` / `children` → `records` の順に入れる。ただし `auth.users` は復元されないため、`facility_members.user_id` は再作成したユーザーのIDと合わない。実質的にはテストデータとして作り直す方が早い。

---

## 4. Vercelのデプロイ手順

- デプロイ先: https://shien-kiroku-training.vercel.app(GitHub `main` へのpushで自動デプロイ)
- Vercelの設定: **Root Directory を `poc-app/`** にする(リポジトリルートではなくこのディレクトリがアプリ本体)
- 再開時:
  1. §3 のSupabase再作成後、Vercel の Environment Variables の3つを新しい値へ更新
  2. Deployments から最新のデプロイを **Redeploy**(または `main` へ空コミットをpush)
  3. Vercelプロジェクトを誤って削除していた場合は、GitHubリポジトリを再インポートし、Root Directory と環境変数3つを設定し直す
- ローカルで動かす場合: `npm install` → `.env.local` を作成(§2)→ `npm run dev` → http://localhost:3000
- **ローカルと本番は同じSupabaseを共有する**。`schema.sql` の変更はコードのデプロイと別に SQL Editor で適用する。

---

## 5. 再開後の動作確認

1. `npx tsc --noEmit` と `npx eslint app` がエラーなしで通る
2. 新規サインアップ → 施設作成 → 6項目生成 → 保存 → リロードで復元
3. 未ログインで `/api/structure` `/api/monitoring` を叩くと 401(`proxy.ts`)
4. **RLS検証**: 第三者アカウントを1つ作り、REST直叩きで他施設のデータが見えない・書けないことを確認(`CLAUDE.md` 実装規約2、手順は `docs/security-notes.md` §2、チェックリストは `docs/test-scenarios.md`)
5. 未ログイン(anon keyのみ)で `/rest/v1/records` を叩くと `401 / 42501`(GRANT不在で拒否)
6. OpenAIのダッシュボードで**月額上限(Limits)を設定**する(アプリ側にレート制限は無い。認証済みユーザーが押すたびに課金される)

---

## 6. 再開前に片付けたい既知の課題

| 課題 | 出典 |
|---|---|
| `app/api/structure/route.ts` と `app/api/monitoring/route.ts` の `console.error(err)` が本文をログに出しうる(規約5違反の可能性) | `docs/security-notes.md` §7 |
| RLS棚卸し(全テーブル × 全操作)が未実施 | 同上 |
| 先方向け別紙(データフロー説明+同意書文言案)が未作成 | 同上 |
| 実データ投入のゲート(有料プランでDPA/SOC2、OpenAIのZDRまたはマスク、越境移転の手当て) | `docs/security-notes.md` §6, `CLAUDE.md` |
| 招待フローにメール通知・本人確認が無い | `README.md` |
| ISSUE-004(1文に2項目が混在すると片方が空になる)が観察のみで未対応 | `docs/issue-log.md` |

---

## 7. 関連ドキュメント

- `README.md` — 概要・セットアップ
- `docs/architecture.md` — 構成図・信頼境界
- `docs/security-notes.md` — セキュリティ方針の根拠
- `docs/change-log.md` / `docs/issue-log.md` — 変更管理表・バグ管理表
- `docs/test-scenarios.md` — 検証チェックリスト
- `supabase/schema.sql` / `supabase/rollback.sql` — DBスキーマと戻しSQL
