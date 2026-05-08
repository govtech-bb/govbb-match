// Static file server + /api/transcribe (local whisper.cpp).
// POC: opportunities are a static JSON in public/data/.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const MODEL = process.env.WHISPER_MODEL || path.join(ROOT, "models", "ggml-base.en.bin");

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
function float32ToWav(float32buf, sampleRate) {
  const sampleCount = float32buf.length / 4;
  const pcm16 = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const f = float32buf.readFloatLE(i * 4);
    const s = Math.max(-1, Math.min(1, f));
    pcm16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2);
  }
  const dataSize = pcm16.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);          // fmt chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Voice transcription. Body: raw Float32LE PCM, 16kHz, mono (decoded client-side).
  if (pathname === "/api/transcribe" && req.method === "POST") {
    if (!fs.existsSync(MODEL)) return sendJSON(res, 501, { error: `Whisper model not found at ${MODEL}` });

    const id = crypto.randomBytes(8).toString("hex");
    const wavFile = path.join(os.tmpdir(), `voice-${id}.wav`);

    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length < 4 * 1024 || buf.length % 4 !== 0) {
        return sendJSON(res, 400, { error: "Audio too short or empty." });
      }
      fs.writeFileSync(wavFile, float32ToWav(buf, 16000));

      const text = await new Promise((resolve, reject) => {
        const wc = spawn("whisper-cli", ["-m", MODEL, "-f", wavFile, "-nt", "-np", "-l", "en"], { stdio: ["ignore", "pipe", "pipe"] });
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
  console.log(`Opportunities POC running on http://localhost:${PORT}/`);
  console.log(`  /                  chat`);
  console.log(`  /opportunities/    browse + apply`);
  console.log(`  /api/transcribe    local whisper.cpp`);
});
