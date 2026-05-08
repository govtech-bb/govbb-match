// Vercel serverless function: local-ish Whisper via @xenova/transformers
// (ONNX Whisper-tiny.en running in Node WASM). No external API.
//
// Body:  raw Float32 PCM, 16kHz, mono (decoded client-side)
// Reply: { text: "..." }
//
// Cold start: ~10-15s while the model downloads to /tmp. Warm: ~2-4s.

import { pipeline, env } from "@xenova/transformers";

// Cache model files in /tmp (the only writable path on Vercel functions).
env.cacheDir = "/tmp/transformers-cache";
env.allowLocalModels = false;

const MODEL_ID = process.env.WHISPER_MODEL_ID || "Xenova/whisper-tiny.en";

let pipePromise = null;
function getPipe() {
  if (!pipePromise) {
    pipePromise = pipeline("automatic-speech-recognition", MODEL_ID, { quantized: true })
      .catch((e) => { pipePromise = null; throw e; });
  }
  return pipePromise;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (buf.length < 4 * 1024) {
      return res.status(400).json({ error: "Audio too short or empty." });
    }
    if (buf.length % 4 !== 0) {
      return res.status(400).json({ error: "Body must be raw Float32 PCM (length divisible by 4)." });
    }

    // Reinterpret bytes as Float32 (must be aligned — copy to be safe)
    const samples = new Float32Array(buf.length / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(i * 4);

    const pipe = await getPipe();
    const result = await pipe(samples, { language: "english", task: "transcribe", chunk_length_s: 30 });
    return res.status(200).json({ text: (result?.text || "").trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
