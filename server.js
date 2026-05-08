// Local dev server. Mirrors the Vercel functions in api/.
//
// /api/transcribe and /api/tts will use Cloudflare Workers AI when these env
// vars are set:
//   CF_ACCOUNT_ID, CF_API_TOKEN
// Otherwise they fall back to local whisper.cpp + piper-tts.
//
// Run with Cloudflare locally:
//   CF_ACCOUNT_ID=xxx CF_API_TOKEN=yyy node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

// Tiny .env loader — no deps. Skips if file missing.
(() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, k] = m;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {}
})();

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");

// Local fallbacks
const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(ROOT, "models", "ggml-base.en.bin");
const PIPER_MODEL = process.env.PIPER_MODEL || path.join(ROOT, "models", "piper", "en_US-lessac-medium.onnx");
const PIPER_PYTHON = process.env.PIPER_PYTHON || "python3";

// Cloudflare config (when present, used in preference to local)
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN || process.env.CF_ACCOUNT_API_TOKEN;
const CF_WHISPER_MODEL = process.env.CF_WHISPER_MODEL || "@cf/openai/whisper-tiny-en";
const CF_TTS_MODEL = process.env.CF_TTS_MODEL || "@cf/myshell-ai/melotts";
const CF_TTS_LANG = process.env.CF_TTS_LANG || "en";
const useCloudflare = Boolean(CF_ACCOUNT_ID && CF_API_TOKEN);

// Anthropic
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Wrap Float32LE PCM samples (16kHz mono) as a 16-bit PCM WAV file.
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

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ---- /api/transcribe ----
async function handleTranscribeCloudflare(req, res) {
  try {
    const buf = await readBody(req);
    if (buf.length < 4 * 1024 || buf.length % 4 !== 0) {
      return sendJSON(res, 400, { error: "Audio too short or empty." });
    }
    const wav = float32ToWav(buf, 16000);
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_WHISPER_MODEL}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/octet-stream" },
      body: wav,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.success) {
      const err = data?.errors?.[0]?.message || r.statusText;
      return sendJSON(res, r.status || 500, { error: "Cloudflare AI error: " + String(err).slice(0, 300) });
    }
    return sendJSON(res, 200, { text: (data.result?.text || "").trim() });
  } catch (e) { return sendJSON(res, 500, { error: e.message }); }
}

async function handleTranscribeLocal(req, res) {
  if (!fs.existsSync(WHISPER_MODEL)) return sendJSON(res, 501, { error: `Whisper model not found at ${WHISPER_MODEL}` });
  const id = crypto.randomBytes(8).toString("hex");
  const wavFile = path.join(os.tmpdir(), `voice-${id}.wav`);
  try {
    const buf = await readBody(req);
    if (buf.length < 4 * 1024 || buf.length % 4 !== 0) {
      return sendJSON(res, 400, { error: "Audio too short or empty." });
    }
    fs.writeFileSync(wavFile, float32ToWav(buf, 16000));
    const text = await new Promise((resolve, reject) => {
      const wc = spawn("whisper-cli", ["-m", WHISPER_MODEL, "-f", wavFile, "-nt", "-np", "-l", "en"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      wc.stdout.on("data", (c) => (out += c));
      wc.stderr.on("data", (c) => (err += c));
      wc.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("whisper failed: " + err.slice(-300))));
      wc.on("error", reject);
    });
    return sendJSON(res, 200, { text });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  } finally {
    fs.rmSync(wavFile, { force: true });
  }
}

// ---- /api/tts ----
async function handleTtsCloudflare(req, res) {
  try {
    const body = await readBody(req);
    let text = "";
    try { text = JSON.parse(body.toString("utf8")).text || ""; } catch {}
    text = String(text).trim().slice(0, 2000);
    if (!text) return sendJSON(res, 400, { error: "text required" });

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_TTS_MODEL}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, lang: CF_TTS_LANG }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.success) {
      const err = data?.errors?.[0]?.message || r.statusText;
      return sendJSON(res, r.status || 500, { error: "Cloudflare TTS error: " + String(err).slice(0, 300) });
    }
    const b64 = data.result?.audio;
    if (!b64) return sendJSON(res, 500, { error: "No audio in response." });
    const audio = Buffer.from(b64, "base64");
    // CF MeloTTS returns WAV; detect by magic bytes in case that ever changes.
    const isWav = audio.length > 4 && audio.slice(0, 4).toString("ascii") === "RIFF";
    res.writeHead(200, {
      "Content-Type": isWav ? "audio/wav" : "audio/mpeg",
      "Content-Length": audio.length,
    });
    return res.end(audio);
  } catch (e) { return sendJSON(res, 500, { error: e.message }); }
}

