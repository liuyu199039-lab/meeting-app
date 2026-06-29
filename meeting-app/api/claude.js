export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userMsg, systemMsg } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ result: "错误：服务器没有读取到 API Key，请检查 Vercel 环境变量设置。" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: systemMsg,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ result: "API错误：" + (data.error.message || JSON.stringify(data.error)) });
    }

    const text = data.content?.[0]?.text;
    if (!text) {
      return res.status(200).json({ result: "未知响应：" + JSON.stringify(data).slice(0, 300) });
    }

    res.status(200).json({ result: text });
  } catch (err) {
    res.status(200).json({ result: "请求异常：" + err.message });
  }
}
