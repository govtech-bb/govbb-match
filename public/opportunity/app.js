// Dynamic per-opportunity start page + multi-step form, GOV.BB service-template style.

const root = document.getElementById("root");

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function qs(name) { return new URLSearchParams(location.search).get(name); }
function setStep(step) {
  const u = new URL(location.href);
  if (step) u.searchParams.set("step", step);
  else u.searchParams.delete("step");
  u.searchParams.delete("page");
  history.pushState({}, "", u);
}
function setPage(n) {
  const u = new URL(location.href);
  u.searchParams.set("page", n);
  history.pushState({}, "", u);
}

function ageRange(elig) {
  if (!elig) return null;
  if (elig.ageMin != null && elig.ageMax != null) return `Ages ${elig.ageMin}–${elig.ageMax}`;
  if (elig.ageMin != null) return `${elig.ageMin}+ years`;
  if (elig.ageMax != null) return `Up to ${elig.ageMax} years`;
  return null;
}

const STORAGE_KEY = (id) => `opp:${id}:draft`;
function loadDraft(id) { try { return JSON.parse(localStorage.getItem(STORAGE_KEY(id))) || {}; } catch { return {}; } }
function saveDraft(id, data) { localStorage.setItem(STORAGE_KEY(id), JSON.stringify(data)); }
function clearDraft(id) { localStorage.removeItem(STORAGE_KEY(id)); }

// ----- views -----

