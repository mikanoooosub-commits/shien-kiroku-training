"use client";

import { useActionState } from "react";
import styles from "../../page.module.css";
import { login, type LoginState } from "./actions";

// 合言葉の入力欄。照合はサーバーの login(Server Action)だけで行う。
export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);
  return (
    <form action={action} className={styles.panel} style={{ marginTop: 16 }}>
      <label htmlFor="password" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
        合言葉
      </label>
      <input
        id="password"
        name="password"
        type="password"
        className={styles.labelInput}
        style={{ width: "100%", marginBottom: 14 }}
        autoComplete="current-password"
        required
        aria-invalid={state ? true : undefined}
        aria-describedby={state ? "login-msg" : undefined}
      />
      {state && (
        <div id="login-msg" className={styles.errorCallout} role="alert">
          ⚠ {state.message}
        </div>
      )}
      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: "100%" }} disabled={pending}>
        {pending ? "確かめています…" : "ログイン"}
      </button>
    </form>
  );
}
