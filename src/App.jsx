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
    title: "日→中\n同声翻译",
    desc: "日文语音即时翻译成中文",
    gradient: "linear-gradient(135deg, #1d4ed8 0%, #06b6d4 100%)",
    glow: "#1d4ed8",
    tag: "会议",
    hasMic: true,
  },
  {
    id: "jp-en",
    icon: "🌐",
    title: "日→英\n同声翻译",
    desc: "日文语音即时翻译成英文",
    gradient: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
    glow: "#7c3aed",
    tag: "会议",
    hasMic: true,
  },
  {
    id: "meeting-notes",
    icon: "📋",
    title: "会议记录\n自动生成",
    desc: "根据会议内容生成结构化记录",
    gradient: "linear-gradient(135deg, #047857 0%, #34d399 100%)",
    glow: "#047857",
    tag: "会议",
    hasMic: true,
  },
  {
    id: "video-zh",
    icon: "🎬",
    title: "视频英文\n转文字翻译",
    desc: "英文语音转文字并翻译成中文",
    gradient: "linear-gradient(135deg, #b45309 0%, #fbbf24 100%)",
    glow: "#b45309",
    tag: "学习",
    hasMic: true,
  },
  {
    id: "study-notes",
    icon: "📚",
    title: "学习笔记\n自动生成",
    desc: "根据学习内容生成结构化笔记",
    gradient: "linear-gradient(135deg, #b91c1c 0%, #f87171 100%)",
    glow: "#b91c1c",
    tag: "学习",
    hasMic: false,
  },
  {
    id: "vocab",
    icon: "🔤",
    title: "字幕单词\n翻译插件",
    desc: "抓取字幕单词即时翻译查词",
    gradient: "linear-gradient(135deg, #0e7490 0%, #22d3ee 100%)",
    glow: "#0e7490",
    tag: "学习",
    hasMic: false,
  },
];

// ── useSpeechRecognition ─────────────────────────────────────
function useSpeechRecognition({ lang, onResult, onEnd }) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const accumulatedRef = useRef("");

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
      onResult({ interim, accumulated: accumulatedRef.current });
    };
    rec.onend = () => { setListening(false); onEnd(accumulatedRef.current); };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
  }, [lang]);

  const start = useCallback(() => {
    accumulatedRef.current = "";
    recRef.current?.start();
    setListening(true);
  }, []);
  const stop = useCallback(() => { recRef.current?.stop(); setListening(false); }, []);
  return { listening, supported, start, stop };
}

// ── Shared UI ────────────────────────────────────────────────
function MicButton({ listening, onStart, onStop, glow, disabled }) {
  return (
    <button onClick={listening ? onStop : onStart} disabled={disabled} style={{
      width: 80, height: 80, borderRadius: "50%",
      background: listening ? `radial-gradient(circle, ${glow}dd, ${glow}88)` : "linear-gradient(135deg,#1e293b,#0f172a)",
      border: `3px solid ${listening ? glow : "#1e2d42"}`,
      cursor: disabled ? "not-allowed" : "pointer", fontSize: 32,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: listening ? `0 0 30px ${glow}88,0 0 60px ${glow}44` : "none",
      transition: "all 0.3s", animation: listening ? "micPulse 1.5s ease-in-out infinite" : "none",
    }}>
      {listening ? "⏹" : "🎤"}
      <style>{`@keyframes micPulse{0%,100%{box-shadow:0 0 30px ${glow}88,0 0 60px ${glow}44}50%{box-shadow:0 0 50px ${glow}cc,0 0 90px ${glow}66}}`}</style>
    </button>
  );
}

function Waveform({ active, glow }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 32 }}>
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: active ? glow : "#1e2d42", height: active ? undefined : 4,
          animation: active ? `bar${i % 4} ${0.6 + (i % 3) * 0.2}s ease-in-out infinite alternate` : "none",
          animationDelay: `${i * 0.06}s`, transition: "background 0.3s",
        }} />
      ))}
      <style>{`@keyframes bar0{from{height:4px}to{height:28px}}@keyframes bar1{from{height:6px}to{height:22px}}@keyframes bar2{from{height:8px}to{height:30px}}@keyframes bar3{from{height:4px}to{height:18px}}`}</style>
    </div>
  );
}

