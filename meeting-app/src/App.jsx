import { useState, useRef, useEffect, useCallback } from "react";

// ── API helper — calls our own backend, not Anthropic directly ──
async function callClaude(userMsg, systemMsg) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMsg, systemMsg }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

// ── Feature definitions ──────────────────────────────────────
const FEATURES = [
  {
    id: "jp-zh",
    icon: "🎙️",
    title: "JP → CN\nLive Translate",
    desc: "Real-time Japanese speech to Chinese",
    gradient: "linear-gradient(135deg, #6366f1 0%, #22d3ee 100%)",
    glow: "#6366f1",
    tag: "meeting",
    hasMic: true,
  },
  {
    id: "jp-en",
    icon: "🌐",
    title: "JP → EN\nLive Translate",
    desc: "Real-time Japanese speech to English",
    gradient: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
    glow: "#a855f7",
    tag: "meeting",
    hasMic: true,
  },
  {
    id: "meeting-notes",
    icon: "📋",
    title: "Meeting\nMinutes",
    desc: "Auto-generate structured meeting notes",
    gradient: "linear-gradient(135deg, #10b981 0%, #5eead4 100%)",
    glow: "#10b981",
    tag: "meeting",
    hasMic: true,
  },
  {
    id: "video-zh",
    icon: "🎬",
    title: "Video EN\nTranscribe",
    desc: "English audio to text & translation",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)",
    glow: "#f59e0b",
    tag: "learning",
    hasMic: true,
  },
  {
    id: "study-notes",
    icon: "📚",
    title: "Study\nNotes",
    desc: "Auto-generate structured study notes",
    gradient: "linear-gradient(135deg, #f43f5e 0%, #fb7185 100%)",
    glow: "#f43f5e",
    tag: "learning",
    hasMic: false,
  },
  {
    id: "vocab",
    icon: "🔤",
    title: "Vocab\nLookup",
    desc: "Look up words from subtitles instantly",
    gradient: "linear-gradient(135deg, #06b6d4 0%, #67e8f9 100%)",
    glow: "#06b6d4",
    tag: "learning",
    hasMic: false,
  },
];

// ── useSpeechRecognition ─────────────────────────────────────
function useSpeechRecognition({ lang, onResult, onEnd }) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const accumulatedRef = useRef("");
  // latest interim (not-yet-finalized) text. On mobile a session can end while
  // text is still interim; we flush it into the accumulator so it isn't lost.
  const interimRef = useRef("");
  // intent flag: true while the user wants to keep recording. On mobile the
  // engine auto-stops after a short silence, so we auto-restart while this is set.
  const wantRef = useRef(false);
  // keep latest callbacks in refs so the effect doesn't need them as deps
  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);
  onResultRef.current = onResult;
  onEndRef.current = onEnd;

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "", finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) accumulatedRef.current += finalChunk;
      interimRef.current = interim;
      onResultRef.current({ interim, accumulated: accumulatedRef.current, finalChunk });
    };
    // commit any still-interim text so session boundaries don't drop words
    const flushInterim = () => {
      if (interimRef.current.trim()) {
        const flushed = interimRef.current.trim();
        accumulatedRef.current += (accumulatedRef.current ? " " : "") + flushed;
        interimRef.current = "";
        onResultRef.current({ interim: "", accumulated: accumulatedRef.current, finalChunk: flushed });
      }
    };
    rec.onend = () => {
      flushInterim();
      // Mobile browsers end the session on silence. If the user still wants to
      // record, restart instead of finishing — this keeps it "continuous".
      if (wantRef.current) {
        try { rec.start(); return; } catch { /* fall through to stop */ }
      }
      setListening(false);
      onEndRef.current(accumulatedRef.current);
    };
    rec.onerror = (e) => {
      // "no-speech"/"aborted" are recoverable — let onend auto-restart handle it.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        setListening(false);
      }
    };
    recRef.current = rec;
    return () => { wantRef.current = false; try { rec.stop(); } catch {} };
  }, [lang]);

  const start = useCallback(() => {
    accumulatedRef.current = "";
    interimRef.current = "";
    wantRef.current = true;
    try { recRef.current?.start(); } catch {}
    setListening(true);
  }, []);
  const stop = useCallback(() => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch {}
    setListening(false);
  }, []);
  return { listening, supported, start, stop };
}