function renderStart(opp) {
  const age = ageRange(opp.eligibility);
  const interests = (opp.eligibility && opp.eligibility.interests) || [];
  const eligibilityItems = [];
  if (age) eligibilityItems.push(age);
  if (opp.eligibility && opp.eligibility.citizenship === "BB") eligibilityItems.push("Barbadian citizen or resident");
  if (interests.length) eligibilityItems.push(`Interest in ${interests.join(", ")}`);

  root.innerHTML = `
    <nav class="govbb-breadcrumbs" aria-label="Breadcrumb">
      <ol class="govbb-breadcrumbs__list">
        <li class="govbb-breadcrumbs__item"><a class="govbb-breadcrumbs__link" href="/">Home</a></li>
        <li class="govbb-breadcrumbs__item"><a class="govbb-breadcrumbs__link" href="/opportunities/">All opportunities</a></li>
        <li class="govbb-breadcrumbs__item" aria-current="page">${esc(opp.title)}</li>
      </ol>
    </nav>

    <div class="service__grid">
      <div class="service__main">
        <h1 class="govbb-text-display">${esc(opp.title)}</h1>

        <div class="service__meta">
          <p class="govbb-text-caption">
            ${esc(opp.category)}
            ${opp.deadline ? ` · Deadline: ${esc(opp.deadline)}` : ""}
            ${opp.source ? ` · ${esc(opp.source)}` : ""}
          </p>
        </div>

        <div class="service__sections">
          <section class="service__section">
            <h2 class="govbb-text-h2">Overview</h2>
            <p class="govbb-text-body">${esc(opp.description || "")}</p>
            ${(opp.tags || []).length ? `<div class="tag-list">${opp.tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</div>` : ""}
          </section>

          ${eligibilityItems.length ? `
          <section class="service__section">
            <h2 class="govbb-text-h2">Who can apply</h2>
            <ul class="govbb-list govbb-list--bullet">
              ${eligibilityItems.map((i) => `<li>${esc(i)}</li>`).join("")}
            </ul>
          </section>` : ""}

          <section class="service__section">
            <h2 class="govbb-text-h2">Before you start</h2>
            <p class="govbb-text-body">You will need:</p>
            <ul class="govbb-list govbb-list--bullet">
              <li>your full name and date of birth</li>
              <li>a working email address and phone number</li>
              <li>about 5 minutes to complete the form</li>
            </ul>
          </section>

          <section class="service__section">
            <h2 class="govbb-text-h2">How to apply</h2>
            <p class="govbb-text-body">Complete the online application. Your progress is saved automatically.</p>
            <a class="govbb-btn service__cta" href="?id=${encodeURIComponent(opp.id)}&step=apply&page=0" data-action="start">Start now</a>
          </section>

          ${opp.url ? `
          <section class="service__section">
            <h2 class="govbb-text-h2">More information</h2>
            <p class="govbb-text-body">
              <a class="govbb-link" href="${esc(opp.url)}" target="_blank" rel="noopener">View the official page</a>
            </p>
          </section>` : ""}
        </div>

        <div class="service__feedback">
          <h3 class="govbb-text-h3">Was this helpful?</h3>
          <p class="govbb-text-body">Tell us how we can improve this page.</p>
          <a class="govbb-link govbb-link--secondary govbb-font-body" href="mailto:feedback@example.gov.bb">Help us improve alpha.gov.bb</a>
        </div>
      </div>
    </div>
  `;

  root.querySelector('[data-action="start"]').addEventListener("click", (e) => {
    e.preventDefault();
    setStep("apply");
    setPage(0);
    render();
  });
}

function fieldHTML(f, value) {
  const id = `f-${f.id}`;
  const hintId = f.hint ? `${id}-hint` : "";
  const required = f.required ? " required" : "";
  const aria = f.hint ? ` aria-describedby="${hintId}"` : "";
  const valueEsc = esc(value ?? "");
  const labelEl = `<label class="govbb-label" for="${id}">${esc(f.label)}</label>`;
  const hintEl = f.hint ? `<p class="govbb-hint" id="${hintId}">${esc(f.hint)}</p>` : "";

  if (f.type === "textarea") {
    return `<div class="govbb-form-group">
      ${labelEl}${hintEl}
      <div class="govbb-input-wrapper">
        <textarea class="govbb-textarea" id="${id}" name="${esc(f.id)}" rows="${f.rows || 4}"${required}${aria}>${valueEsc}</textarea>
      </div>
    </div>`;
  }

  if (f.type === "select") {
    return `<div class="govbb-form-group">
      ${labelEl}${hintEl}
      <div class="govbb-select-wrapper">
        <select class="govbb-select" id="${id}" name="${esc(f.id)}"${required}${aria}>
          <option value="">Select…</option>
          ${(f.options || []).map((o) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}
        </select>
        <span class="govbb-select__chevron" aria-hidden="true">
          <svg viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M0 8 6 0 12 8z" /></svg>
        </span>
      </div>
    </div>`;
  }

  if (f.type === "radio") {
    return `<fieldset class="govbb-fieldset">
      <legend class="govbb-fieldset__legend">${esc(f.label)}</legend>
      ${hintEl}
      <div class="govbb-checkboxes">
        ${(f.options || []).map((o, i) => {
          const oid = `${id}-${i}`;
          return `<div class="govbb-checkbox-item">
            <input class="govbb-checkbox" type="radio" id="${oid}" name="${esc(f.id)}" value="${esc(o)}"${o === value ? " checked" : ""}${required && i === 0 ? " required" : ""} />
            <label class="govbb-checkbox-item__label" for="${oid}">${esc(o)}</label>
          </div>`;
        }).join("")}
      </div>
    </fieldset>`;
  }

  if (f.type === "checkbox-group") {
    const sel = new Set(Array.isArray(value) ? value : []);
    return `<fieldset class="govbb-fieldset">
      <legend class="govbb-fieldset__legend">${esc(f.label)}</legend>
      ${hintEl}
      <div class="govbb-checkboxes">
        ${(f.options || []).map((o, i) => {
          const oid = `${id}-${i}`;
          return `<div class="govbb-checkbox-item">
            <input class="govbb-checkbox" type="checkbox" id="${oid}" name="${esc(f.id)}" value="${esc(o)}"${sel.has(o) ? " checked" : ""} />
            <label class="govbb-checkbox-item__label" for="${oid}">${esc(o)}</label>
          </div>`;
        }).join("")}
      </div>
    </fieldset>`;
  }

  // text-like
  const type = ["email", "tel", "number", "date", "url"].includes(f.type) ? f.type : "text";
  return `<div class="govbb-form-group">
    ${labelEl}${hintEl}
    <div class="govbb-input-wrapper">
      <input class="govbb-input" type="${type}" id="${id}" name="${esc(f.id)}" value="${valueEsc}"${required}${aria} />
    </div>
  </div>`;
}

function readForm(formEl, fields) {
  const fd = new FormData(formEl);
  const out = {};
  for (const f of fields) {
    if (f.type === "checkbox-group") out[f.id] = fd.getAll(f.id);
    else out[f.id] = fd.get(f.id);
  }
  return out;
}

function renderForm(opp) {
  const schema = window.getSchema(opp.id);
  const pageNum = Math.max(0, Math.min(parseInt(qs("page") || "0", 10), schema.length - 1));
  const page = schema[pageNum];
  const draft = loadDraft(opp.id);
  const isLast = pageNum === schema.length - 1;
  const isFirst = pageNum === 0;

  root.innerHTML = `
    <nav class="govbb-breadcrumbs" aria-label="Breadcrumb">
      <ol class="govbb-breadcrumbs__list">
        <li class="govbb-breadcrumbs__item"><a class="govbb-breadcrumbs__link" href="/">Home</a></li>
        <li class="govbb-breadcrumbs__item"><a class="govbb-breadcrumbs__link" href="?id=${encodeURIComponent(opp.id)}">${esc(opp.title)}</a></li>
        <li class="govbb-breadcrumbs__item" aria-current="page">Apply — ${esc(page.title)}</li>
      </ol>
    </nav>

    <form class="form-page" id="apply-form" autocomplete="on">
      <div class="form-page__heading">
        <span class="form-page__service-title govbb-text-body">${esc(opp.title)}</span>
        <p class="govbb-text-caption">Step ${pageNum + 1} of ${schema.length}</p>
        <h1 class="govbb-text-display">${esc(page.title)}</h1>
      </div>

      <div class="form-groups">
        ${page.fields.map((f) => fieldHTML(f, draft[f.id])).join("")}
      </div>

      <div class="govbb-btn-group">
        ${!isFirst ? `<button class="govbb-btn--secondary" type="button" data-action="back">Back</button>` : `<a class="govbb-btn--secondary" href="?id=${encodeURIComponent(opp.id)}">Back</a>`}
        <button class="govbb-btn" type="submit">${isLast ? "Submit application" : "Continue"}</button>
      </div>
    </form>
  `;

  const form = root.querySelector("#apply-form");

  form.addEventListener("input", () => {
    const data = readForm(form, page.fields);
    saveDraft(opp.id, { ...draft, ...data });
  });

  const backBtn = root.querySelector('[data-action="back"]');
  if (backBtn) backBtn.addEventListener("click", () => { setPage(pageNum - 1); render(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = readForm(form, page.fields);
    const merged = { ...draft, ...data };
    saveDraft(opp.id, merged);
    if (!isLast) {
      setPage(pageNum + 1);
      render();
      return;
    }
    // Final submit
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: opp.id, opportunityTitle: opp.title, data: merged }),
    });
    if (!res.ok) { alert("Failed to submit. Please try again."); return; }
    const body = await res.json();
    clearDraft(opp.id);
    setStep("done");
    history.replaceState({}, "", `?id=${encodeURIComponent(opp.id)}&step=done&ref=${encodeURIComponent(body.reference)}`);
    render();
  });
}

