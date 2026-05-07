// Vanilla Node http server. No deps.
// Serves /admin, /matcher static apps + JSON API.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "opportunities.json");
const APPS_FILE = path.join(ROOT, "data", "applications.json");
const PUBLIC = path.join(ROOT, "public");

if (!fs.existsSync(APPS_FILE)) fs.writeFileSync(APPS_FILE, "[]");
function readApps() { return JSON.parse(fs.readFileSync(APPS_FILE, "utf8")); }
function writeApps(list) { fs.writeFileSync(APPS_FILE, JSON.stringify(list, null, 2)); }

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function readOpps() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeOpps(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
  res.end(body);
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// Score opportunity vs answers. Higher = better fit.
function scoreOpp(opp, a) {
  let score = 0;
  const reasons = [];
  const elig = opp.eligibility || {};
  if (a.age != null) {
    if (elig.ageMin != null && a.age < elig.ageMin) return { score: -1, reasons: ["below min age"] };
    if (elig.ageMax != null && a.age > elig.ageMax) return { score: -1, reasons: ["above max age"] };
    if (elig.ageMin != null || elig.ageMax != null) { score += 1; reasons.push("age fits"); }
  }
  if (a.citizenship && elig.citizenship && a.citizenship !== elig.citizenship) {
    return { score: -1, reasons: ["citizenship mismatch"] };
  }
  const userInterests = (a.interests || []).map((s) => s.toLowerCase());
  const oppInterests = (elig.interests || []).map((s) => s.toLowerCase());
  const tagPool = new Set([...(opp.tags || []).map((s) => s.toLowerCase()), ...oppInterests]);
  const matched = userInterests.filter((i) => tagPool.has(i));
  score += matched.length * 2;
  if (matched.length) reasons.push(`matches: ${matched.join(", ")}`);
  return { score, reasons };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") return send(res, 204, "");

  // API
  if (pathname === "/api/opportunities" && req.method === "GET") {
    return sendJSON(res, 200, readOpps());
  }
  if (pathname === "/api/opportunities" && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (!body.title) return sendJSON(res, 400, { error: "title required" });
      const list = readOpps();
      const opp = {
        id: body.id || body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
        title: body.title,
        category: body.category || "other",
        description: body.description || "",
        tags: body.tags || [],
        eligibility: body.eligibility || {},
        deadline: body.deadline || null,
        url: body.url || null,
      };
      list.push(opp);
      writeOpps(list);
      return sendJSON(res, 201, opp);
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  const delMatch = pathname.match(/^\/api\/opportunities\/([^/]+)$/);
  if (delMatch && req.method === "DELETE") {
    const id = decodeURIComponent(delMatch[1]);
    const list = readOpps().filter((o) => o.id !== id);
    writeOpps(list);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === "/api/transcribe" && req.method === "POST") {
    // Whisper-style transcription via OpenAI. Set OPENAI_API_KEY to enable.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return sendJSON(res, 501, { error: "Server transcription not configured. Set OPENAI_API_KEY env var." });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const ctype = req.headers["content-type"] || "";
      // Forward multipart body straight to OpenAI Whisper.
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": ctype, "Content-Length": String(buf.length) },
        body: buf,
      });
      if (!r.ok) { const t = await r.text(); return sendJSON(res, r.status, { error: "Upstream error: " + t.slice(0, 200) }); }
      const out = await r.json();
      return sendJSON(res, 200, { text: out.text || "" });
    } catch (e) { return sendJSON(res, 500, { error: e.message }); }
  }
  if (pathname === "/api/applications" && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (!body.opportunityId || !body.data) return sendJSON(res, 400, { error: "opportunityId and data required" });
      const list = readApps();
      const reference = "APP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const record = {
        reference,
        opportunityId: body.opportunityId,
        opportunityTitle: body.opportunityTitle || null,
        data: body.data,
        submittedAt: new Date().toISOString(),
      };
      list.push(record);
      writeApps(list);
      return sendJSON(res, 201, record);
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (pathname === "/api/applications" && req.method === "GET") {
    return sendJSON(res, 200, readApps());
  }
  if (pathname === "/api/match" && req.method === "POST") {
    try {
      const answers = await readBody(req);
      const ranked = readOpps()
        .map((o) => ({ ...o, _score: scoreOpp(o, answers) }))
        .filter((o) => o._score.score >= 0)
        .sort((a, b) => b._score.score - a._score.score);
      return sendJSON(res, 200, ranked);
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }

  // Static
  let filePath;
  if (pathname === "/" || pathname === "") {
    filePath = path.join(PUBLIC, "index.html");
  } else {
    filePath = path.join(PUBLIC, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  }
  // Block path traversal
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, "forbidden");
  if (!fs.existsSync(filePath)) return send(res, 404, "not found");
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`opportunities-platform running:`);
  console.log(`  admin    http://localhost:${PORT}/admin/`);
  console.log(`  matcher  http://localhost:${PORT}/matcher/`);
  console.log(`  api      http://localhost:${PORT}/api/opportunities`);
});
