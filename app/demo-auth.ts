import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEMO_SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  createSessionToken,
  verifySessionToken,
} from "./demo-session";

// DBなし体験版(/demo)の合言葉ログインの確かめ(つもる tsumoru-poc の src/lib/auth.ts を移植)。守りは2段:
//   1段目 proxy.ts … 入口で cookie を見てふるい分ける
//   2段目 ここ … /demo ページの描画と、/api/structure の先頭で確かめる
// 2段目が要る理由: 入口(proxy)の対象から外れる経路があり得るため、データに触る側でも必ず確かめる。

export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(DEMO_SESSION_COOKIE)?.value);
}

// ページ用。ログインしていなければ /demo/login へ
export async function requireDemoPage(): Promise<void> {
  if (!(await hasSession())) redirect("/demo/login");
}

export const MSG_UNSET = "合言葉がまだ設定されていないため、いまは入れません。";

// ログイン状態の cookie を付ける(httpOnly・Secure・SameSite=Lax・7日)
export async function startSession(secret: string): Promise<void> {
  const store = await cookies();
  store.set(DEMO_SESSION_COOKIE, createSessionToken(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(DEMO_SESSION_COOKIE);
}
