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

// ── Notes stores (persisted in localStorage) ─────────────────
// Two libraries: "study" (Study Notes) and "meeting" (Meeting Minutes).
const STORE_KEYS = { study: "studyNotes_v1", meeting: "meetingMinutes_v1" };
const storeEvent = (kind) => `${kind}-notes-changed`;
function loadNotes(kind) {
  try { return JSON.parse(localStorage.getItem(STORE_KEYS[kind]) || "[]"); } catch { return []; }
}
function saveNotesList(kind, list) {
  try { localStorage.setItem(STORE_KEYS[kind], JSON.stringify(list)); } catch {}
  window.dispatchEvent(new Event(storeEvent(kind))); // notify mounted pages
}
function addNote(kind, note) {
  const list = loadNotes(kind);
  list.unshift(note);
  saveNotesList(kind, list);
}
function removeNote(kind, id) {
  saveNotesList(kind, loadNotes(kind).filter(n => n.id !== id));
}
// pull a "标题：xxx" line out of generated text, returning {title, body}
function parseTitle(text, fallback) {
  const firstLine = text.split("\n").find(l => l.trim()) || "";
  let title = firstLine.replace(/^[#\s]*标题[:：]?\s*/, "").replace(/^[#\s]+/, "").trim().slice(0, 20);
  if (!title) title = fallback;
  const body = text.replace(/^.*标题[:：].*\n/, "").trim() || text;
  return { title, body };
}
const NOTE_SYS = {
  study: `你是专业学习笔记助手。根据这次学习的内容，生成【简明扼要、只抓重点】的中文笔记。第一行输出 "标题：" 加不超过15字概括主题的标题，空一行后用精炼的分条要点（每条一句话），只保留最关键的知识点和结论，难点用★标注，去掉冗余和客套，不要长段落。`,
  meeting: `你是专业会议秘书。根据这次会议的内容，生成【简明扼要】的中文会议记录。第一行输出 "标题：" 加不超过15字概括会议主题的标题，空一行后按以下结构分条精炼列出：\n【核心议题】\n【决策结果】\n【行动项】（含负责人、截止时间，如有提及）\n【待跟进】\n只保留关键信息，去掉寒暄和无关内容。`,
};

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
    desc: "Saved meeting minutes by date",
    gradient: "linear-gradient(135deg, #10b981 0%, #5eead4 100%)",
    glow: "#10b981",
    tag: "meeting",
    hasMic: false,
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
    icon: "🧠",
    title: "AI Terms\nExplainer",
    desc: "Understand AI concepts like MCP, Agent, RAG",
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
    // Restart the engine after it auto-stops (on silence / segment end).
    // Calling start() synchronously inside onend throws InvalidStateError in
    // some Chrome builds, which used to freeze recognition after one sentence.
    // A short delay + retry makes it reliable.
    const restart = (attempt = 0) => {
      if (!wantRef.current) return;
      try {
        rec.start();
      } catch {
        if (attempt < 5) setTimeout(() => restart(attempt + 1), 250);
      }
    };
    rec.onend = () => {
      flushInterim();
      if (wantRef.current) { setTimeout(() => restart(), 120); return; }
      setListening(false);
      onEndRef.current(accumulatedRef.current);
    };
    rec.onerror = (e) => {
      // permission errors are fatal; everything else (no-speech, aborted,
      // network) is recoverable — onend will fire and auto-restart.
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

// ── useDeepgramSTT ───────────────────────────────────────────
// Pro engine: captures gapless audio with AudioWorklet and streams it straight
// to Deepgram's live WebSocket (token minted by our backend). Same interface as
// useSpeechRecognition so it drops into the rolling-translate pipeline. start()
// is async and throws if Deepgram isn't reachable (e.g. key not set).
function useDeepgramSTT({ language, onResult, onEnd }) {
  const [listening, setListening] = useState(false);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    && typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);

  const accRef = useRef("");
  const interimRef = useRef("");
  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const nodeRef = useRef(null);
  const onResultRef = useRef(onResult); onResultRef.current = onResult;
  const onEndRef = useRef(onEnd); onEndRef.current = onEnd;

  const cleanup = useCallback(() => {
    try { nodeRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { if (ctxRef.current && ctxRef.current.state !== "closed") ctxRef.current.close(); } catch {}
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "CloseStream" }));
      ws?.close();
    } catch {}
    nodeRef.current = null; streamRef.current = null; ctxRef.current = null; wsRef.current = null;
  }, []);

  const start = useCallback(async () => {
    accRef.current = ""; interimRef.current = "";
    // 1. short-lived token from our backend
    const tr = await fetch("/api/deepgram-token", { method: "POST" });
    const tj = await tr.json();
    if (tj.error || !tj.token) throw new Error(tj.error || "no token");

    // 2. mic → AudioWorklet (gapless PCM)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    streamRef.current = stream;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-processor");
    nodeRef.current = node;
    source.connect(node);
    node.connect(ctx.destination); // required so the graph "pulls" the worklet; our processor outputs silence, so no echo

    // 3. open WebSocket straight to Deepgram (send PCM at the context's rate)
    const params = new URLSearchParams({
      model: "nova-3", language, encoding: "linear16",
      sample_rate: String(Math.round(ctx.sampleRate)), channels: "1",
      interim_results: "true", punctuate: "true", smart_format: "true", endpointing: "300",
    });
    const url = "wss://api.deepgram.com/v1/listen?" + params.toString();
    const openWith = (proto) => new Promise((resolve, reject) => {
      const ws = new WebSocket(url, proto);
      let opened = false;
      ws.onopen = () => { opened = true; resolve(ws); };
      ws.onerror = () => { if (!opened) reject(new Error("ws error")); };
      ws.onclose = () => { if (!opened) reject(new Error("ws closed")); };
    });
    let ws;
    try { ws = await openWith(["bearer", tj.token]); }
    catch { ws = await openWith(["token", tj.token]); } // subprotocol fallback
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type !== "Results") return;
      const txt = m.channel?.alternatives?.[0]?.transcript || "";
      if (!txt) return;
      if (m.is_final) {
        accRef.current += (accRef.current ? " " : "") + txt;
        interimRef.current = "";
        onResultRef.current({ interim: "", accumulated: accRef.current, finalChunk: txt });
      } else {
        interimRef.current = txt;
        onResultRef.current({ interim: txt, accumulated: accRef.current, finalChunk: "" });
      }
    };

    node.port.onmessage = (e) => {
      const ws2 = wsRef.current;
      if (ws2 && ws2.readyState === 1) ws2.send(e.data);
    };
    setListening(true);
  }, [language]);

  const stop = useCallback(() => {
    cleanup();
    setListening(false);
    onEndRef.current?.(accRef.current);
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);
  return { listening, supported, start, stop };
}

