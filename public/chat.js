// Conversational chat shell + voice input.
// Matching strategy:
// - Extract age + interests from each user message.
// - Ask follow-ups until both are known.
// - POST {age, interests} to /api/match and render ranked results.

const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");

const AUTO_SEND_DELAY_MS = 1500;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---------- Conversation state ----------
const state = {
  age: null,
  interests: [],
  hasShownMatches: false,
  selected: [],   // [{id, title}] queued from swipe-right; cleared when application starts
  applying: null, // { selected: [...], step, answers }
};

function refreshAllDeckFooters() {
  document.querySelectorAll("[data-deck]").forEach((el) => {
    if (typeof el._refreshFooter === "function") el._refreshFooter();
  });
}

const BARBADOS_PARISHES = [
  "Christ Church",
  "Saint Andrew",
  "Saint George",
  "Saint James",
  "Saint John",
  "Saint Joseph",
  "Saint Lucy",
  "Saint Michael",
  "Saint Peter",
  "Saint Philip",
  "Saint Thomas",
];

// Questions we ask before submitting an application.
const APPLICATION_QUESTIONS = [
  { key: "fullName", prompt: "What's your full name?", validate: (v) => v.trim().length >= 2 || "Please enter your full name." },
  { key: "email", prompt: "What's your email address?", validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "That doesn't look like a valid email — try again." },
  { key: "phone", prompt: "What's the best phone number to reach you on?", validate: (v) => v.replace(/\D/g, "").length >= 7 || "Please enter a valid phone number." },
  { key: "parish", prompt: "Which parish do you live in?", options: BARBADOS_PARISHES, validate: (v) => v.trim().length >= 2 || "Please enter your parish." },
  { key: "motivation", prompt: "In a sentence or two, why are you interested in this opportunity?", validate: (v) => v.trim().length >= 5 || "Please give a short reason (at least a few words)." },
];

// Synonyms → canonical interest tokens that match opportunities.json tags / eligibility.interests.
const INTEREST_SYNONYMS = {
  // tech
  tech: ["tech", "technology", "computers", "computing", "coding", "programming", "software", "developer", "it"],
  cybersecurity: ["cybersecurity", "cyber", "cyber-security", "security", "infosec"],
  digital: ["digital"],
  // creative
  arts: ["arts", "art", "drawing", "painting", "music", "dance", "theatre", "theater", "performance"],
  creative: ["creative", "creativity"],
  design: ["design", "graphics", "illustration"],
  animation: ["animation", "animator", "anime"],
  // skills / career
  trades: ["trades", "trade", "carpentry", "construction", "mechanic", "electrician", "plumbing", "welding", "automotive", "bodywork"],
  vocational: ["vocational", "tvet"],
  training: ["training"],
  skills: ["skills", "skill"],
  career: ["career", "careers"],
  employment: ["employment", "job", "jobs", "work"],
  mentorship: ["mentorship", "mentor", "mentoring"],
  leadership: ["leadership", "leader"],
  // entrepreneurship
  business: ["business", "startup"],
  entrepreneurship: ["entrepreneurship", "entrepreneur", "enterprise"],
  // wellbeing / community
  wellness: ["wellness", "wellbeing", "well-being", "fitness"],
  health: ["health", "healthcare", "medical"],
  community: ["community", "neighbourhood", "neighborhood"],
  volunteer: ["volunteer", "volunteering"],
  sustainability: ["sustainability", "sustainable", "environment", "environmental", "green", "climate"],
  // education
  education: ["education", "school", "schooling", "study", "studying", "learning", "academic"],
  reading: ["reading", "books", "literacy"],
  // life admin
  finance: ["finance", "financial", "money", "banking"],
  tax: ["tax", "taxes"],
  // recreation
  sports: ["sports", "sport", "football", "cricket", "athletics"],
  recreation: ["recreation", "recreational", "fun"],
  "summer-camp": ["camp", "summer-camp", "summer camp"],
  development: ["development"],
};