function PageShell({ feature, onBack, children }) {
  return (
    <div style={{ minHeight:"100vh", background:"#07111f", fontFamily:"system-ui,-apple-system,sans-serif", color:"#f1f5f9" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 18px", background:"#0a1628", borderBottom:"1px solid #1e2d42", position:"sticky", top:0, zIndex:10 }}>
        <button onClick={onBack} style={{ background:"#111827", border:"1px solid #1e2d42", borderRadius:10, width:36, height:36, color:"#94a3b8", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>
        <div style={{ width:36, height:36, borderRadius:10, background:feature.gradient, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:`0 0 14px ${feature.glow}55` }}>{feature.icon}</div>
        <div>
          <div style={{ fontSize:14, fontWeight:700 }}>{feature.title.replace("\n"," ")}</div>
          <div style={{ fontSize:11, color:"#475569" }}>{feature.desc}</div>
        </div>
      </div>
      <div style={{ padding:"24px 18px", maxWidth:680, margin:"0 auto" }}>{children}</div>
    </div>
  );
}

function ResultBox({ content, label, accent, onDownload }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop:18, background:"#0d1b2e", border:`1.5px solid ${accent}44`, borderRadius:14, overflow:"hidden" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:`${accent}18`, borderBottom:`1px solid ${accent}22` }}>
        <span style={{ fontSize:12, color:accent, fontWeight:700 }}>{label}</span>
        <div style={{ display:"flex", gap:8 }}>
          {onDownload && <button onClick={onDownload} style={{ background:"none", border:`1px solid ${accent}44`, color:accent, borderRadius:6, padding:"3px 10px", fontSize:11, cursor:"pointer" }}>↓ 下载</button>}
          <button onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(()=>setCopied(false),2000); }} style={{ background:"none", border:`1px solid ${accent}44`, color:accent, borderRadius:6, padding:"3px 10px", fontSize:11, cursor:"pointer" }}>{copied?"✓ 复制":"复制"}</button>
        </div>
      </div>
      <pre style={{ margin:0, padding:16, color:"#cbd5e1", fontSize:14, lineHeight:1.8, whiteSpace:"pre-wrap", wordBreak:"break-word", fontFamily:"system-ui", maxHeight:320, overflowY:"auto" }}>{content}</pre>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, label, accent, rows=4 }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && <div style={{ fontSize:12, color:"#64748b", marginBottom:6 }}>{label}</div>}
      <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{ width:"100%", boxSizing:"border-box", background:"#0d1b2e", border:"1.5px solid #1e2d42", borderRadius:12, padding:12, color:"#e2e8f0", fontSize:14, lineHeight:1.7, resize:"vertical", outline:"none", fontFamily:"system-ui", transition:"border-color 0.2s" }}
        onFocus={e=>e.target.style.borderColor=accent} onBlur={e=>e.target.style.borderColor="#1e2d42"} />
    </div>
  );
}

function ActionBtn({ onClick, loading, disabled, gradient, children }) {
  return (
    <button onClick={onClick} disabled={disabled||loading} style={{ background:disabled||loading?"#111827":gradient, color:disabled||loading?"#334155":"#fff", border:"none", borderRadius:12, padding:"12px 26px", fontSize:14, fontWeight:700, cursor:disabled||loading?"not-allowed":"pointer", transition:"all 0.2s" }}>
      {loading?"⏳ AI处理中...":children}
    </button>
  );
}

