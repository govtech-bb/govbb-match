const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const input = document.getElementById("search-input");

let opps = [];

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Only http(s) URLs may become clickable links: a javascript: (or data:,
// vbscript:) URL contains none of the characters esc() encodes and would
// otherwise survive into href intact (gov-bb-security#300). Scheme-allowlist
// at the href construction site, not inside the general-purpose escaper.
function safeUrl(u) { const s = String(u ?? ""); if (!s) return ""; try { const p = new URL(s, window.location.origin).protocol; return (p === "http:" || p === "https:") ? s : ""; } catch { return ""; } }


function haystack(o) {
  return [
    o.title,
    o.description,
    o.category,
    o.source,
    (o.tags || []).join(" "),
    ((o.eligibility && o.eligibility.interests) || []).join(" "),
  ].join(" ").toLowerCase();
}

function render(items) {
  countEl.textContent = `${items.length} of ${opps.length} opportunities`;
  if (!items.length) {
    listEl.innerHTML = `<li class="opps-list__item"><p class="govbb-text-body">No matches. Try a different search.</p></li>`;
    return;
  }
  listEl.innerHTML = items.map((o) => `
    <li class="opps-list__item">
      <span class="govbb-text-h4 opps-list__title">${esc(o.title)}</span>
      <div class="opps-list__meta govbb-text-caption">
        <span>${esc(o.category)}</span>
        ${o.eligibility && (o.eligibility.ageMin != null || o.eligibility.ageMax != null)
          ? `<span>Ages ${esc(o.eligibility.ageMin ?? "?")}–${esc(o.eligibility.ageMax ?? "?")}</span>` : ""}
        ${o.deadline ? `<span>Deadline: ${esc(o.deadline)}</span>` : ""}
        ${o.source ? `<span>${esc(o.source)}</span>` : ""}
      </div>
      <p class="govbb-text-body">${esc(o.description || "")}</p>
      ${(o.tags || []).length ? `<div class="tag-list">${o.tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="opps-list__actions govbb-btn-group">
        <a class="govbb-btn" href="/opportunity/?id=${encodeURIComponent(o.id)}">View &amp; apply</a>
        ${safeUrl(o.url) ? `<a class="govbb-btn--link" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">Source</a>` : ""}
      </div>
    </li>
  `).join("");
}

function filter() {
  const q = input.value.trim().toLowerCase();
  if (!q) return render(opps);
  const terms = q.split(/\s+/);
  render(opps.filter((o) => {
    const h = haystack(o);
    return terms.every((t) => h.includes(t));
  }));
}

input.addEventListener("input", filter);

(async () => {
  opps = await fetch("/data/opportunities.json").then((r) => r.json());
  // Sort: deadline soonest first, then alpha.
  opps.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return a.title.localeCompare(b.title);
  });
  render(opps);
})();
