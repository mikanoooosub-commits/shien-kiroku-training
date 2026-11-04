import { requireDemoPage } from "../demo-auth";
import DemoClient from "./DemoClient";

// DBなし体験版のゲート(守り2段のうちページ側=2段目)。
// 合言葉ログインが無ければ requireDemoPage() が /demo/login へ飛ばす。入口(proxy.ts)だけに頼らない。
export const dynamic = "force-dynamic";

export default async function DemoPage() {
  await requireDemoPage();
  return <DemoClient />;
}