function renderDone(opp) {
  const reference = qs("ref") || "—";
  root.innerHTML = `
    <div class="service__grid">
      <div class="service__main">
        <h1 class="govbb-text-display">Application submitted</h1>
        <p class="govbb-text-body">Thank you for applying to <strong>${esc(opp.title)}</strong>.</p>

        <div class="govbb-status-banner govbb-status-banner--rounded govbb-status-banner--service">
          <div><p>Your reference number is <strong>${esc(reference)}</strong>. Keep it safe — you'll need it to ask about your application.</p></div>
        </div>

        <section class="service__section">
          <h2 class="govbb-text-h2">What happens next</h2>
          <ul class="govbb-list govbb-list--bullet">
            <li>We'll review your application within 5 working days.</li>
            <li>You'll get a confirmation email when it's been reviewed.</li>
            <li>If we need anything else, we'll contact you on the phone number you provided.</li>
          </ul>
        </section>

        <div class="govbb-btn-group">
          <a class="govbb-btn" href="/opportunities/">Browse more opportunities</a>
          <a class="govbb-btn--secondary" href="/">Back to home</a>
        </div>
      </div>
    </div>
  `;
}

function renderNotFound(id) {
  root.innerHTML = `
    <h1 class="govbb-text-display">Opportunity not found</h1>
    <p class="govbb-text-body">We couldn't find an opportunity with the id <code>${esc(id)}</code>.</p>
    <p><a class="govbb-link" href="/opportunities/">Browse all opportunities</a></p>
  `;
}

// ----- main -----

let OPPS = [];

async function render() {
  const id = qs("id");
  if (!id) { renderNotFound(""); return; }
  if (!OPPS.length) OPPS = await fetch("/api/opportunities").then((r) => r.json());
  const opp = OPPS.find((o) => o.id === id);
  if (!opp) { renderNotFound(id); return; }

  document.title = `${opp.title} — alpha.gov.bb`;
  const step = qs("step");
  if (step === "apply") renderForm(opp);
  else if (step === "done") renderDone(opp);
  else renderStart(opp);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener("popstate", render);
render();
