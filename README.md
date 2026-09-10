# 支援記録オートドラフト(本番PoC)

板橋区の小規模オーナー系放課後等デイサービス事業者向けPoC。職員の自由入力・音声メモを、生成AI(OpenAI `gpt-4o-mini`)が6項目(出欠・入退室/健康面/活動内容/特記事項/連絡事項/引き継ぎ)の構造化ドラフトに変換する。記録は施設単位でスタッフ間に共有され、Supabase(Auth + Postgres + RLS)に保存する。

前身のArtifact版デモ(`../research/itabashi-2026-08/poc/prototype-demo.html`)はキーワード照合の簡易版だったが、こちらは実際にLLMを呼び出す。さらにその後、記録の保存先をブラウザのlocalStorage限定からSupabaseへ移行し、メール+パスワード認証・施設単位の共有を実装した(`docs/change-log.md` CHANGE-006)。

## セットアップ

1. 依存関係をインストール

   ```bash
   npm install
   ```

2. `.env.local` を作成

   ```bash
   cp .env.local.example .env.local
   ```

3. OpenAI APIキーを設定

   [platform.openai.com](https://platform.openai.com/api-keys) で発行したキーを、`.env.local` の `OPENAI_API_KEY=` の後に貼り付ける。

4. Supabaseプロジェクトを作成し、接続情報を設定

   1. [supabase.com](https://supabase.com) でサインアップし、「New Project」から作成(リージョンは Tokyo 推奨)
   2. 「Project Settings」→「API」から `Project URL` と `anon public` キーをコピー(どちらも公開されて良い値。`service_role` キーは絶対に使わない)
   3. `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` に貼り付ける
   4. Supabaseダッシュボードの「SQL Editor」で `supabase/schema.sql` の内容を実行する(db-changeスキルの方針により、まず `begin; …(全文)… rollback;` で予行演習してから、問題なければ `commit;` に変えて再実行することを推奨)
   5. (任意・開発時のみ)「Authentication」→「Sign In / Providers」→ Email の設定で「Confirm email」をオフにすると、サインアップ直後にメール確認なしでログインできる(本番では有効に戻す)

   `.env.local` は `.gitignore` 済みでコミットされない。

5. 開発サーバーを起動

   ```bash
   npm run dev
   ```

   [http://localhost:3000](http://localhost:3000) を開く。未ログインなら自動的に `/login` へ移動する。

## できること

- テキスト入力・音声入力(Web Speech API / Chrome・Edgeのみ)から、6項目の構造化ドラフトを生成する。
- 生成された各項目はその場で直接編集できる。AIが分類に迷った文は振り分けず「未分類のメモ」として切り出す。
- 事故・ヒヤリハット関連の語を含む文が特記事項欄に反映されていない場合、原文をキーワードで機械的に洗い出して警告する(`docs/issue-log.md` ISSUE-001)。
- メール+パスワードでログイン。記録は**施設単位**でスタッフ間に共有され、Supabaseに保存される(RLSにより施設外からは見えない)。
- 施設に既存メンバーを招待できる(サインアップ済みのメールアドレスのみ)。
- 記録を印刷・PDF出力できる(ブラウザの「PDFとして保存」)。画面用のボタン・バッジは印刷されない。

## 設計上の判断

- **施設単位で記録を共有する理由**: 実際の現場では、誰が記録してもスタッフ全員が見返せる必要があるため。ユーザー個人ごとに記録を分離するより、実運用に合っている。
- **PDFをライブラリでなく印刷CSSで出す理由**: jsPDF等は日本語フォントの埋め込みが必要になり、PoCの検証対象(記録が現場で通用する形で出せるか)から外れるコストが大きいため。
- **DBから読んだ`record`(jsonb)もzodで検証する理由**: Supabase側の内容も「壊れていない」保証はない(手動編集・アプリ更新途中など)ため、壊れた行は読み捨てる。
- **招待をメール送信なしのRPCにした理由**: このPoCの検証対象(記録作成・共有の体験)から外れる開発コストを避けるため。招待された側への通知は運用(口頭・チャット等)でカバーする前提。

## 構成

- `app/record.ts` — 記録スキーマ(zod)と項目定義の唯一の置き場。サーバー・クライアント双方がここを参照する。
- `app/page.tsx` — 入力(テキスト・音声入力)と、6項目の構造化ドラフト表示・編集・コピー・保存・印刷・施設管理のUI。
- `app/login/page.tsx` — メール+パスワードのログイン・新規登録。
- `app/supabase-browser.ts` / `app/supabase-server.ts` — Supabaseクライアント(ブラウザ用・サーバー用)。
- `app/facility.ts` — 所属施設の取得・作成・スタッフ招待。
- `app/records.ts` — Supabase上の記録の読み書き。読み出し時にzodで検証する。
- `app/database.types.ts` — `supabase/schema.sql`と対応するTypeScript型(手書き。プロジェクト作成後は`supabase gen types`で生成し直すこと)。
- `app/api/structure/route.ts` — サーバー側のRoute Handler。OpenAI Responses API(`responses.parse` + `zodTextFormat`)で6項目のJSONを生成・zod検証する。APIキーはここでのみ使用し、クライアントには渡さない。
- `proxy.ts` — 全リクエストでSupabaseセッションを検証(Next.js 16で`middleware`から名称変更)。未ログインを`/login`へリダイレクトし、未ログインでの`/api/*`アクセスは401を返す。
- `supabase/schema.sql` / `supabase/rollback.sql` — DBスキーマ(施設・施設メンバー・記録)とRLSポリシー、招待用RPC。db-changeスキルの方針(冪等・RLS+grant必須・戻しSQL)に従う。
- `docs/architecture.md` — システム構成図(コンポーネント・データフロー・信頼境界)。
- `docs/issue-log.md` — 障害票(バグ管理表)。
- `docs/change-log.md` — 変更管理表。仕様・スキーマに影響する変更をここに記録する。

## 現在の状態(2026-09-10 時点)

**動作を確認済み(Supabase移行前の内容)**

- 記録の保存・一覧・再読込・削除(localStorage時代)。
- 画面上で項目を手修正 → 上書き保存すると、DOM側の編集内容が同一IDに反映される(重複レコードにならない)。
- 印刷レイアウト。画面用のボタン・バッジ・履歴は出ず、記録本体だけが出る。空欄は「—」になる。
- ブラウザの Ctrl+P から直接印刷しても出力日時が入る(`beforeprint` + `flushSync`。これが無いと日時が空欄になる)。
- OpenAI API の実呼び出しを実データに近いダミー文2件で検証済み。途中で `docs/issue-log.md` ISSUE-001(事故・ヒヤリハット関連の記述が特記事項に反映されないことがある)を発見し、プロンプト改善+機械チェックの安全網で緩和した。
- `npx tsc --noEmit` / `npx eslint app` ともにエラーなし(`layout.tsx` に既存の警告が1件のみ)。Supabase導入後のコードもこの2つは通過済み。

**Supabase接続後の通し検証(2026-09-10 実施・全項目成功)**

実際のSupabaseプロジェクトに対して、以下を順に実機確認した。

1. サインアップ → セッション確立 → `proxy.ts`が`/`へ通す
2. 施設作成 → `handle_new_facility`トリガーが作成者をownerとして自動登録(途中でISSUE-003を発見・修正)
3. OpenAI呼び出しで6項目の下書き生成
4. 項目を手編集 → 保存 → Supabaseへ永続化
5. **ページリロード後も復元**(手編集した引き継ぎ欄まで含めて往復成功)
6. **RLSによる分離**: 別ユーザーでログインすると施設も記録も見えない。`getMyFacility()`のクエリは`user_id`で絞り込んでおらずRLS任せなので、これはRLSが効いている直接の証拠になる
7. `invite_to_facility` RPCでの招待 → 招待された側のログインで施設と記録が共有表示される

**環境依存のハマりどころ(検証中に判明)**

- Supabase Authは**ドメインの実在性まで検証する**。`@example.com`や架空ドメインは`Email address is invalid`で弾かれる。
- 「Confirm email」が有効だと、無料枠のメール送信レート上限(非常に低い)にすぐ当たり`email rate limit exceeded`で登録が完結しない。開発中はオフ推奨(上記セットアップ手順4-5)。設定はトグルを動かすだけでなく**「Save changes」を押さないと反映されない**。

**未対応 — 残っている論点**

- ISSUE-002(引き継ぎ事項が連絡事項に混入することがある)は観察のみで未対応。安全情報ではないため優先度は低いと判断している。
- 機械チェックは`incident`(特記事項)カテゴリのみに実装済み。他カテゴリへの汎用化は、同種の見落としがもっと蓄積してから判断する。
- 招待フローにメール通知が無い(招待された側は自分で気づけない)。

**この先の設計方針(商談での言い方に直結する)**

音声入力は「話すだけで楽になります」と押さない。導入した27施設のうち17施設(63%)が日常的に使っておらず、失敗の機序は「精度が低い→修正が増える→信頼できなくなる→使わなくなる」と分かっているため。訴求は「AIは間違えます。だから直す前提で作りました」で、**直す手間の小ささ**を差別化点に置く。項目ごとの直接編集と未分類メモの切り出しは、この方針の実装。

## 本番導入前に必要な確認(未検証)

- 児童の健康情報等を含むため、音声入力・生成AI・Supabase利用時の個人情報保護要件(OpenAI社・Supabase社へのデータ送信可否、データ保持期間、データ保管リージョン等)を導入前に確認すること。詳細は `../research/itabashi-2026-08/poc/poc-spec.html` §7 を参照。
- 招待フローにメール送信・本人確認の仕組みが無い(現状はメールアドレスの一致のみで招待可能)。

## デプロイ

Vercelにデプロイする場合、プロジェクトルートを `poc-app/` に設定し、環境変数 `OPENAI_API_KEY` / `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` をVercelのプロジェクト設定で登録する(`.env.local` はデプロイ先に含まれない)。

```bash
vercel
```
