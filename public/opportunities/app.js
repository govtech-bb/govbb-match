const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const input = document.getElementById("search-input");

let opps = [];

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

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
        ${o.url ? `<a class="govbb-btn--link" href="${esc(o.url)}" target="_blank" rel="noopener">Source</a>` : ""}
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