// Interests we *prompt* with — keep this list short and human.
const SUGGESTED_INTERESTS = [
  "arts", "tech", "business", "sports", "community",
  "education", "leadership", "sustainability", "trades", "employment",
];

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function append(role, text, extraHtml = "") {
  const row = document.createElement("div");
  row.className = `msg msg--${role}`;
  row.innerHTML = `<div class="msg__text govbb-text-body">${esc(text)}${extraHtml}</div>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}
input.addEventListener("input", () => { autosize(); cancelAutoSend(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

const INITIAL_GREETING = "Hi! I'm here to help you find opportunities. Tell me a bit about yourself — your age, and what you're interested in (e.g., arts, tech, business, sports, community, education).";

function resetChat() {
  state.age = null;
  state.interests = [];
  state.selected = [];
  state.applying = null;
  state.hasShownMatches = false;
  log.innerHTML = "";
  input.value = "";
  autosize();
  cancelAutoSend();
  micStatus.textContent = "";
  append("bot", INITIAL_GREETING);
}

append("bot", INITIAL_GREETING);

// ---------- Parsing ----------
function parseAge(text) {
  const t = text.toLowerCase();
  const patterns = [
    /\b(\d{1,2})\s*(?:years?\s*old|y\/?o|yrs?)\b/,
    /\b(?:i\s*'?\s*am|i\s*am|im|i'm|age(?:d)?(?:\s*is)?)\s*[:\-]?\s*(\d{1,2})\b/,
    /\bage\s*[:=]\s*(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 120) return n;
    }
  }
  // Bare number on its own (e.g. user replies "18" to the age question).
  const bare = t.match(/^\s*(\d{1,2})\s*$/);
  if (bare) {
    const n = parseInt(bare[1], 10);
    if (n >= 1 && n <= 120) return n;
  }
  return null;
}

function parseInterests(text) {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ") + " ";
  const found = new Set();
  for (const [canonical, synonyms] of Object.entries(INTEREST_SYNONYMS)) {
    for (const syn of synonyms) {
      const re = new RegExp(`(^|[^a-z0-9-])${syn.replace(/[-\s]/g, "[-\\s]")}(?=$|[^a-z0-9-])`, "i");
      if (re.test(t)) { found.add(canonical); break; }
    }
  }
  return Array.from(found);
}

function mergeInterests(existing, incoming) {
  const set = new Set(existing);
  for (const i of incoming) set.add(i);
  return Array.from(set);
}

// ---------- Success stories (deterministic per opportunity) ----------
const SUCCESS_PEOPLE = [
  { name: "Shanice", gender: "women", idx: 32 },
  { name: "Kemar", gender: "men", idx: 14 },
  { name: "Aliyah", gender: "women", idx: 47 },
  { name: "Renaldo", gender: "men", idx: 22 },
  { name: "Imani", gender: "women", idx: 5 },
  { name: "Tre", gender: "men", idx: 67 },
  { name: "Jada", gender: "women", idx: 12 },
  { name: "Khalil", gender: "men", idx: 41 },
  { name: "Kayla", gender: "women", idx: 70 },
  { name: "Zane", gender: "men", idx: 88 },
  { name: "Arielle", gender: "women", idx: 19 },
  { name: "Damarion", gender: "men", idx: 53 },
];

const SUCCESS_QUOTES = [
  "{program} helped me find work I'm proud of.",
  "Joining {program} gave me confidence I never had before.",
  "I made friends for life through {program} — and got a real skill out of it.",
  "Without {program}, I wouldn't be where I am today.",
  "{program} opened doors I didn't know existed.",
  "I came in shy and left ready to lead, thanks to {program}.",
  "{program} taught me more in a few months than years of school did.",
  "I'm running my own thing now — all because {program} pushed me.",
  "{program} showed me the community has my back.",
  "Best decision I ever made was applying to {program}.",
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function successStory(opp) {
  const h = hashString(opp.id || opp.title || "x");
  const person = SUCCESS_PEOPLE[h % SUCCESS_PEOPLE.length];
  const template = SUCCESS_QUOTES[(h >> 5) % SUCCESS_QUOTES.length];
  return {
    name: person.name,
    photo: `https://randomuser.me/api/portraits/${person.gender}/${person.idx}.jpg`,
    quote: template.replace("{program}", opp.title),
  };
}

