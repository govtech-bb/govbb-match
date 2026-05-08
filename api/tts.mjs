// Vercel serverless function — TTS via Cloudflare Workers AI (MeloTTS).
// Body:  { text: "..." }
// Reply: audio/mpeg (MP3) bytes
//
// Env vars:
//   CF_ACCOUNT_ID, CF_API_TOKEN  (same as /api/transcribe)
// Optional:
//   CF_TTS_MODEL  — defaults to "@cf/myshell-ai/melotts"
//   CF_TTS_LANG   — defaults to "en"

const DEFAULT_MODEL = "@cf/myshell-ai/melotts";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN || process.env.CF_ACCOUNT_API_TOKEN;
  const model = process.env.CF_TTS_MODEL || DEFAULT_MODEL;
  const lang = process.env.CF_TTS_LANG || "en";
  if (!accountId || !apiToken) {
    return res.status(501).json({ error: "CF_ACCOUNT_ID and CF_API_TOKEN must be set." });
  }

  try {
    const text = String((req.body && req.body.text) || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "text required" });

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: text, lang }),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.success) {
      const err = data?.errors?.[0]?.message || (await r.text().catch(() => "")) || r.statusText;
      return res.status(r.status || 500).json({ error: "Cloudflare TTS error: " + String(err).slice(0, 300) });
    }

    const b64 = data.result?.audio;
    if (!b64) return res.status(500).json({ error: "No audio in response." });
    const audio = Buffer.from(b64, "base64");
    const isWav = audio.length > 4 && audio.slice(0, 4).toString("ascii") === "RIFF";
    res.setHeader("Content-Type", isWav ? "audio/wav" : "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    return res.status(200).send(audio);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