// encode mono Int16 PCM as a WAV file (ArrayBuffer)
function encodeWav(int16, sampleRate) {
  const n = int16.length;
  const ab = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(ab);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, int16[i], true);
  return ab;
}
function abToB64(ab) {
  const bytes = new Uint8Array(ab); let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ── useOpenAITranscribe ──────────────────────────────────────
// Pro engine: AudioWorklet captures gapless audio; we slice it on natural
// pauses (simple silence detection) and send each clip to gpt-4o-transcribe.
// Same interface as the other engines so it slots into the rolling pipeline.
function useOpenAITranscribe({ language, onResult, onEnd, onError, onStatus }) {
  const [listening, setListening] = useState(false);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    && typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);

  const accRef = useRef("");
  const onResultRef = useRef(onResult); onResultRef.current = onResult;
  const onEndRef = useRef(onEnd); onEndRef.current = onEnd;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onStatusRef = useRef(onStatus); onStatusRef.current = onStatus;
  const ctxRef = useRef(null), streamRef = useRef(null), nodeRef = useRef(null);
  const bufRef = useRef([]); const bufLenRef = useRef(0);
  const srRef = useRef(16000); const silRef = useRef(0); const voicedRef = useRef(0);
  const chainRef = useRef(Promise.resolve());
  const sentRef = useRef(0); // clips sent (for status)

  const transcribe = useCallback(async (int16, sr) => {
    const wav = encodeWav(int16, sr);
    try {
      const r = await fetch("/api/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: abToB64(wav), language }),
      });
      const j = await r.json();
      if (j.error) { onErrorRef.current?.("转写失败：" + j.error); return; }
      const txt = (j.text || "").trim();
      if (txt) {
        accRef.current += (accRef.current ? " " : "") + txt;
        onResultRef.current({ interim: "", accumulated: accRef.current, finalChunk: txt });
      }
    } catch (e) { onErrorRef.current?.("转写请求异常：" + e.message); }
  }, [language]);

  const flush = useCallback(() => {
    const sr = srRef.current;
    const voicedSecs = voicedRef.current / sr;
    const grab = () => {
      const total = bufLenRef.current;
      const merged = new Int16Array(total);
      let off = 0; for (const f of bufRef.current) { merged.set(f, off); off += f.length; }
      bufRef.current = []; bufLenRef.current = 0; silRef.current = 0; voicedRef.current = 0;
      return merged;
    };
    if (!bufRef.current.length) return;
    // drop near-silent clips — avoids Whisper "I don't know." style hallucinations
    if (voicedSecs < 0.6) { grab(); return; }
    const merged = grab();
    sentRef.current += 1;
    onStatusRef.current?.(`🎙️ 已捕获 ${sentRef.current} 段，识别中…`);
    chainRef.current = chainRef.current.then(() => transcribe(merged, sr)); // keep order
  }, [transcribe]);

  const cleanup = useCallback(() => {
    try { nodeRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { if (ctxRef.current && ctxRef.current.state !== "closed") ctxRef.current.close(); } catch {}
    nodeRef.current = null; streamRef.current = null; ctxRef.current = null;
  }, []);

  const start = useCallback(async () => {
    accRef.current = ""; bufRef.current = []; bufLenRef.current = 0; silRef.current = 0; voicedRef.current = 0; sentRef.current = 0;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    streamRef.current = stream;
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); }
    catch { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    ctxRef.current = ctx; srRef.current = Math.round(ctx.sampleRate);
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-processor");
    nodeRef.current = node;
    source.connect(node);
    node.connect(ctx.destination); // required so the graph "pulls" the worklet; processor outputs silence, so no echo

    const SIL = 0.012; // silence RMS threshold
    node.port.onmessage = (e) => {
      const frame = new Int16Array(e.data);
      bufRef.current.push(frame); bufLenRef.current += frame.length;
      let sum = 0; for (let i = 0; i < frame.length; i++) { const v = frame[i] / 32768; sum += v * v; }
      const rms = Math.sqrt(sum / frame.length);
      if (rms < SIL) silRef.current += frame.length; else { silRef.current = 0; voicedRef.current += frame.length; }
      const sr = srRef.current;
      const secs = bufLenRef.current / sr, silSecs = silRef.current / sr, voicedSecs = voicedRef.current / sr;
      // coarse slicing: only cut on a clear pause after enough real speech, or
      // force-cut at 18s. Fewer, larger clips → far fewer requests (RPM) + better accuracy.
      if ((secs >= 4 && silSecs >= 0.6 && voicedSecs >= 1.2) || secs >= 18) flush();
    };
    setListening(true);
  }, [flush]);

  const stop = useCallback(() => {
    flush(); cleanup(); setListening(false);
    chainRef.current.then(() => onEndRef.current?.(accRef.current));
  }, [flush, cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);
  return { listening, supported, start, stop };
}

