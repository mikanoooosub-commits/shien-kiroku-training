"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  authConfig,
  passwordMatches,
  isLocked,
  recordFailure,
  clearFailures,
  FAIL_DELAY_MS,
} from "../../demo-session";
import { startSession, endSession, MSG_UNSET } from "../../demo-auth";

// DBなし体験版の合言葉ログイン・ログアウト(つもる tsumoru-poc の login/actions.ts を移植)。
// login はログイン前に呼ぶものなので守らない(代わりに間違いの抑えを入れる)。logout は cookie を消すだけ。

export type LoginState = { message: string } | null;

const MSG_WRONG = "合言葉が違います。";
const MSG_LOCKED = "続けて間違えたため、しばらく受け付けません。15分ほどおいてから、もう一度お試しください。";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 相手の IP。Vercel が付ける x-forwarded-for の先頭(無ければ x-real-ip)。分からなければ1つのまとまりとして数える
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || "unknown";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const cfg = authConfig();
  if (!cfg.ok) return { message: MSG_UNSET }; // 設定が無ければ比べずに断る(安全側)

  const ip = await clientIp();
  if (isLocked(ip)) {
    await wait(FAIL_DELAY_MS);
    return { message: MSG_LOCKED };
  }

  const raw = formData.get("password");
  const input = typeof raw === "string" ? raw : "";
  if (!(await passwordMatches(input, cfg.passwordHash))) {
    const locked = recordFailure(ip);
    await wait(FAIL_DELAY_MS);
    return { message: locked ? MSG_LOCKED : MSG_WRONG };
  }

  clearFailures(ip);
  await startSession(cfg.secret);
  redirect("/demo");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/demo/login");
}