// ── Shared UI ────────────────────────────────────────────────
function MicButton({ listening, onStart, onStop, glow, disabled }) {
  return (
    <button onClick={listening ? onStop : onStart} disabled={disabled} style={{
      width: 88, height: 88, borderRadius: "50%",
      background: listening ? `radial-gradient(circle, ${glow}ee, ${glow}66)` : "rgba(255,255,255,0.04)",
      backdropFilter: "blur(12px)",
      border: `2px solid ${listening ? glow : "rgba(255,255,255,0.12)"}`,
      cursor: disabled ? "not-allowed" : "pointer", fontSize: 34,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: listening ? `0 0 40px ${glow}aa, 0 0 80px ${glow}55, inset 0 0 20px ${glow}44` : `0 8px 32px rgba(0,0,0,0.4)`,
      transition: "all 0.3s", animation: listening ? "micPulse 1.5s ease-in-out infinite" : "none",
    }}>
      {listening ? "⏹" : "🎤"}
      <style>{`@keyframes micPulse{0%,100%{box-shadow:0 0 40px ${glow}aa,0 0 80px ${glow}55,inset 0 0 20px ${glow}44}50%{box-shadow:0 0 60px ${glow}ee,0 0 120px ${glow}77,inset 0 0 30px ${glow}66}}`}</style>
    </button>
  );
}

function Waveform({ active, glow }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 32 }}>
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: active ? glow : "rgba(255,255,255,0.12)", height: active ? undefined : 4,
          boxShadow: active ? `0 0 8px ${glow}` : "none",
          animation: active ? `bar${i % 4} ${0.6 + (i % 3) * 0.2}s ease-in-out infinite alternate` : "none",
          animationDelay: `${i * 0.06}s`, transition: "background 0.3s",
        }} />
      ))}
      <style>{`@keyframes bar0{from{height:4px}to{height:28px}}@keyframes bar1{from{height:6px}to{height:22px}}@keyframes bar2{from{height:8px}to{height:30px}}@keyframes bar3{from{height:4px}to{height:18px}}`}</style>
    </div>
  );
}

// glass card style helper
const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.045)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 18,
  ...extra,
});

