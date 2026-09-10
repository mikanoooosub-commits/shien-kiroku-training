# システム構成図

生成日: 2026-09-10(初版)、2026-09-10 Supabase導入で全面改訂
対象: AI記録支援(本番PoC) — `poc-app/`

## 全体構成

```mermaid
flowchart LR
  subgraph Browser["ブラウザ(スタッフの端末)"]
    Speech["Web Speech API\n(音声認識・Chrome/Edgeのみ)"]
    UI["app/page.tsx\n入力・6項目編集・保存・印刷UI"]
    SBClient["@supabase/ssr\ncreateBrowserClient"]
  end

  subgraph Proxy["proxy.ts(旧middleware、Next.js 16で名称変更)"]
    ProxyFn["全リクエストでセッション確認\n未ログイン→/loginへリダイレクト\n未ログインAPIアクセス→401"]
  end

  subgraph Server["Next.js サーバー(Vercel想定・未デプロイ)"]
    Route["app/api/structure/route.ts\nRoute Handler"]
  end

  subgraph External["外部サービス"]
    OpenAI["OpenAI Responses API\ngpt-4o-mini"]
    Supabase["Supabase\nAuth + Postgres + RLS"]
  end

  Speech -- "音声→テキスト" --> UI
  UI -- "① POST /api/structure { text }" --> ProxyFn
  ProxyFn -- "② 認証済みなら通過" --> Route
  Route -- "③ responses.parse()\nsystem prompt + zodTextFormat(RecordSchema)" --> OpenAI
  OpenAI -- "④ 構造化JSON" --> Route
  Route -- "⑤ record または error" --> UI
  UI -- "⑥ ログイン/サインアップ" --> SBClient
  SBClient -- "⑦ auth + records CRUD(RLS適用)" --> Supabase
  ProxyFn -- "セッション検証" --> Supabase
```

## コンポーネント

| コンポーネント | 役割 | 実行場所 |
|---|---|---|
| `app/record.ts` | `RecordSchema`(zod)・`CATEGORY_META`・保存レコード形式(`SavedRecordSchema`)の唯一の定義。 | 共有(サーバー/クライアント両方からimport) |
| `app/page.tsx` | 入力(テキスト・音声)、AI呼び出しの起動、6項目の表示・直接編集・コピー・保存・印刷、施設作成・招待UI、機械チェック(`findIncidentMismatches`)。`force-dynamic`指定(セッション依存でユーザー間共有できる静的コンテンツを持たないため)。 | クライアント(ブラウザ) |
| `app/login/page.tsx` | メール+パスワードでのログイン・新規登録フォーム。 | クライアント(ブラウザ) |
| `app/supabase-browser.ts` | ブラウザ用Supabaseクライアント(`createBrowserClient`)。anon keyのみ使用。 | クライアント(ブラウザ) |
| `app/supabase-server.ts` | サーバー用Supabaseクライアント(`createServerClient`)。Server Component/Route Handlerから使う想定(現時点で実利用箇所なし、将来のサーバー側データ取得用に用意)。 | サーバー |
| `app/facility.ts` | 所属施設の取得・作成・スタッフ招待(`invite_to_facility` RPC呼び出し)。 | クライアント(ブラウザ) |
| `app/records.ts` | 施設の記録一覧取得・保存・削除。DBから読んだ`record`(jsonb)は`RecordSchema`で検証し、壊れた行は読み捨てる。 | クライアント(ブラウザ) |
| `app/database.types.ts` | `supabase/schema.sql`と対応する手書きのTypeScript型。プロジェクト作成後は`supabase gen types`で生成し直すこと。 | 共有 |
| `app/api/structure/route.ts` | リクエストをzodで検証し、OpenAI Responses APIを呼び出し、応答を`RecordSchema`で検証して返す。`OPENAI_API_KEY`はここでのみ使用。 | サーバー |
| `proxy.ts` | 全リクエストでSupabaseセッションを検証・更新。未ログインなら`/login`へリダイレクト、未ログインでの`/api/*`アクセスは401を返す。 | サーバー(Edge/Nodeランタイム、リクエストの前段) |
| `supabase/schema.sql` / `rollback.sql` | `facilities` / `facility_members` / `records`テーブル、RLSポリシー、招待用RPC(`invite_to_facility`)を定義する冪等なDDL。db-changeスキルの方針に従う。 | Supabase(Postgres) |

## データフローと信頼境界

