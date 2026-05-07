const root = document.getElementById("stories");

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

(async () => {
  const stories = await fetch("/data/stories.json").then((r) => r.json());
  root.innerHTML = stories.map((s) => `
    <article class="story">
      <div class="story__media">
        ${/\.(gif|png|jpe?g|webp|avif)(\?|$)/i.test(s.video)
          ? `<img class="story__video" src="${esc(s.video)}" alt="${esc(s.name)}" loading="lazy" />`
          : `<video class="story__video" controls preload="metadata"${s.poster ? ` poster="${esc(s.poster)}"` : ""}>
              <source src="${esc(s.video)}" type="video/mp4" />
              Your browser does not support embedded video.
            </video>`}
      </div>
      <div class="story__body">
        <p class="story__meta govbb-text-caption">${esc(s.programme)}${s.year ? ` · ${esc(s.year)}` : ""}</p>
        <h2 class="govbb-text-h2 story__headline">${esc(s.headline)}</h2>
        <blockquote class="story__quote">
          <p class="govbb-text-body">“${esc(s.quote)}”</p>
          <footer class="story__attribution govbb-text-caption">— ${esc(s.name)}</footer>
        </blockquote>
        <p class="govbb-text-body">${esc(s.summary)}</p>
        ${s.opportunityId ? `<p><a class="govbb-link" href="/opportunity/?id=${encodeURIComponent(s.opportunityId)}">Learn about ${esc(s.programme)} →</a></p>` : ""}
      </div>
    </article>
  `).join("");
})();
