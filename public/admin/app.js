const listEl = document.getElementById("list");
const form = document.getElementById("add-form");

function csv(s) { return (s || "").split(",").map((x) => x.trim()).filter(Boolean); }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

async function load() {
  const opps = await fetch("/api/opportunities").then((r) => r.json());
  if (!opps.length) {
    listEl.innerHTML = `<li class="opps-list__item"><p class="govbb-text-body">No opportunities yet.</p></li>`;
    return;
  }
  listEl.innerHTML = opps.map((o) => `
    <li class="opps-list__item">
      <span class="govbb-text-h4 opps-list__title">${esc(o.title)}</span>
      <p class="govbb-text-body">${esc(o.description || "")}</p>
      <div class="opps-list__meta govbb-text-caption">
        <span>${esc(o.category)}</span>
        ${o.deadline ? `<span>Deadline: ${esc(o.deadline)}</span>` : ""}
        ${o.source ? `<span>Source: ${esc(o.source)}</span>` : ""}
      </div>
      ${(o.tags || []).length ? `<div class="tag-list">${o.tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="opps-list__actions govbb-btn-group">
        ${o.url ? `<a class="govbb-btn--link" href="${esc(o.url)}" target="_blank" rel="noopener">View source</a>` : ""}
        <button class="govbb-btn--destructive" type="button" data-del="${esc(o.id)}">Delete</button>
      </div>
    </li>
  `).join("");
  listEl.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Delete "${b.dataset.del}"?`)) return;
      await fetch("/api/opportunities/" + encodeURIComponent(b.dataset.del), { method: "DELETE" });
      load();
    };
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const body = {
    title: f.get("title"),
    category: f.get("category"),
    description: f.get("description"),
    tags: csv(f.get("tags")),
    deadline: f.get("deadline") || null,
    url: f.get("url") || null,
    eligibility: {
      ageMin: f.get("ageMin") ? Number(f.get("ageMin")) : undefined,
      ageMax: f.get("ageMax") ? Number(f.get("ageMax")) : undefined,
      citizenship: f.get("citizenship") || undefined,
      interests: csv(f.get("interests")),
    },
  };
  const res = await fetch("/api/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { alert("Failed: " + (await res.text())); return; }
  form.reset();
  load();
});

load();