// ---------- Rendering matches (Tinder-style swipeable deck) ----------
function renderDeckHtml(matches) {
  if (!matches.length) {
    return `<p class="govbb-text-body" style="margin-top:var(--spacing-s)">I couldn't find a match yet. Try adding a different interest, or <a class="govbb-link" href="/opportunities/">browse all opportunities</a>.</p>`;
  }
  const top = matches.slice(0, 10);
  const cards = top.map((m, i) => {
    const reasons = (m._score && m._score.reasons) ? m._score.reasons.join(" · ") : "";
    const link = m.url
      ? `<a class="govbb-link match-card__link" href="${esc(m.url)}" target="_blank" rel="noopener">Learn more →</a>`
      : "";
    const story = successStory(m);
    return `
      <article class="match-card" data-index="${i}" data-id="${esc(m.id)}" data-title="${esc(m.title)}">
        <div class="match-card__stamp match-card__stamp--like" aria-hidden="true">Save</div>
        <div class="match-card__stamp match-card__stamp--nope" aria-hidden="true">Skip</div>
        <h4 class="govbb-text-h4 match-card__title">${esc(m.title)}</h4>
        <p class="govbb-text-caption match-card__meta">${esc(m.category || "")}${reasons ? ` · ${esc(reasons)}` : ""}</p>
        <p class="govbb-text-body match-card__desc">${esc(m.description || "")}</p>
        ${link}
        <figure class="match-card__story">
          <img class="match-card__story-photo" src="${esc(story.photo)}" alt="Photo of ${esc(story.name)}, ${esc(m.title)} alumna/alumnus" loading="lazy" referrerpolicy="no-referrer" />
          <figcaption class="match-card__story-caption">
            <blockquote class="match-card__story-quote">“${esc(story.quote)}”</blockquote>
            <cite class="match-card__story-name">— ${esc(story.name)}, alumni</cite>
          </figcaption>
        </figure>
      </article>`;
  }).join("");
  return `
    <div class="match-deck" data-deck>
      <div class="match-deck__cards">${cards}</div>
      <div class="match-deck__actions">
        <button type="button" class="match-deck__btn match-deck__btn--skip" aria-label="Skip this opportunity">✕ Skip</button>
        <button type="button" class="match-deck__btn match-deck__btn--save" aria-label="Save this opportunity to apply later">♥ Save</button>
      </div>
      <p class="match-deck__hint govbb-text-caption">Swipe right to save, left to skip. Apply to all your saved picks at the end.</p>
      <div class="match-deck__footer">
        <span class="match-deck__count" aria-live="polite">0 saved</span>
        <button type="button" class="match-deck__btn match-deck__btn--done" disabled>Apply to 0 selected</button>
      </div>
    </div>`;
}