function MicSection({ listening, supported, start, stop, glow, accumulated, interim, label }) {
  return (
    <div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"24px 0" }}>
        <MicButton listening={listening} onStart={start} onStop={stop} glow={glow} disabled={!supported} />
        <Waveform active={listening} glow={glow} />
        <div style={{ fontSize:13, color:listening?glow:"#334155", fontWeight:600 }}>
          {!supported ? "⚠️ 请使用 Chrome 浏览器" : listening ? "🔴 录音中... 说完后点击停止" : label}
        </div>
      </div>
      {(accumulated||interim) && (
        <div style={{ background:"#0d1b2e", border:"1px solid #1e2d42", borderRadius:12, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:11, color:"#475569", marginBottom:6 }}>识别内容</div>
          <div style={{ fontSize:14, color:"#94a3b8", lineHeight:1.7, maxHeight:160, overflowY:"auto" }}>
            {accumulated}<span style={{ color:"#334155" }}>{interim}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TabSwitch({ tab, setTab, glow }) {
  return (
    <div style={{ display:"flex", gap:8, marginBottom:20 }}>
      {[{v:"mic",l:"🎤 麦克风录音"},{v:"manual",l:"⌨️ 手动输入"}].map(t=>(
        <button key={t.v} onClick={()=>setTab(t.v)} style={{ padding:"8px 18px", borderRadius:10, fontSize:13, cursor:"pointer", background:tab===t.v?`${glow}33`:"#0d1b2e", border:`1.5px solid ${tab===t.v?glow:"#1e2d42"}`, color:tab===t.v?glow:"#475569", fontWeight:600 }}>{t.l}</button>
      ))}
    </div>
  );
}

// ── Feature Pages ────────────────────────────────────────────
function TranslatePage({ feature, onBack }) {
  const isZh = feature.id === "jp-zh";
  const targetLabel = isZh ? "中文" : "English";
  const [interim, setInterim] = useState("");
  const [accumulated, setAccumulated] = useState("");
  const [translation, setTranslation] = useState("");
  const [translating, setTranslating] = useState(false);
  const [history, setHistory] = useState([]);
  const [manualInput, setManualInput] = useState("");
  const [tab, setTab] = useState("mic");
  const [error, setError] = useState("");

  const { listening, supported, start, stop } = useSpeechRecognition({
    lang: "ja-JP",
    onResult: ({ interim, accumulated }) => { setInterim(interim); setAccumulated(accumulated); },
    onEnd: async (text) => { if (text.trim()) await translate(text); },
  });

  const translate = async (text) => {
    setError(""); setTranslating(true);
    try {
      const sys = isZh
        ? "你是专业日中同声传译员。将日文准确翻译成简体中文，保持自然流畅，专业术语准确。只输出翻译结果。"
        : "You are a professional Japanese-English interpreter. Translate Japanese to natural, accurate English. Output only the translation.";
      const result = await callClaude(text, sys);
      setTranslation(result);
      setHistory(h => [{ src: text, tr: result, time: new Date().toLocaleTimeString() }, ...h.slice(0, 9)]);
    } catch(e) { setError("翻译失败：" + e.message); }
    setTranslating(false);
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic"
        ? <MicSection listening={listening} supported={supported} start={start} stop={stop} glow={feature.glow} accumulated={accumulated} interim={interim} label="点击麦克风开始说日语" />
        : <TextInput value={manualInput} onChange={setManualInput} label="手动输入日文" accent={feature.glow} placeholder="在此输入日文，例如：本日の会議を始めましょう。" rows={5} />
      }
      {tab === "manual" && (
        <ActionBtn onClick={() => translate(manualInput)} loading={translating} disabled={!manualInput.trim()} gradient={feature.gradient}>
          ▶ 翻译成{targetLabel}
        </ActionBtn>
      )}
      {error && <div style={{ marginTop:12, color:"#f87171", fontSize:13 }}>{error}</div>}
      {translating && <div style={{ textAlign:"center", padding:20, color:feature.glow, fontSize:13 }}>⏳ 翻译中...</div>}
      {translation && !translating && <ResultBox content={translation} label={`翻译结果 → ${targetLabel}`} accent={feature.glow} />}
      {history.length > 0 && (
        <div style={{ marginTop:28 }}>
          <div style={{ fontSize:12, color:"#334155", marginBottom:10 }}>翻译历史</div>
          {history.map((h,i) => (
            <div key={i} onClick={()=>setTranslation(h.tr)} style={{ background:"#0d1b2e", borderRadius:10, padding:12, marginBottom:8, cursor:"pointer", border:"1px solid #1e2d42" }}>
              <div style={{ fontSize:11, color:"#334155", marginBottom:4 }}>{h.time}</div>
              <div style={{ fontSize:12, color:"#475569" }}>JP: {h.src.slice(0,50)}{h.src.length>50?"…":""}</div>
              <div style={{ fontSize:12, color:"#64748b", marginTop:3 }}>→ {h.tr.slice(0,60)}{h.tr.length>60?"…":""}</div>
            </div>
          ))}
        </div>
      )}
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
      const sys = `你是专业会议秘书。根据会议内容生成结构化中文会议记录：\n【会议主题】\n【参会人员】（如有提及）\n【核心议题】（分条列出）\n【决策结果】\n【行动计划】（含负责人、截止日期）\n【待跟进事项】\n内容精炼，突出关键决策和行动项。`;
      const result = await callClaude(`会议内容（日文）：\n${text}`, sys);
      setNotes(result);
    } catch(e) { setError("生成失败：" + e.message); }
    setProcessing(false);
  };

  const download = () => {
    const blob = new Blob([notes], { type:"text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `会议记录_${new Date().toLocaleDateString("zh-CN")}.txt`; a.click();
  };

  const src = tab === "mic" ? accumulated : manualInput;
  return (
    <PageShell feature={feature} onBack={onBack}>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic"
        ? <MicSection listening={listening} supported={supported} start={start} stop={stop} glow={feature.glow} accumulated={accumulated} interim={interim} label="开始录音，捕捉整个会议内容" />
        : <TextInput value={manualInput} onChange={setManualInput} label="粘贴会议内容（日文或中文）" accent={feature.glow} placeholder={`田中：今天讨论Q3目标...\n李总：营销预算需要追加...\n决定：下周五提交方案...`} rows={7} />
      }
      <ActionBtn onClick={()=>generate(src)} loading={processing} disabled={!src.trim()} gradient={feature.gradient}>📋 生成会议记录</ActionBtn>
      {error && <div style={{ marginTop:12, color:"#f87171", fontSize:13 }}>{error}</div>}
      {notes && <ResultBox content={notes} label="📋 会议记录" accent={feature.glow} onDownload={download} />}
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
        both: `处理视频英文内容，输出两部分：\n【英文文字稿】整理原文，修正语法，加标点\n【中文翻译】准确翻译，专业术语保留英文括注`,
        transcript: "整理英文语音为清晰文字稿，修正语法添加标点，只输出英文稿。",
        translate: "将英文内容准确翻译成简体中文，只输出中文翻译。",
      };
      const result = await callClaude(text, sysMap[mode]);
      setOutput(result);
    } catch(e) { setError("处理失败：" + e.message); }
    setProcessing(false);
  };

  const src = tab === "mic" ? accumulated : manualInput;
  return (
    <PageShell feature={feature} onBack={onBack}>
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        {[{v:"both",l:"文字稿+翻译"},{v:"transcript",l:"仅英文稿"},{v:"translate",l:"仅中文翻译"}].map(m=>(
          <button key={m.v} onClick={()=>setMode(m.v)} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, cursor:"pointer", background:mode===m.v?`${feature.glow}33`:"#0d1b2e", border:`1.5px solid ${mode===m.v?feature.glow:"#1e2d42"}`, color:mode===m.v?feature.glow:"#475569" }}>{m.l}</button>
        ))}
      </div>
      <TabSwitch tab={tab} setTab={setTab} glow={feature.glow} />
      {tab === "mic"
        ? <MicSection listening={listening} supported={supported} start={start} stop={stop} glow={feature.glow} accumulated={accumulated} interim={interim} label="点击后对着视频/说英文" />
        : <TextInput value={manualInput} onChange={setManualInput} label="粘贴英文字幕或文字稿" accent={feature.glow} placeholder="Paste English subtitle or speech content here..." rows={6} />
      }
      <ActionBtn onClick={()=>process(src)} loading={processing} disabled={!src.trim()} gradient={feature.gradient}>🎬 开始处理</ActionBtn>
      {error && <div style={{ marginTop:12, color:"#f87171", fontSize:13 }}>{error}</div>}
      {output && <ResultBox content={output} label="处理结果" accent={feature.glow} />}
    </PageShell>
  );
}

