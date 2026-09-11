(() => {
  const csrfToken = () => (document.cookie.match(/(?:^|; )aetherwiki_csrf=([^;]+)/) || [])[1] || "";
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() === "get") return;
    if (!form.querySelector('input[name="_csrf"]')) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "_csrf";
      input.value = csrfToken();
      form.appendChild(input);
    }
  }, true);

  const themeBtn = document.getElementById("theme-btn");
  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("aetherwiki-theme", theme); } catch (e) { /* ignore */ }
    if (themeBtn) themeBtn.textContent = theme === "light" ? "☀️" : "🌙";
  };
  if (themeBtn) {
    applyTheme(document.documentElement.dataset.theme || "dark");
    themeBtn.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    });
  }

  const bgToggle = document.getElementById("bg-toggle");
  const applyBg = (on) => {
    document.documentElement.dataset.bg = on ? "on" : "off";
    try { localStorage.setItem("aetherwiki-bg", on ? "on" : "off"); } catch (e) { /* ignore */ }
    if (bgToggle) {
      bgToggle.setAttribute("aria-pressed", on ? "true" : "false");
      bgToggle.textContent = on ? "✦ Animated background" : "✦ Background paused";
    }
  };
  if (bgToggle) {
    applyBg(document.documentElement.dataset.bg !== "off");
    bgToggle.addEventListener("click", () => applyBg(document.documentElement.dataset.bg === "off"));
  }

  const menuBtn = document.getElementById("menu-btn");
  const drawer = document.getElementById("drawer");
  const scrim = document.getElementById("scrim");
  if (menuBtn && drawer && scrim) {
    menuBtn.setAttribute("aria-expanded", "false");
    const focusables = () => Array.from(drawer.querySelectorAll('a[href], button, input')).filter((el) => el.offsetParent !== null);
    const close = () => {
      drawer.classList.remove("open");
      scrim.classList.remove("show");
      drawer.setAttribute("aria-hidden", "true");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.focus();
    };
    menuBtn.addEventListener("click", () => {
      const open = drawer.classList.toggle("open");
      scrim.classList.toggle("show", open);
      drawer.setAttribute("aria-hidden", open ? "false" : "true");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) focusables()[0]?.focus();
    });
    drawer.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    scrim.addEventListener("click", close);
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener("click", close));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

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

  const preview = document.getElementById("md-preview");
  const contentArea = document.querySelector('.editor-form textarea[name="content"]');
  const previewToggle = document.querySelector("[data-preview-toggle]");
  if (preview && contentArea && previewToggle) {
    let timer;
    const renderPreview = async () => {
      try {
        const r = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: contentArea.value }),
        });
        const data = await r.json();
        preview.innerHTML = data.html || "";
      } catch (e) { /* ignore */ }
    };
    const setPreview = (show) => {
      preview.classList.toggle("hidden", !show);
      previewToggle.setAttribute("aria-pressed", show ? "true" : "false");
      if (show) renderPreview();
    };
    previewToggle.addEventListener("click", () => setPreview(preview.classList.contains("hidden")));
    contentArea.addEventListener("input", () => {
      if (preview.classList.contains("hidden")) return;
      clearTimeout(timer);
      timer = setTimeout(renderPreview, 300);
    });
  }

  const uploadForm = document.querySelector(".upload-form");
  if (uploadForm) {
    const fileInput = uploadForm.querySelector('input[type="file"]');
    ["dragenter", "dragover"].forEach((ev) => uploadForm.addEventListener(ev, (e) => { e.preventDefault(); uploadForm.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => uploadForm.addEventListener(ev, (e) => { e.preventDefault(); uploadForm.classList.remove("dragover"); }));
    uploadForm.addEventListener("drop", (e) => {
      const files = e.dataTransfer?.files;
      if (!files?.length || !fileInput) return;
      fileInput.files = files;
      if (uploadForm.requestSubmit) uploadForm.requestSubmit();
      else uploadForm.submit();
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
      if (!confirm("Move this article to the trash?")) return;
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/api/articles/" + b.dataset.delete + "/delete";
      const token = document.createElement("input");
      token.type = "hidden";
      token.name = "_csrf";
      token.value = csrfToken();
      f.appendChild(token);
      document.body.appendChild(f);
      f.submit();
    });
  });

  document.querySelectorAll("[data-delete-media]").forEach((b) => {
    b.addEventListener("click", () => {
      if (!confirm("Delete this media file permanently?")) return;
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/api/media/" + encodeURIComponent(b.dataset.deleteMedia) + "/delete";
      const token = document.createElement("input");
      token.type = "hidden";
      token.name = "_csrf";
      token.value = csrfToken();
      f.appendChild(token);
      document.body.appendChild(f);
      f.submit();
    });
  });

  // ---- Timeline ----
  const timelineEl = document.getElementById("timeline");

  // Toggle inline "add branch" forms
  document.querySelectorAll(".tl-new-btn, .tl-new-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".tl-card, .tl-footer-add");
      const form = card?.querySelector(".tl-form");
      if (!form) return;
      const open = !form.classList.contains("hidden");
      form.classList.toggle("hidden", open);
      if (!open) form.querySelector("input[name=title]")?.focus();
    });
  });

  // --------------------------------------
  // Buttons: magnetic hover pull + sheen
  // --------------------------------------
  document.querySelectorAll(".btn").forEach((btn) => {
    btn.classList.add("magnetic");
    btn.addEventListener("mousemove", (e) => {
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) / (r.width / 2 || 1);
      const y = (e.clientY - r.top - r.height / 2) / (r.height / 2 || 1);
      btn.style.setProperty("--mx", x.toFixed(2));
      btn.style.setProperty("--my", y.toFixed(2));
      btn.style.transform = `translate(${x * 5}px, ${y * 7}px)`;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
    });
  });

  // --------------------------------------
  // Timeline reveal + scroll-linked glow
  // --------------------------------------
  const reveals = document.querySelectorAll(".timeline .tl-item.reveal");
  if (reveals.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    reveals.forEach((el) => {
      const depth = parseInt(el.querySelector(".tl-dot")?.dataset.depth || 0, 10);
      el.style.setProperty("--delay", (depth * 0.12).toFixed(2) + "s");
      io.observe(el);
    });

    // "journey highlight" — glow the dot of the item currently under a hover-bound cursor
    const timeline = document.querySelector(".timeline");
    timeline?.addEventListener("mousemove", (e) => {
      reveals.forEach((el) => {
        const r = el.getBoundingClientRect();
        const near = Math.abs(e.clientY - (r.top + r.height / 2)) < 90;
        el.classList.toggle("hover-glow", near);
      });
    });
    timeline?.addEventListener("mouseleave", () => reveals.forEach((el) => el.classList.remove("hover-glow")));
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
