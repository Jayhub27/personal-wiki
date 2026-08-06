(() => {
  const search = document.getElementById("search");
  const results = document.getElementById("search-results");

  if (search && results) {
    let t;
    search.addEventListener("input", () => {
      clearTimeout(t);
      const q = search.value.trim();
      if (q.length < 2) { results.classList.add("hidden"); results.innerHTML = ""; return; }
      t = setTimeout(async () => {
        try {
          const r = await fetch("/api/search?q=" + encodeURIComponent(q));
          const items = await r.json();
          results.innerHTML = items.length
            ? items.map((i) => `<a href="/${i.slug}">${escapeHtml(i.title)}</a>`).join("")
            : `<div style="padding:8px 12px;color:var(--muted)">No matches</div>`;
          results.classList.remove("hidden");
        } catch (e) { /* ignore */ }
      }, 200);
    });
    document.addEventListener("click", (e) => {
      if (!search.contains(e.target) && !results.contains(e.target)) results.classList.add("hidden");
    });
  }

  document.querySelectorAll(".toolbar button[data-ins]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ta = btn.closest(".field").querySelector("textarea");
      if (!ta) return;
      const ins = btn.dataset.ins;
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const selected = ta.value.slice(start, end);
      let inserted;
      if (ins.includes("{{}}")) inserted = ins.replace("{{}}", selected || "text");
      else if (ins === "[[Article Name]]") inserted = selected ? `[[${selected}]]` : "[[Article Name]]";
      else if (ins.startsWith("![")) inserted = ins;
      else if (ins.startsWith("<")) inserted = ins;
      else inserted = selected ? ins.replace("**bold**", selected) : ins;
      ta.setRangeText(inserted, start, end, "end");
      ta.focus();
    });
  });

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); }
      catch (e) {
        const ta = document.createElement("textarea");
        ta.value = b.dataset.copy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy link"), 1500);
    });
  });

  document.querySelectorAll("[data-embed]").forEach((b) => {
    b.addEventListener("click", () => {
      const url = b.dataset.url;
      const kind = b.dataset.embed;
      const snippet = kind === "image" ? `![${b.dataset.url.split("/").pop()}](${url})`
        : kind === "video" ? `<video controls src="${url}"></video>`
        : kind === "audio" ? `<audio controls src="${url}"></audio>`
        : `[${url.split("/").pop()}](${url})`;
      b.textContent = "Copied embed!";
      navigator.clipboard?.writeText(snippet).catch(() => {});
      setTimeout(() => (b.textContent = "Embed"), 1500);
    });
  });

  document.querySelectorAll("[data-delete]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("Delete this article permanently?")) return;
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/api/articles/" + b.dataset.delete + "/delete";
      document.body.appendChild(f);
      f.submit();
    });
  });

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