// ── useRollingTranslate ──────────────────────────────────────
// Buffers recognized chunks and auto-translates them a paragraph at a time:
// it waits until either ~maxChars of text has piled up, or a longer pause
// (debounce) signals the end of a paragraph. Produces a live feed of
// {id, src, tr, pending} segments.
function useRollingTranslate(sys, { debounce = 3500, maxChars = 140 } = {}) {
  const [segments, setSegments] = useState([]);
  const pendingRef = useRef("");
  const timerRef = useRef(null);
  const sysRef = useRef(sys);
  sysRef.current = sys;

  const translateChunk = useCallback(async (text) => {
    const src = text.trim();
    if (!src) return;
    const id = Date.now() + Math.random();
    setSegments(s => [...s, { id, src, tr: "", pending: true, at: Date.now() }]);
    try {
      const result = await callClaude(src, sysRef.current);
      setSegments(s => s.map(seg => seg.id === id ? { ...seg, tr: result, pending: false } : seg));
    } catch (e) {
      setSegments(s => s.map(seg => seg.id === id ? { ...seg, tr: "⚠️ " + e.message, pending: false } : seg));
    }
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const text = pendingRef.current;
    pendingRef.current = "";
    if (text.trim()) translateChunk(text);
  }, [translateChunk]);

  const onFinal = useCallback((chunk) => {
    if (!chunk || !chunk.trim()) return;
    pendingRef.current += chunk;
    if (timerRef.current) clearTimeout(timerRef.current);
    // translate once we've gathered a paragraph's worth of text — but defer it
    // so this speech-recognition callback returns immediately and the engine
    // keeps transcribing while the translation request runs in the background.
    if (pendingRef.current.length >= maxChars) { timerRef.current = setTimeout(flush, 0); return; }
    // ...otherwise wait for a longer pause (end of a paragraph).
    timerRef.current = setTimeout(flush, debounce);
  }, [flush, debounce, maxChars]);

  const reset = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    pendingRef.current = "";
    setSegments([]);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const fullText = segments.filter(s => s.tr && !s.pending).map(s => s.tr).join("\n");
  return { segments, onFinal, flush, reset, fullText };
}

