import Home from "./HomeClient";

// ルート "/" のサーバー側ラッパ。実体のUIは client component の ./HomeClient(Supabase前提の本番アプリ画面)。
//
// ここで force-dynamic を置く理由:
// HomeClient は render 中(useState の初期化で createClient())に Supabase ブラウザクライアントを生成するため、
// Supabase 環境変数が無いデモ構成(DBなしデモ)ではビルド時の静的プリレンダリングで例外になりビルドが失敗する。
// route segment config(dynamic)は client component では無視されるので、Server Component のこのラッパに置く。
// 実行時はデモモードでは proxy.ts が "/" を /demo/login 等へ振り替えるため、
// このラッパと HomeClient が実際に描画されるのは通常(Supabase)モードのときだけ。
export const dynamic = "force-dynamic";

export default function Page() {
  return <Home />;
}