function initDeck(deckEl, matches) {
  const stack = deckEl.querySelector(".match-deck__cards");
  const cards = Array.from(stack.querySelectorAll(".match-card"));
  const skipBtn = deckEl.querySelector(".match-deck__btn--skip");
  const saveBtn = deckEl.querySelector(".match-deck__btn--save");
  const doneBtn = deckEl.querySelector(".match-deck__btn--done");
  const countEl = deckEl.querySelector(".match-deck__count");
  const hint = deckEl.querySelector(".match-deck__hint");
  let index = 0;
  let dragging = false, startX = 0, startY = 0, dx = 0, dy = 0, topCard = null;
  let busy = false;
  const SWIPE_THRESHOLD = 110;

  function updateFooter() {
    const n = state.selected.length;
    countEl.textContent = `${n} saved`;
    doneBtn.disabled = n === 0 || !!state.applying;
    doneBtn.textContent = `Apply to ${n} selected`;
  }
  deckEl._refreshFooter = updateFooter;

  function refreshStack() {
    cards.forEach((el, i) => {
      el.classList.remove("match-card--top", "match-card--next", "match-card--back", "is-swiping", "is-flying");
      el.style.transform = "";
      el.style.opacity = "";
      const stamps = el.querySelectorAll(".match-card__stamp");
      stamps.forEach((s) => (s.style.opacity = ""));
      const rel = i - index;
      if (rel < 0 || rel > 2) { el.style.display = "none"; return; }
      el.style.display = "flex";
      if (rel === 0) el.classList.add("match-card--top");
      else if (rel === 1) el.classList.add("match-card--next");
      else el.classList.add("match-card--back");
    });
    updateFooter();
    if (index >= cards.length) showEmpty();
  }

  function showEmpty() {
    skipBtn.disabled = true;
    saveBtn.disabled = true;
    if (state.selected.length > 0) {
      hint.textContent = `That's all of them! Click "Apply to ${state.selected.length} selected" below to continue.`;
      // Auto-advance after a brief beat so users see the state.
      if (!state.applying) setTimeout(() => { if (!state.applying && state.selected.length) startApplication(); }, 500);
    } else {
      hint.textContent = "That's everyone — and nothing was saved. Tell me a different interest, or type \"reset\" to start over.";
    }
  }

  function flyOff(direction, onDone) {
    const card = cards[index];
    if (!card) return;
    card.classList.add("is-flying");
    card.style.transform = `translateX(${direction * 140}%) rotate(${direction * 18}deg)`;
    card.style.opacity = "0";
    setTimeout(() => {
      index += 1;
      refreshStack();
      if (onDone) onDone();
    }, 280);
  }

  function saveTopCard() {
    if (busy || index >= cards.length) return;
    const m = matches[index];
    if (!m) return;
    if (!state.selected.find((s) => s.id === m.id)) {
      state.selected.push({ id: m.id, title: m.title });
    }
    busy = true;
    flyOff(1, () => { busy = false; });
  }
  function skipTopCard() {
    if (busy || index >= cards.length) return;
    busy = true;
    flyOff(-1, () => { busy = false; });
  }

  // ---- Pointer drag on the top card ----
  stack.addEventListener("pointerdown", (e) => {
    if (busy) return;
    const card = e.target.closest(".match-card--top");
    if (!card) return;
    if (e.target.closest("a, button")) return;
    topCard = card;
    dragging = true;
    startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
    topCard.classList.add("is-swiping");
    try { topCard.setPointerCapture(e.pointerId); } catch (_) {}
  });
  stack.addEventListener("pointermove", (e) => {
    if (!dragging || !topCard) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    topCard.style.transform = `translate(${dx}px, ${dy * 0.4}px) rotate(${dx * 0.06}deg)`;
    const like = topCard.querySelector(".match-card__stamp--like");
    const nope = topCard.querySelector(".match-card__stamp--nope");
    if (like) like.style.opacity = String(Math.max(0, Math.min(1, dx / 80)));
    if (nope) nope.style.opacity = String(Math.max(0, Math.min(1, -dx / 80)));
  });
  function endDrag() {
    if (!dragging || !topCard) return;
    dragging = false;
    topCard.classList.remove("is-swiping");
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx > 0) saveTopCard();
      else skipTopCard();
    } else {
      topCard.style.transform = "";
      const like = topCard.querySelector(".match-card__stamp--like");
      const nope = topCard.querySelector(".match-card__stamp--nope");
      if (like) like.style.opacity = "";
      if (nope) nope.style.opacity = "";
    }
    topCard = null;
  }
  stack.addEventListener("pointerup", endDrag);
  stack.addEventListener("pointercancel", endDrag);
  stack.addEventListener("pointerleave", endDrag);

  skipBtn.addEventListener("click", skipTopCard);
  saveBtn.addEventListener("click", saveTopCard);
  doneBtn.addEventListener("click", () => {
    if (state.selected.length === 0 || state.applying) return;
    startApplication();
  });

  refreshStack();
}

// Score a single opportunity vs. the user's answers. Mirrors the old
// /api/match server logic — kept client-side so this works as a static POC.
function scoreOpp(opp, answers) {
  let score = 0;
  const reasons = [];
  const elig = opp.eligibility || {};
  if (answers.age != null) {
    if (elig.ageMin != null && answers.age < elig.ageMin) return { score: -1, reasons: ["below min age"] };
    if (elig.ageMax != null && answers.age > elig.ageMax) return { score: -1, reasons: ["above max age"] };
    if (elig.ageMin != null || elig.ageMax != null) { score += 1; reasons.push("age fits"); }
  }
  if (answers.citizenship && elig.citizenship && answers.citizenship !== elig.citizenship) {
    return { score: -1, reasons: ["citizenship mismatch"] };
  }
  const userInterests = (answers.interests || []).map((s) => s.toLowerCase());
  const oppInterests = (elig.interests || []).map((s) => s.toLowerCase());
  const tagPool = new Set([...(opp.tags || []).map((s) => s.toLowerCase()), ...oppInterests]);
  const matched = userInterests.filter((i) => tagPool.has(i));
  score += matched.length * 2;
  if (matched.length) reasons.push(`matches: ${matched.join(", ")}`);
  return { score, reasons };
}

