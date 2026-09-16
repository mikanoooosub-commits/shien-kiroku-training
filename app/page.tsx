"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import styles from "./page.module.css";
import {
  ApiResponseSchema,
  CATEGORY_META,
  type CategoryKey,
  type SavedRecord,
  type StructuredRecord,
} from "./record";
import { deleteRecord, loadRecords, saveRecord } from "./records";
import { createFacility, getMyFacility, inviteMember, type Facility } from "./facility";
import { createChild, enrollmentYearForGrade, GRADE_OPTIONS, gradeLabel, listChildren, type Child } from "./children";
import { createClient } from "./supabase-browser";

// このページはユーザーごとのセッション・施設・記録に依存し、共有可能な静的コンテンツを持たないため、
// ビルド時の静的プリレンダリングを行わない(セッション状態はクライアント側でuseEffect後に読み込む)。
export const dynamic = "force-dynamic";

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 今日の日付(yyyy-mm-dd)。記録日入力のデフォルト値に使う。 */
function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 「特記事項が空欄」は、実際には「該当なし」と「AIが見落とした」を画面上区別できない。
 * 実測(2026-09-10)で、ヒヤリハットを含む文がAIによって活動内容側にのみ計上され、
 * incidentが「該当なし」・uncertainNotesも空のまま返ってきたことがあった(docs/issue-log.md ISSUE-001)。
 * プロンプト指示だけでは確率的に見落としが起こり得るため、原文側からも独立にキーワードで洗い出し、
 * 見落としを検知可能にする軽い安全網として置く。
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

/** 原文中の安全関連の文で、incident にも uncertainNotes にも反映されていないものを洗い出す。 */
function findIncidentMismatches(sourceText: string, record: StructuredRecord): string[] {
  return splitSentences(sourceText).filter((sentence) => {
    const isIncidentLike = INCIDENT_KEYWORDS.some((kw) => sentence.includes(kw));
    if (!isIncidentLike) return false;
    const alreadyCaptured =
      record.incident.includes(sentence) || record.uncertainNotes.some((note) => note.includes(sentence));
    return !alreadyCaptured;
  });
}

