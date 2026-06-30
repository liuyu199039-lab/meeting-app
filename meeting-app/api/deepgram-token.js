// Mints a short-lived Deepgram token so the browser can connect directly to
// Deepgram's live WebSocket without ever seeing the real API key.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(200).json({ error: "服务器没有读取到 DEEPGRAM_API_KEY，请在 Vercel 环境变量里设置。" });
  }

  try {
    const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: "Token " + process.env.DEEPGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) {
      return res.status(200).json({ error: "Deepgram token 失败：" + JSON.stringify(data).slice(0, 200) });
    }
    res.status(200).json({ token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    res.status(200).json({ error: "请求异常：" + err.message });
  }
}