// Notta-style transcript feed: timestamp + speaker + original (top) + translation (below).
function LiveFeed({ segments, interim, glow, label, onClear }) {
  const btn = { background: "none", border: `1px solid ${glow}44`, color: glow, borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" };
  if (!segments.length && !interim) return null;

  const t0 = segments.length ? segments[0].at : Date.now();
  const fmt = (at) => {
    const s = Math.max(0, Math.floor((at - t0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  const transcript = segments.map(s => `[${fmt(s.at)}] ${s.src}\n${s.tr}`).join("\n\n");
  const download = () => {
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `transcript_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  const Row = ({ ts, src, tr, pending, live }) => (
    <div style={{ display: "flex", gap: 12, padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ width: 44, flexShrink: 0, fontSize: 11, color: "#64748b", paddingTop: 2 }}>{ts}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: glow, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>🗣</span>
          <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>话者 1</span>
          {live && <span style={{ fontSize: 10, color: glow }}>● 识别中</span>}
        </div>
        <div style={{ fontSize: 15, color: live ? "#94a3b8" : "#f1f5f9", lineHeight: 1.6 }}>{src}{live && <span style={{ color: "#475569" }}>…</span>}</div>
        {!live && <div style={{ fontSize: 14, color: pending ? "#64748b" : "#a5b4fc", lineHeight: 1.6, marginTop: 4 }}>{pending ? "翻译中…" : tr}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ ...glass({ borderColor: `${glow}44` }), marginTop: 16, overflow: "hidden", boxShadow: `0 0 30px ${glow}22` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: `${glow}18`, borderBottom: `1px solid ${glow}22` }}>
        <span style={{ fontSize: 12, color: glow, fontWeight: 700 }}>{label}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {transcript && <button onClick={download} style={btn}>↓ Download</button>}
          {transcript && <button onClick={() => navigator.clipboard.writeText(transcript)} style={btn}>Copy all</button>}
          {onClear && <button onClick={onClear} style={{ ...btn, color: "#fb7185", borderColor: "#fb718544" }}>Clear</button>}
        </div>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {segments.map(seg => <Row key={seg.id} ts={fmt(seg.at)} src={seg.src} tr={seg.tr} pending={seg.pending} />)}
        {interim && <Row ts={fmt(Date.now())} src={interim} live />}
      </div>
    </div>
  );
}

// reusable "summarize accumulated text into a saved note" block.
// kind = "study" → Study Notes; "meeting" → Meeting Minutes.
function SummarizeBlock({ text, glow, gradient, kind }) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (!text || !text.trim()) return null;

  const isMeeting = kind === "meeting";
  const btnLabel = isMeeting ? "📝 Summarize meeting minutes" : "📝 Summarize into notes";
  const resultLabel = isMeeting ? "📝 Meeting Minutes" : "📝 Study Notes";
  const savedTo = isMeeting ? "Meeting Minutes" : "Study Notes";

  const summarize = async () => {
    setError(""); setLoading(true); setSaved(false);
    try {
      const result = await callClaude(text, NOTE_SYS[kind]);
      setNotes(result);
      const { title, body } = parseTitle(result, isMeeting ? "会议记录" : "学习笔记");
      addNote(kind, { id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), title, date: new Date().toISOString(), content: body });
      setSaved(true);
    } catch (e) { setError("Failed: " + e.message); }
    setLoading(false);
  };

  const download = () => {
    const blob = new Blob([notes], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${isMeeting ? "minutes" : "notes"}_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  return (
    <div style={{ marginTop: 16 }}>
      <ActionBtn onClick={summarize} loading={loading} disabled={false} gradient={gradient}>{btnLabel}</ActionBtn>
      {saved && <div style={{ marginTop: 10, color: "#34d399", fontSize: 12 }}>✓ 已保存到 {savedTo}</div>}
      {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
      {notes && <ResultBox content={notes} label={resultLabel} accent={glow} onDownload={download} />}
    </div>
  );
}

// reusable notes-library page body (Study Notes / Meeting Minutes share this)
function NotesLibrary({ feature, kind }) {
  const isMeeting = kind === "meeting";
  const [tab, setTab] = useState("saved");
  const [notes, setNotes] = useState(loadNotes(kind));
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    const refresh = () => setNotes(loadNotes(kind));
    window.addEventListener(storeEvent(kind), refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener(storeEvent(kind), refresh); window.removeEventListener("focus", refresh); };
  }, [kind]);

  const del = (id) => { removeNote(kind, id); setNotes(loadNotes(kind)); if (openId === id) setOpenId(null); };
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!input.trim()) return;
    setError(""); setProcessing(true);
    try {
      const result = await callClaude(input, NOTE_SYS[kind]);
      setOutput(result);
      const { title, body } = parseTitle(result, isMeeting ? "会议记录" : "学习笔记");
      addNote(kind, { id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), title, date: new Date().toISOString(), content: body });
      setNotes(loadNotes(kind));
    } catch (e) { setError("Generation failed: " + e.message); }
    setProcessing(false);
  };

  const downloadNote = (n) => {
    const blob = new Blob([`${n.title}\n${fmtDate(n.date)}\n\n${n.content}`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${n.title}.txt`; a.click();
  };

  // full backup of this library as a JSON file
  const fileRef = useRef(null);
  const exportAll = () => {
    const blob = new Blob([JSON.stringify(loadNotes(kind), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${kind}_backup_${new Date().toLocaleDateString("en-CA")}.json`; a.click();
  };
  const importAll = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) return;
        const existing = loadNotes(kind);
        const ids = new Set(existing.map(n => n.id));
        const merged = [...imported.filter(n => n && n.id && !ids.has(n.id)), ...existing];
        merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        saveNotesList(kind, merged);
        setNotes(loadNotes(kind));
        alert(`已导入，当前共 ${merged.length} 条`);
      } catch { alert("导入失败：文件格式不对"); }
    };
    reader.readAsText(file);
  };

  const emptyHint = isMeeting
    ? "还没有会议记录。在 Live Translate 里翻译会议后点「📝 Summarize meeting minutes」，会自动保存到这里。"
    : "还没有笔记。在 Video / Live Translate 里翻译后点「📝 Summarize into notes」，会自动保存到这里。";
  const toolBtn = { ...glass({ borderRadius: 8 }), padding: "5px 10px", fontSize: 11, color: "#94a3b8", cursor: "pointer" };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[{ v: "saved", l: `📁 ${isMeeting ? "My minutes" : "My notes"} (${notes.length})` }, { v: "create", l: "✏️ New" }].map(t => (
          <button key={t.v} onClick={() => setTab(t.v)} style={{ ...glass({ borderRadius: 12 }), padding: "8px 18px", fontSize: 13, cursor: "pointer", background: tab === t.v ? `${feature.glow}33` : "rgba(255,255,255,0.045)", borderColor: tab === t.v ? feature.glow : "rgba(255,255,255,0.09)", color: tab === t.v ? feature.glow : "#94a3b8", fontWeight: 600 }}>{t.l}</button>
        ))}
      </div>

      {tab === "saved" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={exportAll} style={toolBtn} disabled={!notes.length}>⬆ Export all (backup)</button>
          <button onClick={() => fileRef.current?.click()} style={toolBtn}>⬇ Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={e => { importAll(e.target.files[0]); e.target.value = ""; }} />
        </div>
      )}

      {tab === "saved" ? (
        notes.length === 0 ? (
          <div style={{ ...glass({ borderRadius: 14 }), padding: "40px 20px", textAlign: "center", color: "#64748b", fontSize: 13, lineHeight: 1.8 }}>{emptyHint}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {notes.map(n => (
              <div key={n.id} style={{ ...glass({ borderRadius: 14, borderColor: openId === n.id ? `${feature.glow}55` : "rgba(255,255,255,0.09)" }), overflow: "hidden" }}>
                <div onClick={() => setOpenId(openId === n.id ? null : n.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", cursor: "pointer" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: feature.gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{isMeeting ? "📋" : "📄"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{fmtDate(n.date)}</div>
                  </div>
                  <span style={{ color: "#64748b", fontSize: 13 }}>{openId === n.id ? "▲" : "▼"}</span>
                </div>
                {openId === n.id && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    <pre style={{ margin: 0, padding: 16, color: "#cbd5e1", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "system-ui" }}>{n.content}</pre>
                    <div style={{ display: "flex", gap: 8, padding: "0 16px 14px" }}>
                      <button onClick={() => navigator.clipboard.writeText(n.content)} style={{ background: "none", border: `1px solid ${feature.glow}44`, color: feature.glow, borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Copy</button>
                      <button onClick={() => downloadNote(n)} style={{ background: "none", border: `1px solid ${feature.glow}44`, color: feature.glow, borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>↓ Download</button>
                      <button onClick={() => del(n.id)} style={{ background: "none", border: "1px solid #fb718544", color: "#fb7185", borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <TextInput value={input} onChange={setInput} label={isMeeting ? "粘贴会议内容（日文/中文）" : "粘贴学习内容（字幕、教材、课堂记录…）"} placeholder={isMeeting ? "Paste meeting content..." : "Paste study content..."} accent={feature.glow} rows={7} />
          <ActionBtn onClick={run} loading={processing} disabled={!input.trim()} gradient={feature.gradient}>{isMeeting ? "📋 Generate & save" : "📚 Generate & save"}</ActionBtn>
          {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
          {output && <ResultBox content={output} label={`${isMeeting ? "📋 Meeting Minutes" : "📚 Study Notes"}（已保存）`} accent={feature.glow} />}
        </>
      )}
    </>
  );
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

// engine picker: Pro (Deepgram) vs Free (browser Web Speech)
function EngineToggle({ engine, setEngine, glow, disabled }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "#64748b" }}>识别引擎:</span>
      {[{ v: "pro", l: "⚡ Pro (OpenAI)" }, { v: "free", l: "Free (浏览器)" }].map(t => (
        <button key={t.v} onClick={() => !disabled && setEngine(t.v)} disabled={disabled} style={{ ...glass({ borderRadius: 999 }), padding: "5px 12px", fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", background: engine === t.v ? `${glow}33` : "rgba(255,255,255,0.045)", borderColor: engine === t.v ? glow : "rgba(255,255,255,0.09)", color: engine === t.v ? glow : "#94a3b8", fontWeight: 600 }}>{t.l}</button>
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
  const [translation, setTranslation] = useState(""); // manual-mode single result
  const [translating, setTranslating] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [tab, setTab] = useState("mic");
  const [error, setError] = useState("");

  const [status, setStatus] = useState("");
  const { segments, onFinal, flush, reset, fullText } = useRollingTranslate(sys);

  const [engine, setEngine] = useState("pro"); // "pro" = OpenAI, "free" = browser
  const handleResult = ({ interim, finalChunk }) => { setInterim(interim); onFinal(finalChunk); };
  const dg = useOpenAITranscribe({ language: "ja", onResult: handleResult, onEnd: () => flush(), onError: setError, onStatus: setStatus });
  const sr = useSpeechRecognition({ lang: "ja-JP", onResult: handleResult, onEnd: () => flush() });
  const active = engine === "pro" ? dg : sr;
  const { listening, supported, stop } = active;

  // keep prior transcripts across mic sessions — only clear interim/error
  const startLive = async () => {
    setInterim(""); setError(""); setStatus("");
    if (engine === "pro") {
      try { await dg.start(); return; }
      catch (e) { setEngine("free"); setError("Pro 引擎不可用(" + e.message + ")，已切到 Free。"); try { sr.start(); } catch {} return; }
    }
    try { sr.start(); } catch {}
  };

  const translateManual = async (text) => {
    setError(""); setTranslating(true);
    try {
      const result = await callClaude(text, sys);
      setTranslation(result);
    } catch (e) { setError("Translation failed: " + e.message); }
    setTranslating(false);
  };

  const download = (text) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `translation_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic" ? (
        <>
          <EngineToggle engine={engine} setEngine={setEngine} glow={feature.glow} disabled={listening} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 0" }}>
            <MicButton listening={listening} onStart={startLive} onStop={stop} glow={feature.glow} disabled={!supported} />
            <Waveform active={listening} glow={feature.glow} />
            <div style={{ fontSize: 13, color: listening ? feature.glow : "#64748b", fontWeight: 600, textAlign: "center" }}>
              {!supported ? "⚠️ Please use Chrome browser"
                : listening ? "🔴 Live translating... keep talking, tap to stop"
                : "Tap once — it translates as you speak, no need to hold"}
            </div>
            {engine === "pro" && listening && (status || !segments.length) && <div style={{ fontSize: 12, color: "#64748b" }}>{status || "OpenAI 模式：说一段后停顿，转写好会出现在下方"}</div>}
          </div>

          <LiveFeed segments={segments} interim={interim} glow={feature.glow} label={`实时翻译 → ${targetLabel}`} onClear={!listening ? reset : undefined} />
          {!listening && <SummarizeBlock text={fullText} glow={feature.glow} gradient={feature.gradient} kind="meeting" />}
          {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
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
    </PageShell>
  );
}

function MeetingNotesPage({ feature, onBack }) {
  return (
    <PageShell feature={feature} onBack={onBack}>
      <NotesLibrary feature={feature} kind="meeting" />
    </PageShell>
  );
}

function VideoTranslatePage({ feature, onBack }) {
  const ZH_SYS = "你是专业字幕翻译。把英文内容准确、自然地翻译成简体中文，专业术语在中文后用括号保留英文。只输出中文翻译。";
  const [interim, setInterim] = useState("");
  const [output, setOutput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState("transcript"); // "transcript" (paste) | "mic"
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState("bilingual"); // transcript output: "bilingual" | "zh"
  const [error, setError] = useState("");

  const [status, setStatus] = useState("");
  // mic mode → live rolling translation (English chunk → Chinese)
  const { segments, onFinal, flush, reset, fullText } = useRollingTranslate(ZH_SYS);
  const [engine, setEngine] = useState("pro");
  const handleResult = ({ interim, finalChunk }) => { setInterim(interim); onFinal(finalChunk); };
  const dg = useOpenAITranscribe({ language: "en", onResult: handleResult, onEnd: () => flush(), onError: setError, onStatus: setStatus });
  const sr = useSpeechRecognition({ lang: "en-US", onResult: handleResult, onEnd: () => flush() });
  const active = engine === "pro" ? dg : sr;
  const { listening, supported, stop } = active;
  // keep prior transcripts across mic sessions — only clear interim/error
  const startLive = async () => {
    setInterim(""); setError(""); setStatus("");
    if (engine === "pro") {
      try { await dg.start(); return; }
      catch (e) { setEngine("free"); setError("Pro 引擎不可用(" + e.message + ")，已切到 Free。"); try { sr.start(); } catch {} return; }
    }
    try { sr.start(); } catch {}
  };

  // transcript mode → translate the whole pasted text at once
  const translate = async (text) => {
    if (!text.trim()) return;
    setError(""); setProcessing(true);
    try {
      const sysMap = {
        bilingual: "你是专业字幕翻译。把英文内容翻译成简体中文，按句子分段，每段先列英文原文，下一行给出中文翻译，专业术语在中文后用括号保留英文。",
        zh: "你是专业字幕翻译。把英文内容准确、自然地翻译成简体中文，保持段落结构，专业术语在中文后用括号保留英文。只输出中文翻译。",
      };
      const result = await callClaude(text, sysMap[mode]);
      setOutput(result);
    } catch (e) { setError("Translation failed: " + e.message); }
    setProcessing(false);
  };

  const download = (text) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `video_translation_${new Date().toLocaleDateString("en-CA")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      {/* source: paste transcript or record audio */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[{ v: "transcript", l: "📄 Paste transcript" }, { v: "mic", l: "🎤 Record audio" }].map(t => (
          <button key={t.v} onClick={() => setTab(t.v)} style={{ ...glass({ borderRadius: 12 }), padding: "8px 18px", fontSize: 13, cursor: "pointer", background: tab === t.v ? `${feature.glow}33` : "rgba(255,255,255,0.045)", borderColor: tab === t.v ? feature.glow : "rgba(255,255,255,0.09)", color: tab === t.v ? feature.glow : "#94a3b8", fontWeight: 600 }}>{t.l}</button>
        ))}
      </div>

      {tab === "transcript" ? (
        <>
          {/* output format toggle (transcript mode only) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[{ v: "bilingual", l: "EN + 中文" }, { v: "zh", l: "仅中文" }].map(m => (
              <button key={m.v} onClick={() => setMode(m.v)} style={{ ...glass({ borderRadius: 10 }), padding: "6px 14px", fontSize: 12, cursor: "pointer", background: mode === m.v ? `${feature.glow}33` : "rgba(255,255,255,0.045)", borderColor: mode === m.v ? feature.glow : "rgba(255,255,255,0.09)", color: mode === m.v ? feature.glow : "#94a3b8" }}>{m.l}</button>
            ))}
          </div>
          <TextInput value={transcript} onChange={setTranscript} label="Paste the video transcript / subtitles (English)" accent={feature.glow} placeholder="Copy the transcript from the learning site and paste it here..." rows={8} />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: -6, marginBottom: 14 }}>
            💡 Tip: most courses (e.g. DeepLearning.AI) show a transcript panel — select all, copy, paste here.
          </div>
          <ActionBtn onClick={() => translate(transcript)} loading={processing} disabled={!transcript.trim()} gradient={feature.gradient}>🌏 Translate to Chinese</ActionBtn>
          {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
          {output && <ResultBox content={output} label="🌏 Chinese Translation" accent={feature.glow} onDownload={download} />}
          <SummarizeBlock text={output || transcript} glow={feature.glow} gradient={feature.gradient} kind="study" />
        </>
      ) : (
        <>
          <EngineToggle engine={engine} setEngine={setEngine} glow={feature.glow} disabled={listening} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 0" }}>
            <MicButton listening={listening} onStart={startLive} onStop={stop} glow={feature.glow} disabled={!supported} />
            <Waveform active={listening} glow={feature.glow} />
            <div style={{ fontSize: 13, color: listening ? feature.glow : "#64748b", fontWeight: 600, textAlign: "center" }}>
              {!supported ? "⚠️ Please use Chrome browser"
                : listening ? "🔴 Live translating... play the video, tap to stop"
                : "Tap once — it transcribes & translates as the video plays"}
            </div>
            {engine === "pro" && listening && (status || !segments.length) && <div style={{ fontSize: 12, color: "#64748b" }}>{status || "OpenAI 模式：播放一段后停顿，转写好会出现在下方"}</div>}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            💡 For videos without a transcript. Best on desktop Chrome; play the audio out loud near the mic.
          </div>
          <LiveFeed segments={segments} interim={interim} glow={feature.glow} label="🌏 实时翻译 → 中文" onClear={!listening ? reset : undefined} />
          {!listening && <SummarizeBlock text={fullText} glow={feature.glow} gradient={feature.gradient} kind="study" />}
          {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
        </>
      )}
    </PageShell>
  );
}

function StudyNotesPage({ feature, onBack }) {
  return (
    <PageShell feature={feature} onBack={onBack}>
      <NotesLibrary feature={feature} kind="study" />
    </PageShell>
  );
}

function VocabPage({ feature, onBack }) {
  const [term, setTerm] = useState("");
  const [output, setOutput] = useState("");
  const [activeTerm, setActiveTerm] = useState("");
  const [processing, setProcessing] = useState(false);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  const SUGGESTIONS = ["MCP", "Skill", "Agent", "RAG", "Token", "Embedding", "Fine-tuning", "Prompt", "Context window", "Hallucination"];

  const explain = async (q) => {
    const query = (q ?? term).trim();
    if (!query) return;
    setError(""); setProcessing(true); setActiveTerm(query);
    try {
      const sys = `你是 AI 领域的科普讲解高手，擅长把专业概念讲得通俗易懂。用户给你一个 AI 相关的专业词汇或概念，请用简体中文严格按以下三段结构讲解：\n\n【是什么】先一句话定义，再用2-4句准确解释清楚它到底指什么、解决什么问题。\n\n【打个比方】用一个生活化的类比或形象的画面来讲解，让完全的外行也能秒懂（描述要具体、有画面感，像在讲一个小故事）。\n\n【动手试试】给出2-3个具体、能立刻上手的小实验或小方案，让用户通过亲自动手来理解这个概念（要写清楚具体做什么，最好举一个可直接复制的例子）。\n\n语言生动简洁，不要堆砌术语，不要客套。`;
      const result = await callClaude(`请讲解这个 AI 词汇/概念：${query}`, sys);
      setOutput(result);
      setHistory(h => h.find(x => x.term === query) ? h : [{ term: query, result }, ...h.slice(0, 19)]);
    } catch (e) { setError("讲解失败: " + e.message); }
    setProcessing(false);
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>输入一个 AI 词汇或概念</div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => e.key === "Enter" && explain()} placeholder="例如：MCP、Skill、RAG…"
            style={{ ...glass({ borderRadius: 12 }), flex: 1, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", fontFamily: "system-ui" }}
            onFocus={e => e.target.style.borderColor = feature.glow} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.09)"} />
          <ActionBtn onClick={() => explain()} loading={processing} disabled={!term.trim()} gradient={feature.gradient}>讲解</ActionBtn>
        </div>
      </div>

      {/* quick suggestions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {SUGGESTIONS.map(s => (
          <button key={s} onClick={() => { setTerm(s); explain(s); }} style={{ ...glass({ borderRadius: 999 }), padding: "5px 12px", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = feature.glow; e.currentTarget.style.color = feature.glow; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "#94a3b8"; }}
          >{s}</button>
        ))}
      </div>

      {error && <div style={{ marginTop: 12, color: "#fb7185", fontSize: 13 }}>{error}</div>}
      {processing && <div style={{ textAlign: "center", padding: 20, color: feature.glow, fontSize: 13 }}>⏳ 正在通俗讲解…</div>}
      {output && !processing && <ResultBox content={output} label={`🧠 ${activeTerm}`} accent={feature.glow} />}

      {history.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>查过的概念 ({history.length})</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {history.map((w, i) => (
              <button key={i} onClick={() => { setActiveTerm(w.term); setOutput(w.result); }} style={{ ...glass({ borderRadius: 10 }), padding: "6px 14px", color: "#cbd5e1", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = feature.glow; e.currentTarget.style.color = feature.glow; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "#cbd5e1"; }}
              >{w.term}</button>
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

  // ask the browser to keep our localStorage from being auto-evicted
  useEffect(() => { try { navigator.storage?.persist?.(); } catch {} }, []);

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