let _oppsCache = null;
async function loadOpps() {
  if (!_oppsCache) _oppsCache = fetch("/data/opportunities.json").then((r) => r.json());
  return _oppsCache;
}

async function fetchMatches() {
  const answers = { age: state.age, interests: state.interests };
  const opps = await loadOpps();
  return opps
    .map((o) => ({ ...o, _score: scoreOpp(o, answers) }))
    .filter((o) => o._score.score >= 0)
    .sort((a, b) => b._score.score - a._score.score);
}

// ---------- Application flow ----------
function startApplication() {
  if (state.applying) return;
  if (!state.selected.length) {
    append("bot", "You haven't saved any opportunities yet — swipe right (or click ♥ Save) on the ones you're interested in.");
    return;
  }
  state.applying = {
    selected: state.selected.slice(),
    step: 0,
    answers: {},
    succeeded: [],
  };
  state.selected = [];
  refreshAllDeckFooters();

  const titles = state.applying.selected.map((s) => `• ${s.title}`).join("\n");
  const n = state.applying.selected.length;
  append("bot",
    `Great — you've picked ${n} opportunit${n === 1 ? "y" : "ies"}:\n${titles}\n\n` +
    `I'll just need a few details once and apply you to all of them. Type "cancel" any time to stop.`
  );
  askNextApplicationQuestion();
}

function askNextApplicationQuestion() {
  const q = APPLICATION_QUESTIONS[state.applying.step];
  if (!q) { submitApplication(); return; }
  if (q.options && q.options.length) {
    const pills = q.options.map((o) =>
      `<button type="button" class="chat-pill" data-value="${esc(o)}">${esc(o)}</button>`
    ).join("");
    append("bot", q.prompt, `<div class="chat-pills" role="group" aria-label="${esc(q.prompt)}">${pills}</div>`);
  } else {
    append("bot", q.prompt);
  }
}

// Pill click → treat as if the user typed that value.
log.addEventListener("click", (e) => {
  const btn = e.target.closest(".chat-pill");
  if (!btn || btn.disabled) return;
  if (!state.applying) return;
  const value = btn.getAttribute("data-value") || "";
  const group = btn.closest(".chat-pills");
  if (group) group.querySelectorAll(".chat-pill").forEach((b) => (b.disabled = true));
  btn.classList.add("is-selected");
  append("user", value);
  handleApplicationAnswer(value);
});

async function submitApplication() {
  const { selected, answers, succeeded } = state.applying;
  const n = selected.length;
  const pending = append("bot", `Submitting ${n} application${n === 1 ? "" : "s"}…`);

  // POC: no server submission — generate a local reference per opportunity.
  // Same shape (APP-XXXX-YYYY) as the old /api/applications endpoint so any
  // downstream UI keeps working.
  const newRefs = [];
  const failed = [];
  for (const opp of selected) {
    const reference = "APP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    newRefs.push({ title: opp.title, reference });
  }

  const allRefs = succeeded.concat(newRefs);

  let html = "";
  if (allRefs.length) {
    html += `<p class="govbb-text-body">Your tracking code${allRefs.length === 1 ? "" : "s"} — save ${allRefs.length === 1 ? "it" : "them"}, you'll need ${allRefs.length === 1 ? "it" : "each"} to check on your application:</p>`;
    html += `<ul class="application-receipts">`;
    for (const r of allRefs) {
      html += `<li class="application-receipt">` +
        `<p class="govbb-text-caption application-receipt__label">${esc(r.title)}</p>` +
        `<p class="govbb-text-h3 application-receipt__code">${esc(r.reference)}</p>` +
      `</li>`;
    }
    html += `</ul>`;
  }
  if (failed.length) {
    html += `<p class="govbb-text-body">${failed.length} application${failed.length === 1 ? "" : "s"} couldn't be submitted:</p><ul class="application-errors">`;
    for (const f of failed) html += `<li>${esc(f.title)} — ${esc(f.error)}</li>`;
    html += `</ul><p class="govbb-text-body">Type "retry" to try the failed one${failed.length === 1 ? "" : "s"} again.</p>`;
  } else {
    html += `<p class="govbb-text-body">All set! Want to apply to more? Tell me different interests, or type "reset" to start a new search.</p>`;
  }

  pending.querySelector(".msg__text").innerHTML = `Done!${html}`;
  log.scrollTop = log.scrollHeight;

  if (failed.length === 0) {
    state.applying = null;
  } else {
    state.applying.selected = failed.map(({ id, title }) => ({ id, title }));
    state.applying.succeeded = allRefs;
  }
  refreshAllDeckFooters();
}

