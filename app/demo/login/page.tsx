import type { Metadata } from "next";
import { redirect } from "next/navigation";
import styles from "../../page.module.css";
import { hasSession, MSG_UNSET } from "../../demo-auth";
import { authConfig } from "../../demo-session";
import LoginForm from "./LoginForm";

// DBなし体験版のログイン画面。合言葉を知っている人だけが /demo を開ける。
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ログイン — AI記録支援 体験版" };

export default async function DemoLoginPage() {
  if (await hasSession()) redirect("/demo");
  const configured = authConfig().ok;

  return (
    <div className={styles.wrap} style={{ maxWidth: 440, paddingTop: 80 }}>
      <header className={styles.masthead} style={{ border: "none", marginBottom: 8 }}>
        <div>
          <p className={styles.eyebrow}>体験デモ · 合言葉ログイン</p>
          <h1 className={styles.title}>AI記録支援 — 体験版</h1>
          <p className={styles.dek}>
            合言葉を入れると、「入力 → AIが6項目に振り分ける」体験ページが開きます(保存・施設共有はありません)。
          </p>
        </div>
      </header>

      {configured ? (
        <LoginForm />
      ) : (
        <div className={styles.errorCallout} role="alert" style={{ marginTop: 16 }}>
          ⚠ {MSG_UNSET}
          <br />
          <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
            管理者の方へ: 設定の手順は README「DBなし体験版」を参照してください。
          </span>
        </div>
      )}
    </div>
  );
}
