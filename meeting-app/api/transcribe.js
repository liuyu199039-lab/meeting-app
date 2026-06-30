// Transcribes a short WAV clip with OpenAI gpt-4o-transcribe (excellent Japanese).
// The browser captures gapless audio, slices it on pauses, and posts each clip here.
export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ error: "服务器没有读取到 OPENAI_API_KEY，请在 Vercel 环境变量里设置。" });
  }

  try {
    const { audio, language } = req.body;
    if (!audio) return res.status(200).json({ text: "" });

    const buf = Buffer.from(audio, "base64");
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
    form.append("model", "gpt-4o-transcribe");
    if (language) form.append("language", language);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: form,
    });
    const data = await r.json();
    if (data.error) return res.status(200).json({ error: data.error.message || JSON.stringify(data.error) });
    res.status(200).json({ text: data.text || "" });
  } catch (err) {
    res.status(200).json({ error: "请求异常：" + err.message });
  }
}