function handleApplicationAnswer(text) {
  const lower = text.toLowerCase().trim();
  if (/^(cancel|stop|never\s*mind|nvm|exit)\b/.test(lower)) {
    const n = state.applying.selected.length;
    state.applying = null;
    refreshAllDeckFooters();
    append("bot", `Cancelled. The ${n} opportunit${n === 1 ? "y was" : "ies were"} not submitted. You can swipe again or type "reset" to start over.`);
    return;
  }
  // After a partial failure, the form is already filled — typing "retry" just resubmits the failed ones.
  const allAnswered = Object.keys(state.applying.answers).length === APPLICATION_QUESTIONS.length;
  if (lower === "retry" && allAnswered && state.applying.selected.length) {
    submitApplication();
    return;
  }
  if (allAnswered) return; // ignore stray input while we're between submit/retry
  const q = APPLICATION_QUESTIONS[state.applying.step];
  const result = q.validate(text);
  if (result !== true) { append("bot", result); return; }
  state.applying.answers[q.key] = text.trim();
  state.applying.step += 1;
  askNextApplicationQuestion();
}

// ---------- Conversation flow ----------
function describeInterests(list) {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

async function handleUserMessage(text) {
  const lower = text.toLowerCase().trim();

  if (/^(reset|start over|restart|clear)\b/.test(lower)) {
    resetChat();
    return;
  }

  if (state.applying) {
    handleApplicationAnswer(text);
    return;
  }

  const newAge = parseAge(text);
  const newInterests = parseInterests(text);

  let acknowledgements = [];
  if (newAge != null && newAge !== state.age) {
    state.age = newAge;
    acknowledgements.push(`Got it — age ${newAge}.`);
  }
  if (newInterests.length) {
    const before = state.interests.length;
    state.interests = mergeInterests(state.interests, newInterests);
    if (state.interests.length > before) {
      acknowledgements.push(`Noted interests: ${describeInterests(state.interests)}.`);
    }
  }

  if (state.age == null) {
    const ack = acknowledgements.length ? acknowledgements.join(" ") + " " : "";
    append("bot", `${ack}How old are you?`);
    return;
  }
  if (state.interests.length === 0) {
    const ack = acknowledgements.length ? acknowledgements.join(" ") + " " : "";
    append("bot", `${ack}What are you interested in? For example: ${SUGGESTED_INTERESTS.join(", ")}.`);
    return;
  }

  // Have age + at least one interest — fetch matches.
  const intro = state.hasShownMatches
    ? `Updated. Here are matches for age ${state.age} interested in ${describeInterests(state.interests)}:`
    : `Thanks! Based on age ${state.age} and interests in ${describeInterests(state.interests)}, here are some opportunities:`;
  const pending = append("bot", intro + " (searching…)");
  try {
    const matches = await fetchMatches();
    const msgText = pending.querySelector(".msg__text");
    msgText.innerHTML = `${esc(intro)}${renderDeckHtml(matches)}<p class="govbb-text-caption" style="margin-top:var(--spacing-s)">Want to refine? Tell me another interest, change your age, or type <em>reset</em> to start over.</p>`;
    const deckEl = msgText.querySelector("[data-deck]");
    if (deckEl && matches.length) initDeck(deckEl, matches.slice(0, 10));
    state.hasShownMatches = true;
    log.scrollTop = log.scrollHeight;
  } catch (err) {
    pending.querySelector(".msg__text").textContent = `Sorry — couldn't load matches (${err.message}). Try again in a moment.`;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  cancelAutoSend();
  const msg = input.value.trim();
  if (!msg) return;
  append("user", msg);
  input.value = "";
  autosize();
  handleUserMessage(msg);
});

// ---------- Auto-send timer ----------
let autoSendTimer = null;
function scheduleAutoSend() {
  cancelAutoSend();
  let remaining = Math.ceil(AUTO_SEND_DELAY_MS / 1000);
  micStatus.textContent = `Sending in ${remaining}s… (type or click to cancel)`;
  autoSendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(autoSendTimer);
      autoSendTimer = null;
      micStatus.textContent = "";
      if (input.value.trim()) form.requestSubmit();
    } else {
      micStatus.textContent = `Sending in ${remaining}s… (type or click to cancel)`;
    }
  }, 1000);
}
function cancelAutoSend() {
  if (autoSendTimer) { clearInterval(autoSendTimer); autoSendTimer = null; micStatus.textContent = ""; }
}
document.addEventListener("click", (e) => { if (e.target !== micBtn && !micBtn.contains(e.target)) cancelAutoSend(); });