async function handleTtsLocal(req, res) {
  if (!fs.existsSync(PIPER_MODEL)) return sendJSON(res, 501, { error: `Piper voice not found at ${PIPER_MODEL}` });
  try {
    const body = await readBody(req);
    let text = "";
    try { text = JSON.parse(body.toString("utf8")).text || ""; } catch {}
    text = String(text).trim().slice(0, 2000);
    if (!text) return sendJSON(res, 400, { error: "text required" });

    const id = crypto.randomBytes(8).toString("hex");
    const wav = path.join(os.tmpdir(), `tts-${id}.wav`);
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(PIPER_PYTHON, ["-m", "piper", "-m", PIPER_MODEL, "-f", wav], { stdio: ["pipe", "ignore", "pipe"] });
        let err = "";
        p.stderr.on("data", (c) => (err += c));
        p.on("close", (code) => code === 0 ? resolve() : reject(new Error("piper failed: " + err.slice(-300))));
        p.on("error", reject);
        p.stdin.write(text); p.stdin.end();
      });
      const buf = fs.readFileSync(wav);
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": buf.length });
      return res.end(buf);
    } finally {
      fs.rmSync(wav, { force: true });
    }
  } catch (e) { return sendJSON(res, 500, { error: e.message }); }
}

// ---- /api/chat ----
let _opps = null;
function loadOpps() {
  if (_opps) return _opps;
  _opps = JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", "opportunities.json"), "utf8"));
  return _opps;
}

async function handleChat(req, res) {
  if (!ANTHROPIC_API_KEY) return sendJSON(res, 200, { type: "fallback" });
  try {
    const buf = await readBody(req);
    let body = {};
    try { body = JSON.parse(buf.toString("utf8")); } catch {}
    const opps = loadOpps();
    const compactOpps = opps.map((o) => ({
      id: o.id, title: o.title, category: o.category,
      description: (o.description || "").slice(0, 280),
      eligibility: o.eligibility || {}, tags: o.tags || [],
    }));
    const system = `You are a friendly assistant for the Government of Barbados opportunities platform. You help citizens find the right programmes (scholarships, business grants, youth training, mentorship, community programs).

Your job: through a short conversation (2–4 questions max), gather just enough about the user — age, interests, situation — to recommend 3–8 strongly relevant opportunities from the list below. Ask ONE question at a time. Keep questions short and warm. When you have enough info, call present_matches with the IDs.

Rules:
- Always call exactly ONE tool: ask_question OR present_matches.
- Don't ask for personal contact info (name, email, phone) — that comes later.
- Respect eligibility (ageMin/ageMax/citizenship). Skip ineligible opportunities.
- Prefer quality over quantity: 3–8 strong matches beats 15 weak ones.
- If the user answers vaguely, ask one clarifying question, then commit.

Available opportunities (JSON):
${JSON.stringify(compactOpps)}`;

    const messages = [];
    for (const m of (body.history || [])) {
      if (m && m.role && m.content) messages.push({ role: m.role, content: String(m.content) });
    }
    if (body.userMessage) messages.push({ role: "user", content: String(body.userMessage) });
    if (!messages.length) messages.push({ role: "user", content: "Hi" });

    const tools = [
      { name: "ask_question", description: "Ask the user a single short question to gather more info before matching.",
        input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
      { name: "present_matches", description: "Return the final shortlist of recommended opportunity IDs.",
        input_schema: { type: "object",
          properties: {
            intro: { type: "string" },
            opportunity_ids: { type: "array", items: { type: "string" } },
          }, required: ["intro", "opportunity_ids"] } },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 512, system, tools, tool_choice: { type: "any" }, messages }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      const err = data?.error?.message || r.statusText;
      return sendJSON(res, r.status || 500, { error: "Anthropic error: " + String(err).slice(0, 300) });
    }
    const toolUse = (data.content || []).find((c) => c.type === "tool_use");
    if (!toolUse) {
      const text = (data.content || []).find((c) => c.type === "text")?.text || "Tell me about your interests.";
      return sendJSON(res, 200, { type: "question", text });
    }
    if (toolUse.name === "ask_question") {
      return sendJSON(res, 200, { type: "question", text: toolUse.input?.question || "Tell me more." });
    }
    if (toolUse.name === "present_matches") {
      const ids = Array.isArray(toolUse.input?.opportunity_ids) ? toolUse.input.opportunity_ids : [];
      const validIds = ids.filter((id) => opps.some((o) => o.id === id));
      return sendJSON(res, 200, { type: "matches", ids: validIds, intro: toolUse.input?.intro || "Here are some opportunities for you." });
    }
    return sendJSON(res, 200, { type: "question", text: "Tell me more." });
  } catch (e) { return sendJSON(res, 500, { error: e.message }); }
}

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname === "/api/transcribe" && req.method === "POST") {
    return useCloudflare ? handleTranscribeCloudflare(req, res) : handleTranscribeLocal(req, res);
  }
  if (pathname === "/api/tts" && req.method === "POST") {
    return useCloudflare ? handleTtsCloudflare(req, res) : handleTtsLocal(req, res);
  }
  if (pathname === "/api/chat" && req.method === "POST") {
    return handleChat(req, res);
  }

  // Static files
  let filePath = pathname === "/" || pathname === "" ? path.join(PUBLIC, "index.html") : path.join(PUBLIC, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, "forbidden");
  if (!fs.existsSync(filePath)) return send(res, 404, "not found");

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  const backend = useCloudflare ? `Cloudflare Workers AI (${CF_WHISPER_MODEL})` : "local whisper.cpp + piper";
  console.log(`Opportunities POC running on http://localhost:${PORT}/`);
  console.log(`  voice backend: ${backend}`);
});
