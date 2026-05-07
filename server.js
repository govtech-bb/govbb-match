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

  // Voice transcription — the only API endpoint.
  if (pathname === "/api/transcribe" && req.method === "POST") {
    if (!fs.existsSync(MODEL)) return sendJSON(res, 501, { error: `Whisper model not found at ${MODEL}` });

    const id = crypto.randomBytes(8).toString("hex");
    const tmp = os.tmpdir();
    const inFile = path.join(tmp, `voice-${id}.bin`);
    const wavFile = path.join(tmp, `voice-${id}.wav`);

    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      fs.writeFileSync(inFile, Buffer.concat(chunks));

      await new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", ["-y", "-i", inFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavFile], { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        ff.stderr.on("data", (c) => (err += c));
        ff.on("close", (code) => code === 0 ? resolve() : reject(new Error("ffmpeg failed: " + err.slice(-300))));
        ff.on("error", reject);
      });

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
      fs.rmSync(inFile, { force: true });
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