// ---------- Voice: Web Speech API (preferred) ----------
async function ensureMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    micStatus.textContent = `Microphone blocked: ${err.name}. Allow microphone access in your browser settings.`;
    return false;
  }
}

let listening = false;

if (SR) {
  const recog = new SR();
  recog.lang = "en-US";
  recog.interimResults = true;
  recog.continuous = false;

  let baseValue = "";
  recog.addEventListener("result", (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = (baseValue + " " + final + interim).trim();
    autosize();
    if (final) baseValue = input.value;
  });
  recog.addEventListener("start", () => {
    listening = true;
    micBtn.classList.add("is-recording");
    micBtn.setAttribute("aria-label", "Stop voice input");
    micStatus.textContent = "Listening… speak now.";
    baseValue = input.value;
  });
  recog.addEventListener("end", () => {
    listening = false;
    micBtn.classList.remove("is-recording");
    micBtn.setAttribute("aria-label", "Start voice input");
    if (input.value.trim()) scheduleAutoSend();
    else micStatus.textContent = "";
    input.focus();
  });
  recog.addEventListener("error", (e) => {
    micStatus.textContent = `Voice error: ${e.error}. ${e.error === "not-allowed" ? "Allow microphone access in browser settings." : ""}`;
    listening = false;
    micBtn.classList.remove("is-recording");
  });

  micBtn.addEventListener("click", async () => {
    cancelAutoSend();
    if (listening) { recog.stop(); return; }
    if (!(await ensureMicPermission())) return;
    try { recog.start(); }
    catch (err) { micStatus.textContent = `Could not start: ${err.message}`; }
  });
} else {
  // ---------- Voice: MediaRecorder fallback (Firefox etc.) ----------
  let mediaRecorder = null;
  let chunks = [];

  micBtn.addEventListener("click", async () => {
    cancelAutoSend();
    if (listening) { mediaRecorder?.stop(); return; }
    if (!(await ensureMicPermission())) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.addEventListener("dataavailable", (e) => { if (e.data.size > 0) chunks.push(e.data); });
      mediaRecorder.addEventListener("start", () => {
        listening = true;
        micBtn.classList.add("is-recording");
        micStatus.textContent = "Recording… click again to stop and transcribe.";
      });
      mediaRecorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((t) => t.stop());
        listening = false;
        micBtn.classList.remove("is-recording");
        micStatus.textContent = "Transcribing…";
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, "voice.webm");
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({}));
            micStatus.textContent = `Transcription unavailable: ${error || res.statusText}`;
            return;
          }
          const { text } = await res.json();
          input.value = (input.value + " " + (text || "")).trim();
          autosize();
          micStatus.textContent = "";
          if (input.value.trim()) scheduleAutoSend();
        } catch (err) {
          micStatus.textContent = `Transcription failed: ${err.message}`;
        }
      });
      mediaRecorder.start();
    } catch (err) {
      micStatus.textContent = `Could not start recorder: ${err.message}`;
    }
  });
  micStatus.textContent = "Voice uses recorded audio in this browser. Chrome/Edge/Safari give live transcription.";
}
// --- Suggestion chips (from main: fill composer + auto-send) ---
document.querySelectorAll(".chip[data-prompt]").forEach((b) => {
  b.addEventListener("click", () => {
    cancelAutoSend();
    input.value = b.dataset.prompt;
    autosize();
    form.requestSubmit();
    input.focus();
  });
});