/** 同じ児童の、指定日より前で最も新しい保存済み記録(直近の記録)。無ければ null。 */
function findPreviousRecord(
  saved: SavedRecord[],
  childId: string,
  recordDate: string,
  excludeId: string | null
): SavedRecord | null {
  const candidates = saved
    .filter((r) => r.childId === childId && r.id !== excludeId && r.recordDate < recordDate)
    .sort((a, b) => (a.recordDate < b.recordDate ? 1 : a.recordDate > b.recordDate ? -1 : 0));
  return candidates[0] ?? null;
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

export default function Home() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [userEmail, setUserEmail] = useState<string | null>(null);

  // 施設(施設単位で記録を共有する)。undefined=読み込み中、null=未所属。
  const [facility, setFacility] = useState<Facility | null | undefined>(undefined);
  const [facilityError, setFacilityError] = useState<string | null>(null);
  const [newFacilityName, setNewFacilityName] = useState("");
  const [creatingFacility, setCreatingFacility] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [sampleIdx, setSampleIdx] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<StructuredRecord | null>(null);
  const [incidentMismatches, setIncidentMismatches] = useState<string[]>([]);
  const [micSupported, setMicSupported] = useState(true);
  const [recording, setRecording] = useState(false);

  // 保存(Supabase。facility単位で共有)
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState<SavedRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  // 編集内容はDOM側にあるため、保存済み記録を読み込んだときは項目を作り直して確実に反映させる。
  const [recordSeq, setRecordSeq] = useState(0);

  // 児童マスタ(施設単位・仮名運用)。記録が「誰の」ものかを持たせるため保存時に必須で選ぶ。
  const [children, setChildren] = useState<Child[]>([]);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [childId, setChildId] = useState<string>("");
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChildNickname, setNewChildNickname] = useState("");
  // 「入学年度」の暗算をスタッフに強いない・書き忘れで意図せず「小1」になることを防ぐため、
  // 入学年度ではなく現在の学年を選んでもらい、入学年度はそこから逆算する(未選択がデフォルト)。
  const [newChildGrade, setNewChildGrade] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [addChildError, setAddChildError] = useState<string | null>(null);

  // 記録対象日(「いつの記録か」。保存日時とは別で、過去日も指定できる)。
  const [recordDate, setRecordDate] = useState(() => todayStr());

  // 同じ児童の直近の記録(健康面)をAIへの参考情報として渡すかどうか。デフォルトON。
  // 事故など特別な出来事があった日に、過去の情報が記録の焦点をぼかす場合の逃げ道として、生成前にOFFにできる。
  const [referencePrevious, setReferencePrevious] = useState(true);

  // 保存済み記録一覧の絞り込み(児童・日付)。
  const [filterChildId, setFilterChildId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // 印刷: 画面のボタン経由でもブラウザのCtrl+P経由でも、出力日時が入るようにする。
  const [printedAt, setPrintedAt] = useState("");

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
      // Feature detection must run post-hydration (window is undefined during SSR),
      // so this state update can only happen here, one render after the optimistic default.
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

  // ログインユーザー・所属施設・施設の記録一覧を読み込む。
  useEffect(() => {
    let active = true;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      setUserEmail(userData.user?.email ?? null);

      const facilityResult = await getMyFacility(supabase);
      if (!active) return;
      if (!facilityResult.ok) {
        setFacilityError(facilityResult.reason);
        setFacility(null);
        return;
      }
      setFacility(facilityResult.value);
      if (!facilityResult.value) return;

      const recordsResult = await loadRecords(supabase, facilityResult.value.id);
      if (!active) return;
      if (recordsResult.ok) setSaved(recordsResult.value);
      else setStorageNote(recordsResult.reason);

      const childrenResult = await listChildren(supabase, facilityResult.value.id);
      if (!active) return;
      if (childrenResult.ok) setChildren(childrenResult.value);
      else setChildrenError(childrenResult.reason);
    })();

    return () => {
      active = false;
    };
    // supabase は useState(() => createClient()) で一度だけ作られ、以降参照が変わらないため deps 不要。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 印刷ダイアログが開く直前に出力日時を確定させる。ブラウザのCtrl+Pから印刷された場合もここを通る。
    const onBeforePrint = () => {
      flushSync(() => setPrintedAt(formatSavedAt(new Date().toISOString())));
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleCreateFacility(e: React.FormEvent) {
    e.preventDefault();
    const name = newFacilityName.trim();
    if (!name) return;
    setCreatingFacility(true);
    setFacilityError(null);
    try {
      const result = await createFacility(supabase, name);
      if (!result.ok) {
        setFacilityError(result.reason);
        return;
      }
      setFacility(result.value);
    } finally {
      setCreatingFacility(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!facility) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    setInviteNotice(null);
    try {
      const result = await inviteMember(supabase, facility.id, email);
      setInviteNotice(result.ok ? `${email} を招待しました。` : `⚠ ${result.reason}`);
      if (result.ok) setInviteEmail("");
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleCreateChild(e: React.FormEvent) {
    e.preventDefault();
    if (!facility) return;
    const nickname = newChildNickname.trim();
    const grade = Number(newChildGrade);
    if (!nickname || newChildGrade === "" || !Number.isFinite(grade)) return;
    const enrollmentYear = enrollmentYearForGrade(grade);
    setAddingChild(true);
    setAddChildError(null);
    try {
      const result = await createChild(supabase, facility.id, nickname, enrollmentYear);
      if (!result.ok) {
        setAddChildError(result.reason);
        return;
      }
      setChildren((prev) => [...prev, result.value].sort((a, b) => a.nickname.localeCompare(b.nickname, "ja")));
      setChildId(result.value.id);
      setNewChildNickname("");
      setShowAddChild(false);
    } finally {
      setAddingChild(false);
    }
  }

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
    setLabel("");
    setActiveId(null);
    setSaveFlash(null);
    setChildId("");
    setRecordDate(todayStr());
  }

  async function handleGenerate() {
    const trimmed = text.trim();
    if (!trimmed || !childId) return;
    setIsGenerating(true);
    setError(null);
    setRecord(null);
    setSaveFlash(null);
    try {
      const previousRecord = referencePrevious ? findPreviousRecord(saved, childId, recordDate, activeId) : null;
      const res = await fetch("/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          previousHealthNote: previousRecord
            ? { recordDate: previousRecord.recordDate, health: previousRecord.record.health }
            : null,
        }),
      });
      // 自前のAPIでもネットワークを跨ぐ以上、型注釈ではなく実際に形を検証してから使う。
      const parsed = ApiResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new Error("サーバーの応答形式が想定と異なります。");
      }
      if (!res.ok || !parsed.data.record) {
        throw new Error(parsed.data.error ?? "AIの下書き生成に失敗しました。");
      }
      setRecord(parsed.data.record);
      setIncidentMismatches(findIncidentMismatches(trimmed, parsed.data.record));
      setActiveId(null);
      setRecordSeq((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "予期しないエラーが発生しました。");
    } finally {
      setIsGenerating(false);
    }
  }

  /** 画面上で編集された内容はDOM側にあるので、保存時にそこから取り直す。 */
  function harvest(base: StructuredRecord): StructuredRecord {
    const next: StructuredRecord = { ...base };
    for (const m of CATEGORY_META) {
      const el = fieldRefs.current[m.key];
      if (el) next[m.key] = el.textContent?.trim() ?? "";
    }
    return next;
  }

  async function handleSave() {
    if (!record || !facility || !childId) return;
    const entry: SavedRecord = {
      id: activeId ?? newId(),
      savedAt: new Date().toISOString(),
      label: label.trim(),
      sourceText: text.trim(),
      record: harvest(record),
      childId,
      recordDate,
    };
    setSaveBusy(true);
    try {
      const result = await saveRecord(supabase, facility.id, entry);
      if (!result.ok) {
        setStorageNote(result.reason);
        return;
      }
      const refreshed = await loadRecords(supabase, facility.id);
      if (refreshed.ok) setSaved(refreshed.value);
      setActiveId(entry.id);
      setStorageNote(null);
      setSaveFlash(formatSavedAt(entry.savedAt) + " に保存しました");
    } finally {
      setSaveBusy(false);
    }
  }

  function handleLoad(entry: SavedRecord) {
    setText(entry.sourceText);
    setRecord(entry.record);
    setIncidentMismatches(findIncidentMismatches(entry.sourceText, entry.record));
    setLabel(entry.label);
    setActiveId(entry.id);
    setChildId(entry.childId ?? "");
    setRecordDate(entry.recordDate);
    setError(null);
    setSaveFlash(null);
    setRecordSeq((n) => n + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(entry: SavedRecord) {
    if (!facility) return;
    const name = entry.label || "(見出しなし)";
    const when = formatSavedAt(entry.savedAt);
    if (!window.confirm(when + " の記録「" + name + "」を削除します。元に戻せません。よろしいですか?")) {
      return;
    }
    const result = await deleteRecord(supabase, entry.id);
    if (!result.ok) {
      setStorageNote(result.reason);
      return;
    }
    const refreshed = await loadRecords(supabase, facility.id);
    if (refreshed.ok) setSaved(refreshed.value);
    if (activeId === entry.id) setActiveId(null);
  }

  function handlePrint() {
    // 出力日時は beforeprint ハンドラ側で入る。
    window.print();
  }

  function copyField(key: CategoryKey, btn: HTMLButtonElement) {
    const value = fieldRefs.current[key]?.textContent?.trim() ?? "";
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

  const charCount = text.length;
  const childById = new Map(children.map((c) => [c.id, c]));
  const filteredSaved = saved.filter((entry) => {
    if (filterChildId && entry.childId !== filterChildId) return false;
    if (filterDateFrom && entry.recordDate < filterDateFrom) return false;
    if (filterDateTo && entry.recordDate > filterDateTo) return false;
    return true;
  });

  // 施設に未所属の場合は、施設の作成を促す画面だけを表示する。
  if (facility === null) {
    return (
      <div className={styles.wrap} style={{ maxWidth: 480, paddingTop: 80 }}>
        <header className={styles.masthead} style={{ border: "none", marginBottom: 24 }}>
          <div>
            <p className={styles.eyebrow}>PoC Prototype · 本番構成</p>
            <h1 className={styles.title}>施設を作成してください</h1>
            <p className={styles.dek}>
              記録は施設単位でスタッフ間に共有されます。まずご自身の施設を作成してください(あとで他のスタッフを招待できます)。
            </p>
          </div>
        </header>
        <form onSubmit={handleCreateFacility} className={styles.panel}>
          {facilityError && <div className={styles.errorCallout}>⚠ {facilityError}</div>}
          <label htmlFor="facilityName" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
            施設名
          </label>
          <input
            id="facilityName"
            className={styles.labelInput}
            style={{ width: "100%", marginBottom: 16 }}
            value={newFacilityName}
            onChange={(e) => setNewFacilityName(e.target.value)}
            placeholder="例: 板橋区放課後等デイサービス〇〇"
            required
          />
          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPrimary}`}
            style={{ width: "100%" }}
            disabled={creatingFacility}
          >
            {creatingFacility ? "作成中…" : "施設を作成する"}
          </button>
        </form>
        <p style={{ textAlign: "center", marginTop: 16 }}>
          <button type="button" className={styles.btn} onClick={handleSignOut}>
            ログアウト
          </button>
        </p>
      </div>
    );
  }

  if (facility === undefined) {
    return (
      <div className={styles.wrap} style={{ paddingTop: 80, textAlign: "center", color: "var(--ink-faint)" }}>
        読み込み中…
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.masthead + " " + styles.noPrint}>
        <div>
          <p className={styles.eyebrow}>PoC Prototype · 本番構成</p>
          <h1 className={styles.title}>AI記録支援</h1>
          <p className={styles.dek}>
            職員がその場で話した・書いた内容を、生成AI(OpenAI gpt-4o-mini)が6項目へ自動で振り分ける。
          </p>
        </div>
        <div className={styles.metaRow}>
          <span>施設: {facility.name}</span>
          <span>{userEmail ?? ""}</span>
          <button type="button" className={styles.btn} onClick={handleSignOut}>
            ログアウト
          </button>
        </div>
      </header>

      <div className={styles.bench}>
        <section className={styles.panel + " " + styles.noPrint}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>1. 職員の入力</span>
            <span className={styles.panelSub}>Input</span>
          </div>

          <p className={styles.inputNotice} style={{ margin: 0 }}>
            児童も<strong>仮名・ニックネーム</strong>で登録してください(本名や個人を特定できる情報は入力しないでください)。
          </p>
          <div className={styles.saveBar} style={{ marginTop: 8, paddingTop: 0, borderTop: "none" }}>
            <select
              className={styles.labelInput}
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              aria-label="対象児童"
            >
              <option value="">対象児童を選択…</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname}({gradeLabel(c.enrollmentYear)})
                </option>
              ))}
            </select>
            <input
              className={styles.labelInput}
              type="date"
              value={recordDate}
              onChange={(e) => setRecordDate(e.target.value)}
              aria-label="記録対象日"
            />
            <button type="button" className={styles.btn} onClick={() => setShowAddChild((v) => !v)}>
              {showAddChild ? "キャンセル" : "+ 児童を追加"}
            </button>
          </div>
          {children.length === 0 && !showAddChild && (
            <p className={styles.archiveNote} style={{ margin: 0 }}>
              まだ児童が登録されていません。「+ 児童を追加」から登録してください。
            </p>
          )}
          {childrenError && <div className={styles.errorCallout}>⚠ {childrenError}</div>}
          {showAddChild && (
            <form
              onSubmit={handleCreateChild}
              className={styles.saveBar}
              style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}
            >
              <input
                className={styles.labelInput}
                type="text"
                value={newChildNickname}
                onChange={(e) => setNewChildNickname(e.target.value)}
                placeholder="ニックネーム(例: れんくん)"
                aria-label="児童のニックネーム"
                required
              />
              <select
                className={styles.labelInput}
                value={newChildGrade}
                onChange={(e) => setNewChildGrade(e.target.value)}
                aria-label="現在の学年"
                required
              >
                <option value="">現在の学年を選択…</option>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <button type="submit" className={styles.btn + " " + styles.btnPrimary} disabled={addingChild}>
                {addingChild ? "登録中…" : "登録"}
              </button>
            </form>
          )}
          {addChildError && <div className={styles.errorCallout}>⚠ {addChildError}</div>}

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={referencePrevious}
              onChange={(e) => setReferencePrevious(e.target.checked)}
            />
            過去の記録を参照する(同じ児童の直近の健康面の記述をAIへの参考情報として渡します)
          </label>

          <p className={styles.inputNotice}>
            児童は<strong>仮名・ニックネーム</strong>で入力してください(本名や個人を特定できる情報は入力しないでください)。
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
              disabled={isGenerating || !text.trim() || !childId}
              title={!childId ? "先に対象児童を選択してください" : undefined}
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
          <div className={styles.panelHead + " " + styles.noPrint}>
            <span className={styles.panelTitle}>2. AIアウトプット</span>
            <span className={styles.panelSub}>Output · 6項目</span>
          </div>

          <div className={styles.printHeader}>
            <h2>支援記録(AI下書き・職員確認済み)</h2>
            <p>
              利用者: {label || "(未記入)"} ／ 出力日時: {printedAt}
            </p>
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
                const value = record[m.key];
                const filled = value.trim().length > 0;
                return (
                  <div key={recordSeq + "-" + m.key} className={styles.field}>
                    <div className={styles.fieldHead}>
                      <span className={styles.fieldName}>{m.label}</span>
                      <div className={styles.fieldHeadRight + " " + styles.noPrint}>
                        <span className={styles.badge + " " + (filled ? styles.badgeAuto : styles.badgeNone)}>
                          {filled ? "自動分類" : "該当なし"}
                        </span>
                        <button
                          type="button"
                          className={styles.btn + " " + styles.copyBtn}
                          onClick={(e) => copyField(m.key, e.currentTarget)}
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
                  <span className={styles.noPrint}>
                    ⚠ 機械チェック: 原文に事故・ヒヤリハット関連の語を含む文がありますが、特記事項欄に見当たりません。転記漏れがないか確認してください:
                  </span>
                  <span className={styles.printOnly}>特記事項への転記漏れの可能性(機械チェック):</span>
                  <ul>
                    {incidentMismatches.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.uncertainNotes.length > 0 && (
                <div className={styles.uncertainCallout}>
                  {/* 画面では職員への作業指示、紙の記録では「未分類のまま残した原文」という位置づけになる。 */}
                  <span className={styles.noPrint}>
                    ⚠ AIがどの項目にも自信を持って分類できなかった文が{record.uncertainNotes.length}件あります。手動で該当項目に振り分けてください:
                  </span>
                  <span className={styles.printOnly}>未分類のメモ(原文のまま):</span>
                  <ul>
                    {record.uncertainNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className={styles.archiveNote + " " + styles.noPrint} style={{ margin: 0 }}>
                対象: {childId ? childById.get(childId)?.nickname ?? "?" : "未選択"}
                {childId && childById.get(childId) ? `(${gradeLabel(childById.get(childId)!.enrollmentYear)})` : ""}
                ・記録日 {recordDate}
                {referencePrevious ? "・過去記録を参照" : "・過去記録は参照しない"}
              </p>

              <div className={styles.saveBar + " " + styles.noPrint}>
                <input
                  className={styles.labelInput}
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="利用者名・日付などの見出し(任意)"
                  aria-label="保存する記録の見出し"
                />
                <button
                  type="button"
                  className={styles.btn + " " + styles.btnPrimary}
                  onClick={handleSave}
                  disabled={saveBusy || !childId}
                  title={!childId ? "先に対象児童を選択してください" : undefined}
                >
                  {saveBusy ? "保存中…" : activeId ? "上書き保存" : "この記録を保存"}
                </button>
                <button type="button" className={styles.btn} onClick={handlePrint}>
                  🖨 印刷 / PDF出力
                </button>
              </div>
              {saveFlash && <p className={styles.saveFlash + " " + styles.noPrint}>✓ {saveFlash}</p>}
              {storageNote && <div className={styles.errorCallout + " " + styles.noPrint}>⚠ {storageNote}</div>}
            </div>
          )}
        </section>
      </div>

      <section className={styles.archive + " " + styles.noPrint}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>3. 保存した記録</span>
          <span className={styles.panelSub}>Archive · {facility.name} 内 {saved.length}件</span>
        </div>
        <p className={styles.archiveNote}>
          保存先はSupabase(施設単位で共有)です。同じ施設のスタッフは全員この一覧を見られます。
        </p>

        <div className={styles.saveBar} style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
          <select
            className={styles.labelInput}
            value={filterChildId}
            onChange={(e) => setFilterChildId(e.target.value)}
            aria-label="児童で絞り込み"
          >
            <option value="">児童で絞り込み: すべて</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}({gradeLabel(c.enrollmentYear)})
              </option>
            ))}
          </select>
          <input
            className={styles.labelInput}
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            aria-label="この日以降(絞り込み)"
            title="この日以降"
          />
          <span aria-hidden="true">〜</span>
          <input
            className={styles.labelInput}
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            aria-label="この日以前(絞り込み)"
            title="この日以前"
          />
          {(filterChildId || filterDateFrom || filterDateTo) && (
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setFilterChildId("");
                setFilterDateFrom("");
                setFilterDateTo("");
              }}
            >
              絞り込みを解除
            </button>
          )}
        </div>

        {saved.length === 0 ? (
          <div className={styles.emptyState}>
            まだ保存された記録はありません。上のドラフトを確認・修正してから「この記録を保存」を押してください。
          </div>
        ) : filteredSaved.length === 0 ? (
          <div className={styles.emptyState}>絞り込み条件に一致する記録がありません。</div>
        ) : (
          <ul className={styles.archiveList}>
            {filteredSaved.map((entry) => {
              const summary = entry.record.activity || entry.sourceText;
              const child = entry.childId ? childById.get(entry.childId) : undefined;
              return (
                <li
                  key={entry.id}
                  className={styles.archiveItem + " " + (entry.id === activeId ? styles.archiveItemActive : "")}
                >
                  <div className={styles.archiveMain}>
                    <div className={styles.archiveHead}>
                      <span className={styles.archiveLabel}>{entry.label || "(見出しなし)"}</span>
                      <span className={styles.archiveTime}>
                        {child ? `${child.nickname}(${gradeLabel(child.enrollmentYear)})` : "対象児童未設定"} ·{" "}
                        {entry.recordDate} 記録 · 保存 {formatSavedAt(entry.savedAt)}
                      </span>
                    </div>
                    <p className={styles.archiveSummary}>{summary.slice(0, 90) || "(本文なし)"}</p>
                  </div>
                  <div className={styles.archiveActions}>
                    <button
                      type="button"
                      className={styles.btn + " " + styles.copyBtn}
                      onClick={() => handleLoad(entry)}
                    >
                      開く
                    </button>
                    <button
                      type="button"
                      className={styles.btn + " " + styles.copyBtn}
                      onClick={() => handleDelete(entry)}
                    >
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={handleInvite} className={styles.saveBar} style={{ marginTop: 20 }}>
          <input
            className={styles.labelInput}
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="招待するスタッフのメールアドレス(サインアップ済みの人のみ)"
            aria-label="招待するスタッフのメールアドレス"
          />
          <button type="submit" className={styles.btn} disabled={inviteBusy}>
            {inviteBusy ? "招待中…" : "施設に招待"}
          </button>
        </form>
        {inviteNotice && <p className={styles.saveFlash} style={{ marginTop: 8 }}>{inviteNotice}</p>}
      </section>

      {/* 毎日使う画面なので、説明は作業導線(入力→出力→保存)の下に置く。 */}
      <div className={styles.disclosure + " " + styles.noPrint} style={{ marginTop: 32, marginBottom: 0 }}>
        <span className={styles.disclosureDot} />
        <div>
          <p>
            <strong>この画面でできること</strong>:
            実際に OpenAI の生成AIモデル(gpt-4o-mini)を呼び出し、自由に書いた・話した文章を6項目に振り分けます(キーワード照合の簡易版ではありません)。作った記録は同じ施設のスタッフ全員で共有されます(Supabase・RLSで施設外からは見えません)。
          </p>
          <p>
            <strong>AIは間違えます。直す前提で作っています</strong>:
            音声の聞き取り誤りも、項目の振り分け誤りも起こります。だから全項目をその場で直接書き換えられるようにし、判断に迷った文はAIが自分で切り出して下に残します。<strong>直す手間が小さいこと</strong>を設計の中心に置いています。
          </p>
          <p>
            <strong>まだ検証できていないこと</strong>:
            児童の健康情報等を扱うため、本番導入前に個人情報保護・データ送信先(OpenAI社・Supabase社)の要件確認が必要です(<code>poc-spec.html</code> §7)。PoC期間中はダミーデータで検証します。
          </p>
        </div>
      </div>

      <footer className={styles.pageFooter + " " + styles.noPrint}>
        <p>各項目は生成後も直接クリックして編集でき、項目ごとにコピーして既存の記録(紙・カイポケ・HUG等)へ貼り付けられます。</p>
        <p>
          分類ロジック・カテゴリ定義の根拠: <code>poc-spec.html</code> §1〜2、競合ソフトの機能ギャップは <code>sources.competitor-tools.md</code> を参照。
        </p>
      </footer>
    </div>
  );
}