function StudyNotesPage({ feature, onBack }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [style, setStyle] = useState("structured");
  const [error, setError] = useState("");

  const styles = [{v:"structured",l:"结构化笔记"},{v:"cornell",l:"康奈尔笔记"},{v:"mindmap",l:"思维导图"}];

  const run = async () => {
    if (!input.trim()) return;
    setError(""); setProcessing(true);
    try {
      const sysMap = {
        structured: `生成结构化中文学习笔记：\n【核心概念】关键术语和定义\n【知识要点】分条列出重点（★标注难点）\n【知识关联】概念之间的联系\n【记忆技巧】助记方法\n【练习思考】3个巩固问题`,
        cornell: `康奈尔笔记法生成中文学习笔记：\n【笔记栏】详细内容\n【提示栏】关键词和问题（15字内）\n【总结栏】3-5句核心摘要`,
        mindmap: `整理成文字版思维导图格式的中文笔记，用缩进和符号表示层级关系，突出核心概念联系。`,
      };
      const result = await callClaude(input, sysMap[style]);
      setOutput(result);
    } catch(e) { setError("生成失败：" + e.message); }
    setProcessing(false);
  };

  const download = () => {
    const blob = new Blob([output], { type:"text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `学习笔记_${new Date().toLocaleDateString("zh-CN")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {styles.map(s=>(
          <button key={s.v} onClick={()=>setStyle(s.v)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, cursor:"pointer", background:style===s.v?`${feature.glow}33`:"#0d1b2e", border:`1.5px solid ${style===s.v?feature.glow:"#1e2d42"}`, color:style===s.v?feature.glow:"#475569" }}>{s.l}</button>
        ))}
      </div>
      <TextInput value={input} onChange={setInput} label="粘贴学习内容（视频字幕、教材、课堂记录等）" placeholder="粘贴学习内容..." accent={feature.glow} rows={7} />
      <ActionBtn onClick={run} loading={processing} disabled={!input.trim()} gradient={feature.gradient}>📚 生成学习笔记</ActionBtn>
      {error && <div style={{ marginTop:12, color:"#f87171", fontSize:13 }}>{error}</div>}
      {output && <ResultBox content={output} label={`📚 ${styles.find(s=>s.v===style)?.l}`} accent={feature.glow} onDownload={download} />}
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
      const sys = `英日双语词典助手，查询单词提供：\n【发音】音标 【词性】 【中文释义】2-3个含义\n【例句】典型用法（英文+中文） 【记忆联想】 【近义词】2-3个\n格式简洁，适合快速查阅。`;
      const ctx = subtitle ? `字幕上下文：${subtitle.slice(0,200)}\n` : "";
      const result = await callClaude(`${ctx}查询单词：${word}`, sys);
      setOutput(result);
      setWordList(wl => wl.find(w=>w.word===word) ? wl : [{word,result},...wl.slice(0,19)]);
    } catch(e) { setError("查询失败：" + e.message); }
    setProcessing(false);
  };

  const exportList = () => {
    const content = wordList.map(w=>`【${w.word}】\n${w.result}\n${"─".repeat(40)}`).join("\n\n");
    const blob = new Blob([content], { type:"text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `生词本_${new Date().toLocaleDateString("zh-CN")}.txt`; a.click();
  };

  return (
    <PageShell feature={feature} onBack={onBack}>
      <TextInput value={subtitle} onChange={setSubtitle} label="字幕内容（可选，提供上下文）" placeholder="Paste subtitle text here..." accent={feature.glow} rows={3} />
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:6 }}>查询单词</div>
        <div style={{ display:"flex", gap:10 }}>
          <input value={word} onChange={e=>setWord(e.target.value)} onKeyDown={e=>e.key==="Enter"&&lookup()} placeholder="输入英文单词，回车查询..."
            style={{ flex:1, background:"#0d1b2e", border:"1.5px solid #1e2d42", borderRadius:10, padding:"11px 14px", color:"#f1f5f9", fontSize:14, outline:"none", fontFamily:"system-ui" }}
            onFocus={e=>e.target.style.borderColor=feature.glow} onBlur={e=>e.target.style.borderColor="#1e2d42"} />
          <ActionBtn onClick={lookup} loading={processing} disabled={!word.trim()} gradient={feature.gradient}>查询</ActionBtn>
        </div>
      </div>
      {error && <div style={{ marginTop:12, color:"#f87171", fontSize:13 }}>{error}</div>}
      {output && <ResultBox content={output} label={`🔤 ${word}`} accent={feature.glow} />}
      {wordList.length > 0 && (
        <div style={{ marginTop:24 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ fontSize:12, color:"#475569" }}>生词本 ({wordList.length}个)</span>
            <button onClick={exportList} style={{ background:"none", border:`1px solid ${feature.glow}44`, color:feature.glow, borderRadius:6, padding:"4px 12px", fontSize:11, cursor:"pointer" }}>↓ 导出</button>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {wordList.map((w,i)=>(
              <button key={i} onClick={()=>{setWord(w.word);setOutput(w.result);}} style={{ background:"#0d1b2e", border:"1px solid #1e2d42", borderRadius:8, padding:"6px 14px", color:"#94a3b8", fontSize:13, cursor:"pointer", fontWeight:600 }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=feature.glow;e.currentTarget.style.color=feature.glow;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#1e2d42";e.currentTarget.style.color="#94a3b8";}}
              >{w.word}</button>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ── Home Screen ──────────────────────────────────────────────
function FeatureCard({ feature, hovered, onHover, onSelect }) {
  const isHov = hovered === feature.id;
  return (
    <button onClick={()=>onSelect(feature.id)} onMouseEnter={()=>onHover(feature.id)} onMouseLeave={()=>onHover(null)}
      style={{ background:isHov?feature.gradient:"#0d1b2e", border:`1.5px solid ${isHov?"transparent":"#1a2840"}`, borderRadius:18, padding:"20px 12px 18px", cursor:"pointer", textAlign:"center", transform:isHov?"translateY(-3px) scale(1.03)":"none", boxShadow:isHov?`0 10px 32px ${feature.glow}55`:"none", transition:"all 0.22s ease" }}>
      <div style={{ fontSize:30, marginBottom:10, lineHeight:1 }}>{feature.icon}</div>
      <div style={{ fontSize:12, fontWeight:700, color:isHov?"#fff":"#94a3b8", lineHeight:1.4, whiteSpace:"pre-line", fontFamily:"system-ui", transition:"color 0.22s" }}>{feature.title}</div>
      {feature.hasMic && <div style={{ marginTop:8, fontSize:10, color:isHov?"#ffffff99":"#1e2d42" }}>🎤 支持录音</div>}
    </button>
  );
}

function HomeScreen({ onSelect }) {
  const [hovered, setHovered] = useState(null);
  return (
    <div style={{ minHeight:"100vh", background:"#07111f", display:"flex", flexDirection:"column", alignItems:"center", padding:"36px 20px", fontFamily:"system-ui,-apple-system,sans-serif" }}>
      <div style={{ textAlign:"center", marginBottom:40 }}>
        <div style={{ fontSize:44, marginBottom:10, filter:"drop-shadow(0 0 18px #2563eb88)" }}>⚡</div>
        <h1 style={{ margin:0, fontSize:26, fontWeight:800, color:"#f1f5f9", letterSpacing:-0.5 }}>会议 & 学习助手</h1>
        <p style={{ margin:"6px 0 0", fontSize:13, color:"#334155" }}>AI · Meeting & Learning Suite</p>
      </div>
      <div style={{ width:"100%", maxWidth:500, marginBottom:8 }}>
        <div style={{ fontSize:11, color:"#334155", letterSpacing:2, fontWeight:700, marginBottom:12, paddingLeft:4 }}>会议功能</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          {FEATURES.filter(f=>f.tag==="会议").map(f=><FeatureCard key={f.id} feature={f} hovered={hovered} onHover={setHovered} onSelect={onSelect} />)}
        </div>
      </div>
      <div style={{ width:"100%", maxWidth:500, height:1, background:"#0f1e31", margin:"20px 0" }} />
      <div style={{ width:"100%", maxWidth:500 }}>
        <div style={{ fontSize:11, color:"#334155", letterSpacing:2, fontWeight:700, marginBottom:12, paddingLeft:4 }}>学习功能</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          {FEATURES.filter(f=>f.tag==="学习").map(f=><FeatureCard key={f.id} feature={f} hovered={hovered} onHover={setHovered} onSelect={onSelect} />)}
        </div>
      </div>
      <p style={{ marginTop:44, fontSize:11, color:"#0f1e31" }}>Powered by Claude AI</p>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────
export default function App() {
  const [current, setCurrent] = useState(null);
  const feature = FEATURES.find(f=>f.id===current);
  const back = () => setCurrent(null);
  if (!current) return <HomeScreen onSelect={setCurrent} />;
  switch (current) {
    case "jp-zh": case "jp-en": return <TranslatePage feature={feature} onBack={back} />;
    case "meeting-notes": return <MeetingNotesPage feature={feature} onBack={back} />;
    case "video-zh": return <VideoTranslatePage feature={feature} onBack={back} />;
    case "study-notes": return <StudyNotesPage feature={feature} onBack={back} />;
    case "vocab": return <VocabPage feature={feature} onBack={back} />;
    default: return <HomeScreen onSelect={setCurrent} />;
  }
}