| 境界 | 検証方法 | 理由 |
|---|---|---|
| ブラウザ → `/api/structure`(①②) | `proxy.ts`が未ログインを401で拒否 → `RequestSchema.safeParse`(`route.ts`) | 未ログインでのAI呼び出し(=OpenAI従量課金の踏み台)を防ぐ。クライアント入力自体も信用しない。 |
| サーバー → OpenAI(③) | — (送信のみ) | **未解決**: 児童の健康情報等を含みうる自由文をOpenAI社に送信する。個人情報保護要件は`../research/itabashi-2026-08/poc/poc-spec.html` §7で未検証と明記済み。PoC期間中はダミーデータのみを使う運用でカバーしている。 |
| OpenAI → サーバー(④) | `zodTextFormat(RecordSchema, ...)` + `response.output_parsed` | 外部APIの応答は形式が保証されていない前提で扱う。 |
| サーバー → ブラウザ(⑤) | `ApiResponseSchema.safeParse`(`page.tsx`) | 自前のAPIでもネットワークを跨ぐ以上、実際に検証してから使う。 |
| ブラウザ ⇄ Supabase(⑥⑦) | **RLS**(`supabase/schema.sql`)。`records`/`facility_members`/`facilities`はすべて`is_facility_member()`ベースのポリシーで、自分が所属する施設の行しか読み書きできない。読み出し後も`SavedRecordSchema`/`RecordSchema`で再検証。 | Supabaseではクライアントが直接DBを叩く構成のため、**RLSが唯一のアクセス制御**(db-changeスキル原則7)。加えてDBの内容も「壊れていない」保証はない(手動編集・アプリ更新途中など)ため、読み出し時にzodで再検証する。 |

## 認証・アクセス範囲の設計

- **ログイン方式**: メール+パスワード(Supabase Auth)。
- **共有範囲**: 施設(`facilities`)単位。同じ施設に所属するスタッフ全員が、施設内の記録をすべて閲覧・編集・削除できる(個人ごとの記録の分離はしない)。実際の現場運用(誰が記録してもチーム全員が見られる必要がある)に合わせた設計。
- **施設への参加**: 施設作成者が`owner`として自動的にメンバーになる(DBトリガー`handle_new_facility`)。他のスタッフは、既存メンバーが**サインアップ済みのメールアドレスを指定して**`invite_to_facility` RPCで招待する。未サインアップのメールアドレスへの招待はできない(この段階では招待メール送信機能は実装していない)。
- **ロール**: `facility_members.role`に`owner`/`staff`を持つが、現時点ではUI・RLSともにロールによる権限差は設けていない(全メンバーが対等)。将来、削除権限などをownerに限定する場合はここを拡張する。

## 機密情報の扱い

- `OPENAI_API_KEY`はサーバー側(`route.ts`)でのみ`process.env`から読み、クライアントに一切渡らない。
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`はクライアントに公開される前提の値(接頭辞`NEXT_PUBLIC_`の通り)。実際のアクセス制御はRLSが担うため、この2つが漏れても即座にデータ漏洩にはならない。
- `service_role`キーはこのアプリでは一切使用しない(将来、管理者用の一括操作等でサーバー側に導入する場合は、クライアントに絶対渡さないこと)。

## 未解決のリスク(構成上の注意点)

1. **OpenAI社・Supabase社へのデータ送信**: ③の矢印(OpenAI)と⑦の矢印(Supabase)の双方に児童の健康情報等が含まれうる。本番導入前に両社の個人情報保護・データ保持要件の確認が必要(先方向けの別紙を別途作成予定)。
2. **LLM分類の非決定性**: 同じ入力でも実行のたびに分類結果が変わりうる(`issue-log.md` ISSUE-001参照)。`incident`(特記事項)のみ機械チェックの安全網があるが、他5項目には無い。
3. **招待フローが手動**: メール送信を伴わないため、招待された側が「自分が招待されたこと」に気づく手段が無い(施設作成者が別途口頭・チャット等で伝える前提)。
4. **`proxy.ts`の認証チェックはSupabase Auth serverへの問い合わせを伴う**: Next.js公式ガイドは「Proxyでは重い処理を避け、cookieの中身だけを見る楽観的チェックに留めるべき」としているが、本実装は`@supabase/ssr`の推奨パターンに従い`getUser()`(サーバー問い合わせ)を採用している。全リクエストでレイテンシが発生する点はトレードオフとして認識しておく。