function PageShell({ feature, onBack, children }) {
  return (
    <div style={{ minHeight: "100dvh", position: "relative", zIndex: 1, color: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <div style={{ ...glass({ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }), display: "flex", alignItems: "center", gap: 12, padding: "calc(14px + env(safe-area-inset-top)) 18px 14px", position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={onBack} style={{ ...glass({ borderRadius: 12 }), width: 38, height: 38, color: "#cbd5e1", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>←</button>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: feature.gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: `0 0 18px ${feature.glow}77` }}>{feature.icon}</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{feature.title.replace("\n", " ")}</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{feature.desc}</div>
        </div>
      </div>
      <div style={{ padding: "24px 18px 60px", maxWidth: 680, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function ResultBox({ content, label, accent, onDownload }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ ...glass({ borderColor: `${accent}44` }), marginTop: 18, overflow: "hidden", boxShadow: `0 0 30px ${accent}22` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: `${accent}18`, borderBottom: `1px solid ${accent}22` }}>
        <span style={{ fontSize: 12, color: accent, fontWeight: 700 }}>{label}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {onDownload && <button onClick={onDownload} style={{ background: "none", border: `1px solid ${accent}44`, color: accent, borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>↓ Download</button>}
          <button onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: "none", border: `1px solid ${accent}44`, color: accent, borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>{copied ? "✓ Copied" : "Copy"}</button>
        </div>
      </div>
      <pre style={{ margin: 0, padding: 16, color: "#e2e8f0", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "system-ui", maxHeight: 320, overflowY: "auto" }}>{content}</pre>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, label, accent, rows = 4 }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>{label}</div>}
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{ ...glass({ borderRadius: 14 }), width: "100%", boxSizing: "border-box", padding: 12, color: "#e2e8f0", fontSize: 14, lineHeight: 1.7, resize: "vertical", outline: "none", fontFamily: "system-ui", transition: "border-color 0.2s" }}
        onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.09)"} />
    </div>
  );
}

function ActionBtn({ onClick, loading, disabled, gradient, children }) {
  const off = disabled || loading;
  return (
    <button onClick={onClick} disabled={off} style={{ background: off ? "rgba(255,255,255,0.05)" : gradient, color: off ? "#64748b" : "#fff", border: "none", borderRadius: 14, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: off ? "not-allowed" : "pointer", transition: "all 0.2s", boxShadow: off ? "none" : "0 8px 24px rgba(0,0,0,0.3)" }}>
      {loading ? "⏳ AI working..." : children}
    </button>
  );
}

function MicSection({ listening, supported, start, stop, glow, accumulated, interim, label }) {
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 0" }}>
        <MicButton listening={listening} onStart={start} onStop={stop} glow={glow} disabled={!supported} />
        <Waveform active={listening} glow={glow} />
        <div style={{ fontSize: 13, color: listening ? glow : "#64748b", fontWeight: 600 }}>
          {!supported ? "⚠️ Please use Chrome browser" : listening ? "🔴 Recording... tap to stop" : label}
        </div>
      </div>
      {(accumulated || interim) && (
        <div style={{ ...glass({ borderRadius: 14 }), padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Recognized text</div>
          <div style={{ fontSize: 14, color: "#cbd5e1", lineHeight: 1.7, maxHeight: 160, overflowY: "auto" }}>
            {accumulated}<span style={{ color: "#475569" }}>{interim}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TabSwitch({ tab, setTab, glow }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
      {[{ v: "mic", l: "🎤 Microphone" }, { v: "manual", l: "⌨️ Manual input" }].map(t => (
        <button key={t.v} onClick={() => setTab(t.v)} style={{ ...glass({ borderRadius: 12 }), padding: "8px 18px", fontSize: 13, cursor: "pointer", background: tab === t.v ? `${glow}33` : "rgba(255,255,255,0.045)", borderColor: tab === t.v ? glow : "rgba(255,255,255,0.09)", color: tab === t.v ? glow : "#94a3b8", fontWeight: 600 }}>{t.l}</button>
      ))}
    </div>
  );
}

// ── Feature Pages ────────────────────────────────────────────
function TranslatePage({ feature, onBack }) {
  const isZh = feature.id === "jp-zh";
  const targetLabel = isZh ? "Chinese" : "English";
  const sys = isZh
    ? "你是专业日中同声传译员。将日文准确翻译成简体中文，保持自然流畅，专业术语准确。只输出翻译结果。"
    : "You are a professional Japanese-English interpreter. Translate Japanese to natural, accurate English. Output only the translation.";

  const [interim, setInterim] = useState("");
  const [accumulated, setAccumulated] = useState("");
  const [segments, setSegments] = useState([]); // live feed: {src, tr, time, pending}
  const [translation, setTranslation] = useState(""); // manual-mode single result
  const [translating, setTranslating] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [tab, setTab] = useState("mic");
  const [error, setError] = useState("");

  // ── live rolling translation buffer ──
  const pendingRef = useRef("");   // recognized JP text waiting to be translated
  const timerRef = useRef(null);
  const DEBOUNCE = 1400;           // translate a chunk after this pause (ms)

  const translateChunk = useCallback(async (text) => {
    const src = text.trim();
    if (!src) return;
    const id = Date.now() + Math.random();
    setSegments(s => [...s, { id, src, tr: "", time: new Date().toLocaleTimeString(), pending: true }]);
    try {
      const result = await callClaude(src, sys);
      setSegments(s => s.map(seg => seg.id === id ? { ...seg, tr: result, pending: false } : seg));
    } catch (e) {
      setSegments(s => s.map(seg => seg.id === id ? { ...seg, tr: "⚠️ " + e.message, pending: false } : seg));
    }
  }, [sys]);

  const flushPending = useCallback(() => {
    const text = pendingRef.current;
    pendingRef.current = "";
    if (text.trim()) translateChunk(text);
  }, [translateChunk]);

  const { listening, supported, start, stop } = useSpeechRecognition({
    lang: "ja-JP",
    onResult: ({ interim, accumulated, finalChunk }) => {
      setInterim(interim);
      setAccumulated(accumulated);
      if (finalChunk && finalChunk.trim()) {
        // buffer the new chunk, then translate it after a short pause
        pendingRef.current += finalChunk;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flushPending, DEBOUNCE);
      }
    },
    onEnd: () => {
      // translate whatever is left when recording stops
      if (timerRef.current) clearTimeout(timerRef.current);
      flushPending();
    },
  });

  // cleanup timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const startLive = () => { setSegments([]); setInterim(""); setAccumulated(""); pendingRef.current = ""; setError(""); start(); };

  const translateManual = async (text) => {
    setError(""); setTranslating(true);
    try {
      const result = await callClaude(text, sys);
      setTranslation(result);
    } catch (e) { setError("Translation failed: " + e.message); }
    setTranslating(false);
  };

  const fullText = segments.filter(s => s.tr && !s.pending).map(s => s.tr).join("\n");
  const download = () => {
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `translation_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 0" }}>
            <MicButton listening={listening} onStart={startLive} onStop={stop} glow={feature.glow} disabled={!supported} />
            <Waveform active={listening} glow={feature.glow} />
            <div style={{ fontSize: 13, color: listening ? feature.glow : "#64748b", fontWeight: 600, textAlign: "center" }}>
              {!supported ? "⚠️ Please use Chrome browser"
                : listening ? "🔴 Live translating... keep talking, tap to stop"
                : "Tap once — it translates as you speak, no need to hold"}
            </div>
          </div>

          {/* live recognized text (current line being heard) */}
          {(interim || (listening && !segments.length)) && (
            <div style={{ ...glass({ borderRadius: 14 }), padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Listening</div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{interim || "…"}</div>
            </div>
          )}

          {/* live translation feed */}
          {segments.length > 0 && (
            <div style={{ ...glass({ borderColor: `${feature.glow}44` }), overflow: "hidden", boxShadow: `0 0 30px ${feature.glow}22` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: `${feature.glow}18`, borderBottom: `1px solid ${feature.glow}22` }}>
                <span style={{ fontSize: 12, color: feature.glow, fontWeight: 700 }}>Live translation → {targetLabel}</span>
                {fullText && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={download} style={{ background: "none", border: `1px solid ${feature.glow}44`, color: feature.glow, borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>↓ Download</button>
                    <button onClick={() => navigator.clipboard.writeText(fullText)} style={{ background: "none", border: `1px solid ${feature.glow}44`, color: feature.glow, borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Copy all</button>
                  </div>
                )}
              </div>
              <div style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}>
                {segments.map(seg => (
                  <div key={seg.id} style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 3 }}>JP: {seg.src}</div>
                    <div style={{ fontSize: 15, color: seg.pending ? "#64748b" : "#e2e8f0", lineHeight: 1.6 }}>
                      {seg.pending ? "⏳ translating…" : seg.tr}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <TextInput value={manualInput} onChange={setManualInput} label="Enter Japanese text" accent={feature.glow} placeholder="Type Japanese here, e.g. 本日の会議を始めましょう。" rows={5} />
          <ActionBtn onClick={() => translateManual(manualInput)} loading={translating} disabled={!manualInput.trim()} gradient={feature.gradient}>
            ▶ Translate to {targetLabel}
          </ActionBtn>
          {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
          {translation && !translating && <ResultBox content={translation} label={`Translation → ${targetLabel}`} accent={feature.glow} />}
        </>
      )}
      {tab === "mic" && error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
    </PageShell>
  );
}

function MeetingNotesPage({ feature, onBack }) {
  const [accumulated, setAccumulated] = useState("");
  const [interim, setInterim] = useState("");
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState("mic");
  const [manualInput, setManualInput] = useState("");
  const [error, setError] = useState("");

  const { listening, supported, start, stop } = useSpeechRecognition({
    lang: "ja-JP",
    onResult: ({ interim, accumulated }) => { setInterim(interim); setAccumulated(accumulated); },
    onEnd: () => {},
  });

  const generate = async (text) => {
    if (!text.trim()) return;
    setError(""); setProcessing(true);
    try {
      const sys = `You are a professional meeting secretary. Generate structured English meeting minutes from the content:\n【Topic】\n【Participants】(if mentioned)\n【Key Points】(bulleted)\n【Decisions】\n【Action Items】(with owner & due date)\n【Follow-ups】\nBe concise and highlight key decisions and action items.`;
      const result = await callClaude(`Meeting content:\n${text}`, sys);
      setNotes(result);
    } catch (e) { setError("Generation failed: " + e.message); }
    setProcessing(false);
  };

  const download = () => {
    const blob = new Blob([notes], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `meeting_notes_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  const src = tab === "mic" ? accumulated : manualInput;
  return (
    <PageShell feature={feature} onBack={onBack}>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic"
        ? <MicSection listening={listening} supported={supported} start={start} stop={stop} glow={feature.glow} accumulated={accumulated} interim={interim} label="Record to capture the whole meeting" />
        : <TextInput value={manualInput} onChange={setManualInput} label="Paste meeting content" accent={feature.glow} placeholder={`Tanaka: Let's discuss the Q3 goals...\nLi: We need more marketing budget...\nDecision: submit the proposal next Friday...`} rows={7} />
      }
      <ActionBtn onClick={() => generate(src)} loading={processing} disabled={!src.trim()} gradient={feature.gradient}>📋 Generate Minutes</ActionBtn>
      {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
      {notes && <ResultBox content={notes} label="📋 Meeting Minutes" accent={feature.glow} onDownload={download} />}
    </PageShell>
  );
}

function VideoTranslatePage({ feature, onBack }) {
  const [accumulated, setAccumulated] = useState("");
  const [interim, setInterim] = useState("");
  const [output, setOutput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState("mic");
  const [manualInput, setManualInput] = useState("");
  const [mode, setMode] = useState("both");
  const [error, setError] = useState("");

  const { listening, supported, start, stop } = useSpeechRecognition({
    lang: "en-US",
    onResult: ({ interim, accumulated }) => { setInterim(interim); setAccumulated(accumulated); },
    onEnd: () => {},
  });

  const process = async (text) => {
    if (!text.trim()) return;
    setError(""); setProcessing(true);
    try {
      const sysMap = {
        both: `Process the English video content and output two parts:\n【Transcript】clean up the original text, fix grammar, add punctuation\n【Chinese Translation】accurate translation, keep technical terms in English with parentheses`,
        transcript: "Clean up the English speech into a clear transcript, fix grammar and add punctuation. Output only the English transcript.",
        translate: "Translate the English content into accurate Simplified Chinese. Output only the Chinese translation.",
      };
      const result = await callClaude(text, sysMap[mode]);
      setOutput(result);
    } catch (e) { setError("Processing failed: " + e.message); }
    setProcessing(false);
  };

  const src = tab === "mic" ? accumulated : manualInput;
  return (
    <PageShell feature={feature} onBack={onBack}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[{ v: "both", l: "Transcript + Translation" }, { v: "transcript", l: "Transcript only" }, { v: "translate", l: "Translation only" }].map(m => (
          <button key={m.v} onClick={() => setMode(m.v)} style={{ ...glass({ borderRadius: 10 }), padding: "6px 14px", fontSize: 12, cursor: "pointer", background: mode === m.v ? `${feature.glow}33` : "rgba(255,255,255,0.045)", borderColor: mode === m.v ? feature.glow : "rgba(255,255,255,0.09)", color: mode === m.v ? feature.glow : "#94a3b8" }}>{m.l}</button>
        ))}
      </div>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic"
        ? <MicSection listening={listening} supported={supported} start={start} stop={stop} glow={feature.glow} accumulated={accumulated} interim={interim} label="Tap, then play the video / speak English" />
        : <TextInput value={manualInput} onChange={setManualInput} label="Paste English subtitles or transcript" accent={feature.glow} placeholder="Paste English subtitle or speech content here..." rows={6} />
      }
      <ActionBtn onClick={() => process(src)} loading={processing} disabled={!src.trim()} gradient={feature.gradient}>🎬 Process</ActionBtn>
      {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
      {output && <ResultBox content={output} label="Result" accent={feature.glow} />}
    </PageShell>
  );
}

function StudyNotesPage({ feature, onBack }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [style, setStyle] = useState("structured");
  const [error, setError] = useState("");

  const styles = [{ v: "structured", l: "Structured" }, { v: "cornell", l: "Cornell" }, { v: "mindmap", l: "Mind map" }];

  const run = async () => {
    if (!input.trim()) return;
    setError(""); setProcessing(true);
    try {
      const sysMap = {
        structured: `Generate structured English study notes:\n【Core Concepts】key terms and definitions\n【Key Points】bulleted highlights (mark hard ones with ★)\n【Connections】how concepts relate\n【Memory Tips】mnemonics\n【Practice】3 review questions`,
        cornell: `Generate English study notes using the Cornell method:\n【Notes】detailed content\n【Cues】keywords and questions (under 15 words)\n【Summary】3-5 sentence core summary`,
        mindmap: `Organize into a text-based mind map of English notes, using indentation and symbols to show hierarchy, highlighting connections between core concepts.`,
      };
      const result = await callClaude(input, sysMap[style]);
      setOutput(result);
    } catch (e) { setError("Generation failed: " + e.message); }
    setProcessing(false);
  };

  const download = () => {
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `study_notes_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {styles.map(s => (
          <button key={s.v} onClick={() => setStyle(s.v)} style={{ ...glass({ borderRadius: 10 }), padding: "7px 14px", fontSize: 12, cursor: "pointer", background: style === s.v ? `${feature.glow}33` : "rgba(255,255,255,0.045)", borderColor: style === s.v ? feature.glow : "rgba(255,255,255,0.09)", color: style === s.v ? feature.glow : "#94a3b8" }}>{s.l}</button>
        ))}
      </div>
      <TextInput value={input} onChange={setInput} label="Paste study content (subtitles, textbook, class notes...)" placeholder="Paste study content..." accent={feature.glow} rows={7} />
      <ActionBtn onClick={run} loading={processing} disabled={!input.trim()} gradient={feature.gradient}>📚 Generate Notes</ActionBtn>
      {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
      {output && <ResultBox content={output} label={`📚 ${styles.find(s => s.v === style)?.l}`} accent={feature.glow} onDownload={download} />}
    </PageShell>
  );
}

function VocabPage({ feature, onBack }) {
  const [subtitle, setSubtitle] = useState("");
  const [word, setWord] = useState("");
  const [output, setOutput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [wordList, setWordList] = useState([]);
  const [error, setError] = useState("");

  const lookup = async () => {
    if (!word.trim()) return;
    setError(""); setProcessing(true);
    try {
      const sys = `You are a bilingual dictionary assistant. For the queried word provide:\n【Pronunciation】IPA 【Part of speech】 【Meaning】2-3 senses\n【Examples】typical usage (English + Chinese) 【Mnemonic】 【Synonyms】2-3\nKeep it concise for quick reference.`;
      const ctx = subtitle ? `Subtitle context: ${subtitle.slice(0, 200)}\n` : "";
      const result = await callClaude(`${ctx}Look up the word: ${word}`, sys);
      setOutput(result);
      setWordList(wl => wl.find(w => w.word === word) ? wl : [{ word, result }, ...wl.slice(0, 19)]);
    } catch (e) { setError("Lookup failed: " + e.message); }
    setProcessing(false);
  };

  const exportList = () => {
    const content = wordList.map(w => `【${w.word}】\n${w.result}\n${"─".repeat(40)}`).join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `vocab_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <TextInput value={subtitle} onChange={setSubtitle} label="Subtitle context (optional)" placeholder="Paste subtitle text here..." accent={feature.glow} rows={3} />
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Look up word</div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={word} onChange={e => setWord(e.target.value)} onKeyDown={e => e.key === "Enter" && lookup()} placeholder="Type a word, press Enter..."
            style={{ ...glass({ borderRadius: 12 }), flex: 1, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", fontFamily: "system-ui" }}
            onFocus={e => e.target.style.borderColor = feature.glow} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.09)"} />
          <ActionBtn onClick={lookup} loading={processing} disabled={!word.trim()} gradient={feature.gradient}>Search</ActionBtn>
        </div>
      </div>
      {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
      {output && <ResultBox content={output} label={`🔤 ${word}`} accent={feature.glow} />}
      {wordList.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Word list ({wordList.length})</span>
            <button onClick={exportList} style={{ background: "none", border: `1px solid ${feature.glow}44`, color: feature.glow, borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>↓ Export</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {wordList.map((w, i) => (
              <button key={i} onClick={() => { setWord(w.word); setOutput(w.result); }} style={{ ...glass({ borderRadius: 10 }), padding: "6px 14px", color: "#cbd5e1", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = feature.glow; e.currentTarget.style.color = feature.glow; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "#cbd5e1"; }}
              >{w.word}</button>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ── Home Screen ──────────────────────────────────────────────
function FeatureCard({ feature, onSelect }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={() => onSelect(feature.id)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ ...glass({ borderRadius: 22 }), position: "relative", overflow: "hidden", padding: "22px 12px 18px", cursor: "pointer", textAlign: "center", transform: hov ? "translateY(-4px) scale(1.03)" : "none", boxShadow: hov ? `0 16px 40px ${feature.glow}55, 0 0 0 1px ${feature.glow}66` : "0 8px 24px rgba(0,0,0,0.3)", transition: "all 0.25s ease" }}>
      <div style={{ position: "absolute", inset: 0, background: feature.gradient, opacity: hov ? 0.22 : 0, transition: "opacity 0.25s" }} />
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: 32, marginBottom: 10, lineHeight: 1, filter: `drop-shadow(0 0 12px ${feature.glow}88)` }}>{feature.icon}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: hov ? "#fff" : "#cbd5e1", lineHeight: 1.4, whiteSpace: "pre-line", transition: "color 0.25s" }}>{feature.title}</div>
        {feature.hasMic && <div style={{ marginTop: 8, fontSize: 10, color: hov ? "#ffffffcc" : "#475569" }}>🎤 voice</div>}
      </div>
    </button>
  );
}

function HomeScreen({ onSelect }) {
  return (
    <div style={{ minHeight: "100dvh", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "max(36px, env(safe-area-inset-top)) 20px 48px", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: 38 }}>
        <div style={{ fontSize: 48, marginBottom: 10, filter: "drop-shadow(0 0 24px #818cf8cc)" }}>✨</div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.5, background: "linear-gradient(135deg,#a5b4fc,#67e8f9,#f0abfc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Meeting & Learning AI</h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "#64748b" }}>Translate · Transcribe · Take notes</p>
      </div>
      <div style={{ width: "100%", maxWidth: 520, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#818cf8", letterSpacing: 2, fontWeight: 700, marginBottom: 12, paddingLeft: 4 }}>MEETING</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {FEATURES.filter(f => f.tag === "meeting").map(f => <FeatureCard key={f.id} feature={f} onSelect={onSelect} />)}
        </div>
      </div>
      <div style={{ width: "100%", maxWidth: 520, height: 1, background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)", margin: "26px 0" }} />
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ fontSize: 11, color: "#67e8f9", letterSpacing: 2, fontWeight: 700, marginBottom: 12, paddingLeft: 4 }}>LEARNING</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {FEATURES.filter(f => f.tag === "learning").map(f => <FeatureCard key={f.id} feature={f} onSelect={onSelect} />)}
        </div>
      </div>
      <p style={{ marginTop: 44, fontSize: 11, color: "#334155" }}>Powered by Claude AI</p>
    </div>
  );
}

// ── Animated dreamy background ───────────────────────────────
function Background() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", background: "radial-gradient(ellipse at top, #1a1340 0%, #0a0a1f 55%, #05050f 100%)" }}>
      <div style={{ position: "absolute", top: "-12%", left: "-8%", width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, #6366f1aa, transparent 70%)", filter: "blur(60px)", animation: "float1 16s ease-in-out infinite" }} />
      <div style={{ position: "absolute", top: "30%", right: "-12%", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, #a855f799, transparent 70%)", filter: "blur(70px)", animation: "float2 20s ease-in-out infinite" }} />
      <div style={{ position: "absolute", bottom: "-15%", left: "20%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, #06b6d488, transparent 70%)", filter: "blur(65px)", animation: "float3 18s ease-in-out infinite" }} />
      <style>{`
        @keyframes float1{0%,100%{transform:translate(0,0)}50%{transform:translate(60px,40px)}}
        @keyframes float2{0%,100%{transform:translate(0,0)}50%{transform:translate(-50px,60px)}}
        @keyframes float3{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-50px)}}
      `}</style>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────
export default function App() {
  const [current, setCurrent] = useState(null);
  const feature = FEATURES.find(f => f.id === current);
  const back = () => setCurrent(null);

  let page;
  if (!current) page = <HomeScreen onSelect={setCurrent} />;
  else switch (current) {
    case "jp-zh": case "jp-en": page = <TranslatePage feature={feature} onBack={back} />; break;
    case "meeting-notes": page = <MeetingNotesPage feature={feature} onBack={back} />; break;
    case "video-zh": page = <VideoTranslatePage feature={feature} onBack={back} />; break;
    case "study-notes": page = <StudyNotesPage feature={feature} onBack={back} />; break;
    case "vocab": page = <VocabPage feature={feature} onBack={back} />; break;
    default: page = <HomeScreen onSelect={setCurrent} />;
  }

  return <><Background />{page}</>;
}
