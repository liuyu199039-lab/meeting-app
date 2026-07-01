// Mints a short-lived client secret for an OpenAI Realtime *transcription*
// session, so the browser can open a WebRTC connection directly to OpenAI
// without ever seeing the real API key.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ error: "服务器没有读取到 OPENAI_API_KEY，请在 Vercel 环境变量里设置。" });
  }

  try {
    const { language } = req.body || {};
    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: { model: "gpt-4o-transcribe", language: language || "ja" },
              turn_detection: { type: "server_vad", silence_duration_ms: 500 },
            },
          },
        },
      }),
    });
    const data = await r.json();
    const token = data.value || data.client_secret?.value;
    if (!token) return res.status(200).json({ error: "Realtime token 失败：" + JSON.stringify(data).slice(0, 300) });
    res.status(200).json({ token });
  } catch (err) {
    res.status(200).json({ error: "请求异常：" + err.message });
  }
}
