"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../supabase-browser";
import styles from "../page.module.css";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.push("/");
        router.refresh();
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice("確認メールを送信しました。メール内のリンクをクリックしてから、ログインしてください。");
        } else {
          router.push("/");
          router.refresh();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "予期しないエラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap} style={{ maxWidth: 420, paddingTop: 80 }}>
      <header className={styles.masthead} style={{ border: "none", marginBottom: 24 }}>
        <div>
          <p className={styles.eyebrow}>PoC Prototype · 本番構成</p>
          <h1 className={styles.title}>{mode === "signin" ? "ログイン" : "新規登録"}</h1>
          <p className={styles.dek}>支援記録オートドラフトは施設単位のログインが必要です。</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className={styles.panel}>
        {error && <div className={styles.errorCallout}>⚠ {error}</div>}
        {notice && <div className={styles.uncertainCallout}>{notice}</div>}

        <label htmlFor="email" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
          メールアドレス
        </label>
        <input
          id="email"
          className={styles.labelInput}
          style={{ width: "100%", marginBottom: 14 }}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
          パスワード
        </label>
        <input
          id="password"
          className={styles.labelInput}
          style={{ width: "100%", marginBottom: 20 }}
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: "100%" }} disabled={busy}>
          {busy ? "処理中…" : mode === "signin" ? "ログイン" : "登録する"}
        </button>
      </form>

      <p style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
        {mode === "signin" ? (
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              setMode("signup");
              setError(null);
              setNotice(null);
            }}
          >
            アカウントを新規作成する
          </button>
        ) : (
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              setMode("signin");
              setError(null);
              setNotice(null);
            }}
          >
            ログイン画面に戻る
          </button>
        )}
      </p>
    </div>
  );
}
