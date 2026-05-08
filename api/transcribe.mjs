// Vercel serverless function — STT via Cloudflare Workers AI (Whisper).
// Body: raw Float32LE PCM, 16kHz, mono (decoded client-side, matches local).
// Reply: { text: "..." }
//
// Env vars (set in Vercel project settings):
//   CF_ACCOUNT_ID    — your Cloudflare account ID
//   CF_API_TOKEN     — token with "Workers AI" read permission
// Optional:
//   CF_WHISPER_MODEL — defaults to "@cf/openai/whisper-large-v3-turbo"

export const config = { api: { bodyParser: false } };

const DEFAULT_MODEL = "@cf/openai/whisper-tiny-en";

// Wrap Float32LE PCM as 16-bit PCM WAV. Cloudflare Whisper accepts WAV.
function float32ToWav(buf, sampleRate) {
  const sampleCount = buf.length / 4;
  const pcm16 = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const f = buf.readFloatLE(i * 4);
    const s = Math.max(-1, Math.min(1, f));
    pcm16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2);
  }
  const dataSize = pcm16.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm16]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN || process.env.CF_ACCOUNT_API_TOKEN;
  const model = process.env.CF_WHISPER_MODEL || DEFAULT_MODEL;
  if (!accountId || !apiToken) {
    return res.status(501).json({ error: "CF_ACCOUNT_ID and CF_API_TOKEN must be set." });
  }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (buf.length < 4 * 1024 || buf.length % 4 !== 0) {
      return res.status(400).json({ error: "Audio too short or empty." });
    }
    const wav = float32ToWav(buf, 16000);

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: wav,
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.success) {
      const err = data?.errors?.[0]?.message || (await r.text().catch(() => "")) || r.statusText;
      return res.status(r.status || 500).json({ error: "Cloudflare AI error: " + String(err).slice(0, 300) });
    }
    return res.status(200).json({ text: (data.result?.text || "").trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
