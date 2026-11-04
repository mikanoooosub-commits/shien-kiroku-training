"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import { ApiResponseSchema, CATEGORY_META, type CategoryKey, type StructuredRecord } from "../record";
import { logout } from "./login/actions";

/**
 * DBなし体験版の本体(クライアントUI)。
 * 「自由入力 → AIが6項目に分割」だけを、保存・施設共有なしで体験できる。呼び出すのは `/api/structure`
 * (OpenAIのみ・Supabase非依存)だけ。合言葉ログインのゲートは `app/demo/page.tsx`(サーバー)側で行う。
 */

const INCIDENT_KEYWORDS = [
  "ヒヤリハット",
  "事故",
  "転倒",
  "ぶつか",
  "かみつき",
  "パニック",
  "興奮",
  "けが",
  "怪我",
  "トラブル",
  "けんか",
  "喧嘩",
];

function splitSentences(sourceText: string): string[] {
  return sourceText
    .split(/(?<=[。!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findIncidentMismatches(sourceText: string, record: StructuredRecord): string[] {
  return splitSentences(sourceText).filter((sentence) => {
    const isIncidentLike = INCIDENT_KEYWORDS.some((kw) => sentence.includes(kw));
    if (!isIncidentLike) return false;
    const alreadyCaptured =
      record.incident.includes(sentence) || record.uncertainNotes.some((note) => note.includes(sentence));
    return !alreadyCaptured;
  });
}

const SAMPLES = [
  "れんくんは今日9時に到着して、すぐ検温したら36.8度で元気でした。工作の時間に紙飛行機を作って、うまく飛ばせたのがすごく嬉しそうでした。おやつの後にたっくんと少しぶつかってヒヤリハットになりかけましたが、すぐ間に入って落ち着きました。今日はいつもより疲れ気味な様子でした。お迎えは16時にお母さんが来ました。明日は療育プログラムの持ち物としてタオルを追加で持ってきてほしいと伝えてください。次の担当の田中さんに、れんくんが今日少し疲れ気味だったことを申し送りしておいてください。",
  "みおちゃんは13時に登所、遅刻はなしでした。少し鼻水が出ていたので水分をこまめに取らせました。今日の活動はリズム運動で、みんなで輪になって体を動かしました。特にトラブルやヒヤリハットはありませんでした。お迎えのお父さんに、来週の個別支援計画の面談日程を確認してほしいと伝えてください。夕方の担当の佐藤さんに、みおちゃんが鼻水気味なので明日は室内活動を中心にしてほしいと引き継ぎます。",
];

// Web Speech API has no lib.dom.d.ts types; declare the minimal shape this page uses.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
}

function copyField(value: string, btn: HTMLButtonElement) {
  const original = btn.textContent;
  const reset = (text: string, copied: boolean) => {
    btn.textContent = text;
    btn.classList.toggle(styles.copyBtnCopied, copied);
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove(styles.copyBtnCopied);
    }, 1400);
  };
  if (!value) {
    reset("(空です)", false);
    return;
  }
  navigator.clipboard
    .writeText(value)
    .then(() => reset("✓ コピーしました", true))
    .catch(() => reset("✕ 失敗", false));
}

export default function DemoClient() {
  const [text, setText] = useState("");
  const [sampleIdx, setSampleIdx] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<StructuredRecord | null>(null);
  const [incidentMismatches, setIncidentMismatches] = useState<string[]>([]);
  const [micSupported, setMicSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordSeq, setRecordSeq] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingRef = useRef(false);
  const baseTextRef = useRef("");
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMicSupported(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.addEventListener("result", (e) => {
      const ev = e as SpeechRecognitionEventLike;
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const transcript = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) baseTextRef.current += final;
      setText(baseTextRef.current + interim);
    });
    recognition.addEventListener("end", () => {
      if (recordingRef.current) recognition.start();
    });
    recognition.addEventListener("error", () => {
      recordingRef.current = false;
      setRecording(false);
    });
    recognitionRef.current = recognition;
  }, []);

  function toggleMic() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (recordingRef.current) {
      recordingRef.current = false;
      setRecording(false);
      recognition.stop();
    } else {
      baseTextRef.current = text ? text + (text.endsWith("\n") ? "" : "\n") : "";
      recordingRef.current = true;
      setRecording(true);
      recognition.start();
    }
  }

  function handleInsertSample() {
    setText(SAMPLES[sampleIdx % SAMPLES.length]);
    setSampleIdx((i) => i + 1);
  }

  function handleClear() {
    setText("");
    setRecord(null);
    setIncidentMismatches([]);
    setError(null);
  }

  async function handleGenerate() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIsGenerating(true);
    setError(null);
    setRecord(null);
    try {
      const res = await fetch("/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const parsed = ApiResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new Error("サーバーの応答形式が想定と異なります。");
      }
      if (!res.ok || !parsed.data.record) {
        throw new Error(parsed.data.error ?? "AIの下書き生成に失敗しました。");
      }
      setRecord(parsed.data.record);
      setIncidentMismatches(findIncidentMismatches(trimmed, parsed.data.record));
      setRecordSeq((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "予期しないエラーが発生しました。");
    } finally {
      setIsGenerating(false);
    }
  }

  const charCount = text.length;

  return (
    <div className={styles.wrap}>
      <header className={styles.masthead} style={{ borderBottom: "1px solid var(--rule)", marginBottom: 24 }}>
        <div>
          <p className={styles.eyebrow}>体験デモ · 保存なし</p>
          <h1 className={styles.title}>AI記録支援 — 体験版</h1>
          <p className={styles.dek}>
            職員がその場で話した・書いた内容を、生成AI(OpenAI gpt-4o-mini)が6項目へ自動で振り分ける。
            このページは分類だけを試せる体験版で、記録の保存・共有はできません。
          </p>
        </div>
        <div className={styles.metaRow}>
          <form action={logout}>
            <button type="submit" className={styles.btn}>
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <div className={styles.bench}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>職員の入力</span>
            <span className={styles.panelSub}>Input</span>
          </div>

          <p className={styles.inputNotice}>
            これは体験用デモです。<strong>実在の個人情報(本名など)は入力しないでください</strong>。入力内容はOpenAIに送信されます。児童は仮名・ニックネームで。
          </p>

          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今日あったことを、話すように自由に書いてください。例:「れんくんは9時に到着して検温したら36.8度でした…」"
            aria-label="自由記述の入力欄"
          />
          <div className={styles.inputTools}>
            <button
              type="button"
              className={styles.btn + " " + styles.btnMic + " " + (recording ? styles.btnMicRecording : "")}
              onClick={toggleMic}
              disabled={!micSupported}
              title={
                micSupported
                  ? undefined
                  : "このブラウザは音声入力(Web Speech API)に対応していません。Chrome / Edge でお試しいただくか、テキストで入力してください。"
              }
            >
              <span className={styles.recDot} />
              {!micSupported ? "🎙 音声入力(非対応)" : recording ? "● 停止" : "🎙 音声入力"}
            </button>
            <button type="button" className={styles.btn} onClick={handleInsertSample}>
              サンプル文を挿入
            </button>
            <button type="button" className={styles.btn} onClick={handleClear}>
              クリア
            </button>
            <button
              type="button"
              className={styles.btn + " " + styles.btnPrimary}
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
            >
              AI分類分け
            </button>
          </div>
          <div className={styles.statRow}>
            <span>
              文字数: <b>{charCount}</b>
            </span>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>AIアウトプット</span>
            <span className={styles.panelSub}>Output · 6項目</span>
          </div>

          {error && <div className={styles.errorCallout}>⚠ {error}</div>}

          {isGenerating && (
            <div className={styles.thinking}>
              <span className={styles.spinner} />
              gpt-4o-mini が入力内容を6項目に振り分けています…
            </div>
          )}

          {!isGenerating && !record && (
            <div className={styles.emptyState}>
              <span className={styles.glyph}>📋</span>
              左の入力欄に記入し、「AI分類分け」を押すと、ここに出欠・健康面・活動内容などの下書きが生成されます。
            </div>
          )}

          {!isGenerating && record && (
            <div>
              {CATEGORY_META.map((m) => {
                const value = record[m.key as CategoryKey];
                const filled = value.trim().length > 0;
                return (
                  <div key={recordSeq + "-" + m.key} className={styles.field}>
                    <div className={styles.fieldHead}>
                      <span className={styles.fieldName}>{m.label}</span>
                      <div className={styles.fieldHeadRight}>
                        <span className={styles.badge + " " + (filled ? styles.badgeAuto : styles.badgeNone)}>
                          {filled ? "自動分類" : "該当なし"}
                        </span>
                        <button
                          type="button"
                          className={styles.btn + " " + styles.copyBtn}
                          onClick={(e) => copyField(fieldRefs.current[m.key]?.textContent?.trim() ?? "", e.currentTarget)}
                        >
                          📋 コピー
                        </button>
                      </div>
                    </div>
                    <div
                      ref={(el) => {
                        fieldRefs.current[m.key] = el;
                      }}
                      className={styles.fieldBody}
                      contentEditable
                      suppressContentEditableWarning
                      role="textbox"
                      aria-multiline="true"
                      aria-label={m.label + "の下書き"}
                    >
                      {value}
                    </div>
                  </div>
                );
              })}

              {incidentMismatches.length > 0 && (
                <div className={styles.mismatchCallout}>
                  ⚠ 機械チェック: 原文に事故・ヒヤリハット関連の語を含む文がありますが、特記事項欄に見当たりません。転記漏れがないか確認してください:
                  <ul>
                    {incidentMismatches.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.uncertainNotes.length > 0 && (
                <div className={styles.uncertainCallout}>
                  ⚠ AIがどの項目にも自信を持って分類できなかった文が{record.uncertainNotes.length}件あります。手動で該当項目に振り分けてください:
                  <ul>
                    {record.uncertainNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className={styles.disclosure} style={{ marginTop: 32 }}>
        <span className={styles.disclosureDot} />
        <div>
          <p>
            <strong>この体験版について</strong>:
            実際に OpenAI の生成AIモデル(gpt-4o-mini)を呼び出し、自由に書いた・話した文章を6項目に振り分けます。保存・ログイン後の施設共有は含みません(それらは Supabase を使う本番アプリ側の機能です)。
          </p>
          <p>
            <strong>AIは間違えます。直す前提で作っています</strong>:
            項目の振り分け誤りは起こります。だから全項目をその場で直接書き換えられるようにし、判断に迷った文はAIが自分で切り出して下に残します。
          </p>
        </div>
      </div>
    </div>
  );
}
