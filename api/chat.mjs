// Vercel serverless function — conversational matching via Claude Haiku.
// Body: { history: [{role, content}, ...], userMessage }
// Reply: { type: "question", text } | { type: "matches", ids: [...], intro }
//        | { type: "fallback" } when no API key is configured (client uses regex flow)
//
// Env vars:
//   ANTHROPIC_API_KEY  — required for AI flow; missing → fallback response
//   ANTHROPIC_MODEL    — defaults to claude-haiku-4-5

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const config = { api: { bodyParser: true } };

const DEFAULT_MODEL = "claude-haiku-4-5";

let _opps = null;
function loadOpps() {
  if (_opps) return _opps;
  const p = join(process.cwd(), "public", "data", "opportunities.json");
  _opps = JSON.parse(readFileSync(p, "utf8"));
  return _opps;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ type: "fallback" });

  try {
    const out = await runChat(req.body || {}, apiKey, process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, loadOpps());
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export async function runChat({ history = [], userMessage = "" }, apiKey, model, opps) {
  const compactOpps = opps.map((o) => ({
    id: o.id,
    title: o.title,
    category: o.category,
    description: (o.description || "").slice(0, 280),
    eligibility: o.eligibility || {},
    tags: o.tags || [],
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
  for (const m of history) {
    if (m && m.role && m.content) messages.push({ role: m.role, content: String(m.content) });
  }
  if (userMessage) messages.push({ role: "user", content: String(userMessage) });
  if (!messages.length) messages.push({ role: "user", content: "Hi" });

  const tools = [
    {
      name: "ask_question",
      description: "Ask the user a single short question to gather more info before matching.",
      input_schema: {
        type: "object",
        properties: { question: { type: "string", description: "The question to ask, in a friendly conversational tone." } },
        required: ["question"],
      },
    },
    {
      name: "present_matches",
      description: "Return the final shortlist of recommended opportunity IDs.",
      input_schema: {
        type: "object",
        properties: {
          intro: { type: "string", description: "One short sentence introducing the matches (e.g., 'Here are 5 that fit you well')." },
          opportunity_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of recommended opportunities, ordered best-first (3–8 items).",
          },
        },
        required: ["intro", "opportunity_ids"],
      },
    },
  ];

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 512, system, tools, tool_choice: { type: "any" }, messages }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) {
    const err = data?.error?.message || r.statusText;
    throw new Error("Anthropic error: " + String(err).slice(0, 300));
  }

  const toolUse = (data.content || []).find((c) => c.type === "tool_use");
  if (!toolUse) {
    const text = (data.content || []).find((c) => c.type === "text")?.text || "Tell me about your interests.";
    return { type: "question", text };
  }
  if (toolUse.name === "ask_question") {
    return { type: "question", text: toolUse.input?.question || "Tell me more." };
  }
  if (toolUse.name === "present_matches") {
    const ids = Array.isArray(toolUse.input?.opportunity_ids) ? toolUse.input.opportunity_ids : [];
    const validIds = ids.filter((id) => opps.some((o) => o.id === id));
    return { type: "matches", ids: validIds, intro: toolUse.input?.intro || "Here are some opportunities for you." };
  }
  return { type: "question", text: "Tell me more about what you're looking for." };
}
