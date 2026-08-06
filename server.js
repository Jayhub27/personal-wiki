import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { listArticles, getArticle, saveArticle, deleteArticle, buildTree, slugify } from "./lib/articles.js";
import { renderMarkdown, extractFirstHeading, extractExcerpt } from "./lib/render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "content");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");

fs.mkdirSync(CONTENT_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3210;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "three", "build")));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const layout = (title, body, active = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="/style.css" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✦</text></svg>" />
</head>
<body>
<canvas id="bg-canvas" aria-hidden="true"></canvas>
<div class="aurora aurora-1"></div>
<div class="aurora aurora-2"></div>
<header class="topbar">
  <div class="topbar-inner">
    <button id="menu-btn" class="icon-btn" aria-label="Toggle navigation">☰</button>
    <a class="brand" href="/"><span class="brand-mark">✦</span> Aetherwiki</a>
    <div class="topbar-right">
      <a href="/uploads" class="btn btn-ghost btn-sm">Media</a>
      <a href="/new" class="btn btn-primary btn-sm">+ New article</a>
    </div>
  </div>
</header>
<aside id="drawer" class="drawer" aria-hidden="true">
  <div class="drawer-head">Table of contents</div>
  <div class="sidebar-search">
    <input id="search" type="search" placeholder="Search the aether…" autocomplete="off" />
    <div id="search-results" class="search-results hidden"></div>
  </div>
  <nav class="tree">${active}</nav>
</aside>
<div id="scrim" class="scrim" aria-hidden="true"></div>
<main class="content">
${body}
</main>
<script src="/app.js"></script>
<script src="/vendor/three.module.js"></script>
<script type="module" src="/background.js"></script>
</body>
</html>`;

const treeHtml = (tree, current) => {
  if (!tree.length) return '<p class="empty-tree">No articles yet. <a href="/new">Create one</a>.</p>';
  const walk = (nodes, depth) => nodes.map((n) => {
    const cls = n.slug === current ? "active" : "";
    const kids = n.children.length ? `<ul>${walk(n.children, depth + 1)}</ul>` : "";
    return `<li class="depth-${Math.min(depth, 5)}"><a class="${cls}" href="/${n.slug}">${escapeHtml(n.title)}</a>${kids}</li>`;
  }).join("");
  return `<ul>${walk(tree, 0)}</ul>`;
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

app.get("/", (req, res) => {
  const tree = buildTree();
  const articles = listArticles().sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
  const recent = articles.slice(0, 8);
  const body = `
<section class="hero">
  <span class="chip">✦ your personal library</span>
  <h1>Weave your knowledge<br/>into the aether</h1>
  <p>Write articles and sub-articles, link pages with <code>[[Wiki Links]]</code>, embed <strong>images</strong>, <strong>video</strong> and <strong>audio</strong>, and branch out to real encyclopedia pages — all in a living, animated space.</p>
  <div class="hero-actions">
    <a href="/new" class="btn btn-primary">Start writing</a>
    <a href="/uploads" class="btn btn-ghost">Media library</a>
  </div>
</section>
${articles.length ? `<section class="card-list">
<div class="section-title">Recent articles</div>
${recent.map((a) => `<a class="card" href="/${a.slug}">
  <h3>${escapeHtml(a.title)}</h3>
  <p>${escapeHtml(extractExcerpt(a))}</p>
  <span class="card-meta">${toDate(a.updated || a.created)}${a.parent ? ` · sub-article` : ""}</span>
</a>`).join("")}
</section>` : ""}`;
  res.send(layout("Personal Wiki", body, treeHtml(tree)));
});

app.get("/new", (req, res) => {
  const tree = buildTree();
  const parent = req.query.parent ? getArticle(req.query.parent) : null;
  const body = `
<section class="editor-wrap">
  <div class="editor-toolbar">
    <a href="${parent ? `/${parent.slug}` : "/"}" class="btn btn-ghost btn-sm">← Back</a>
    <h2>New article</h2>
  </div>
  <form class="editor-form" action="/api/articles" method="POST">
    <input type="hidden" name="slug" value="" />
    <label class="field">
      <span>Title</span>
      <input name="title" required placeholder="Article title" />
    </label>
    <label class="field">
      <span>Parent (optional — makes this a sub-article)</span>
      <select name="parent">
        <option value="">— None (top-level article) —</option>
        ${tree.flatMap((n) => [n, ...n.children]).map((n) => `<option value="${n.slug}" ${parent?.slug === n.slug ? "selected" : ""}>${"— ".repeat(n.depth) || ""}${escapeHtml(n.title)}</option>`).join("")}
      </select>
    </label>
    <label class="field">
      <span>Tags (comma separated)</span>
      <input name="tags" placeholder="science, notes, project" />
    </label>
    <div class="editor-meta">
      <label class="field">
        <span>Reference (optional — link to a real wiki, e.g. Wikipedia)</span>
        <input name="reference" placeholder="https://en.wikipedia.org/wiki/Coffee" />
      </label>
      <label class="field">
        <span>Reference label</span>
        <input name="referenceLabel" placeholder="Read more on Wikipedia" />
      </label>
    </div>
    <label class="field">
      <span>Body (markdown)</span>
      <div class="toolbar">
        <button type="button" data-ins="## ">H2</button>
        <button type="button" data-ins="**bold**">B</button>
        <button type="button" data-ins="*italic*">I</button>
        <button type="button" data-ins="[[Article Name]]">[[Link]]</button>
        <button type="button" data-ins="![](/uploads/image.png)">🖼️</button>
        <button type="button" data-ins="<video controls src=\"/uploads/video.mp4\"></video>">🎬</button>
        <button type="button" data-ins="<audio controls src=\"/uploads/audio.mp3\"></audio>">🎧</button>
      </div>
      <textarea name="content" rows="18" placeholder="Write in markdown… Use [[Page Title]] to link to another wiki page."></textarea>
    </label>
    <div class="editor-actions">
      <button class="btn btn-primary" type="submit">Publish</button>
      <a class="btn btn-ghost" href="/uploads">Upload media first</a>
    </div>
  </form>
</section>`;
  res.send(layout("New article", body, treeHtml(tree)));
});

app.get("/:slug/edit", (req, res) => {
  const tree = buildTree();
  const article = getArticle(req.params.slug);
  if (!article) return res.status(404).send(layout("Not found", `<div class="error"><h1>404</h1><p>Article not found.</p><a class="btn btn-primary" href="/new?title=${encodeURIComponent(req.params.slug)}">Create "${escapeHtml(req.params.slug)}"</a></div>`, treeHtml(tree)));
  const body = `
<section class="editor-wrap">
  <div class="editor-toolbar">
    <a href="/${article.slug}" class="btn btn-ghost btn-sm">← View</a>
    <h2>Edit: ${escapeHtml(article.title)}</h2>
  </div>
  <form class="editor-form" action="/api/articles" method="POST">
    <input type="hidden" name="slug" value="${article.slug}" />
    <label class="field">
      <span>Title</span>
      <input name="title" required value="${escapeHtml(article.title)}" />
    </label>
    <label class="field">
      <span>Parent (sub-article of)</span>
      <select name="parent">
        <option value="">— None (top-level article) —</option>
        ${tree.filter((n) => n.slug !== article.slug).flatMap((n) => [n, ...n.children]).map((n) => `<option value="${n.slug}" ${article.parent === n.slug ? "selected" : ""}>${"— ".repeat(n.depth) || ""}${escapeHtml(n.title)}</option>`).join("")}
      </select>
    </label>
    <label class="field">
      <span>Tags</span>
      <input name="tags" value="${escapeHtml((article.tags || []).join(", "))}" />
    </label>
    <div class="editor-meta">
      <label class="field">
        <span>Reference URL</span>
        <input name="reference" placeholder="https://en.wikipedia.org/wiki/…" value="${escapeHtml(article.reference || "")}" />
      </label>
      <label class="field">
        <span>Reference label</span>
        <input name="referenceLabel" placeholder="Read more on Wikipedia" value="${escapeHtml(article.referenceLabel || "")}" />
      </label>
    </div>
    <label class="field">
      <span>Body (markdown)</span>
      <div class="toolbar">
        <button type="button" data-ins="## ">H2</button>
        <button type="button" data-ins="**bold**">B</button>
        <button type="button" data-ins="*italic*">I</button>
        <button type="button" data-ins="[[Article Name]]">[[Link]]</button>
        <button type="button" data-ins="![](/uploads/image.png)">🖼️</button>
        <button type="button" data-ins="<video controls src=\"/uploads/video.mp4\"></video>">🎬</button>
        <button type="button" data-ins="<audio controls src=\"/uploads/audio.mp3\"></audio>">🎧</button>
      </div>
      <textarea name="content" rows="18">${escapeHtml(article.content)}</textarea>
    </label>
    <div class="editor-actions">
      <button class="btn btn-primary" type="submit">Save changes</button>
      <button class="btn btn-danger" type="button" data-delete="${article.slug}">Delete</button>
      <a class="btn btn-ghost" href="/uploads">Upload media</a>
    </div>
  </form>
</section>`;
  res.send(layout(`Edit: ${article.title}`, body, treeHtml(tree)));
});

app.get("/uploads", (req, res) => {
  const tree = buildTree();
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith(".")).map((f) => {
    const p = path.join(UPLOAD_DIR, f);
    const stat = fs.statSync(p);
    const ext = path.extname(f).slice(1).toLowerCase();
    const kind = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext) ? "image" : ["mp4", "webm", "mov", "ogg", "m4v"].includes(ext) ? "video" : ["mp3", "wav", "m4a", "flac", "aac"].includes(ext) ? "audio" : "file";
    return { name: f, size: stat.size, date: stat.mtime, url: `/uploads/${f}`, kind, ext };
  }).sort((a, b) => b.date - a.date);
  const mkItem = (f) => {
    const size = f.size > 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${Math.round(f.size / 1e3)} KB`;
    const preview = f.kind === "image" ? `<img src="${f.url}" alt="" loading="lazy" />`
      : f.kind === "video" ? `<video src="${f.url}" muted preload="metadata"></video>`
      : f.kind === "audio" ? `<audio controls src="${f.url}"></audio>`
      : `<div class="file-badge">📄 ${f.ext}</div>`;
    return `<div class="media-card">
      <div class="media-preview">${preview}</div>
      <div class="media-info">
        <code>${escapeHtml(f.name)}</code>
        <span class="card-meta">${size}</span>
      </div>
      <div class="media-actions">
        <button class="btn btn-ghost btn-sm" data-copy="${f.url}">Copy link</button>
        <button class="btn btn-ghost btn-sm" data-embed="${f.kind}" data-url="${f.url}">Embed</button>
      </div>
    </div>`;
  };
  const body = `
<section class="uploads-wrap">
  <div class="editor-toolbar"><h2>Media library</h2><a href="/" class="btn btn-ghost btn-sm">← Home</a></div>
  <form class="upload-form" action="/api/upload" method="POST" enctype="multipart/form-data">
    <input type="file" name="files" multiple accept="image/*,video/*,audio/*" />
    <button class="btn btn-primary" type="submit">Upload</button>
  </form>
  <div class="hint">After uploading, use <strong>Copy link</strong> to grab the URL, or <strong>Embed</strong> to insert it into your article.</div>
  <div class="media-grid">${files.length ? files.map(mkItem).join("") : '<p class="empty">No media yet. Upload something above.</p>'}</div>
</section>`;
  res.send(layout("Media library", body, treeHtml(tree)));
});

app.get("/search", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  const tree = buildTree();
  if (!q) return res.redirect("/");
  const results = listArticles()
    .filter((a) => a.title.toLowerCase().includes(q) || (a.content || "").toLowerCase().includes(q) || (a.tags || []).some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title));
  const body = `
<section>
  <h1>Search: "${escapeHtml(q)}"</h1>
  ${results.length ? `<div class="card-list">${results.map((a) => `<a class="card" href="/${a.slug}"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(extractExcerpt(a))}</p></a>`).join("")}</div>` : '<p class="empty">No results. <a href="/new?title=' + encodeURIComponent(q) + '">Create it?</a></p>'}
</section>`;
  res.send(layout(`Search: ${q}`, body, treeHtml(tree)));
});

app.get("/tags/:tag", (req, res) => {
  const tag = req.params.tag;
  const tree = buildTree();
  const results = listArticles().filter((a) => (a.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase()));
  const body = `<section><h1>#${escapeHtml(tag)}</h1>
    ${results.length ? `<div class="card-list">${results.map((a) => `<a class="card" href="/${a.slug}"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(extractExcerpt(a))}</p></a>`).join("")}</div>` : '<p class="empty">No articles with this tag.</p>'}
  </section>`;
  res.send(layout(`#${tag}`, body, treeHtml(tree)));
});

app.get("/:slug", (req, res) => {
  const slug = req.params.slug;
  const tree = buildTree();
  const article = getArticle(slug);
  if (!article) {
    const body = `<div class="error"><h1>404</h1><p>"${escapeHtml(slug)}" doesn't exist yet.</p><a class="btn btn-primary" href="/new?title=${encodeURIComponent(slug)}">Create it</a></div>`;
    return res.status(404).send(layout("Not found", body, treeHtml(tree)));
  }

  const { html, backlinks, unresolved } = renderMarkdown(article, { tree });
  const kids = tree.find((n) => n.slug === slug)?.children || [];
  const parent = article.parent ? getArticle(article.parent) : null;
  const allTags = [...new Set(listArticles().flatMap((a) => a.tags || []))].sort();

  const refBlock = article.reference ? `<div class="reference">
    <a href="${escapeHtml(article.reference)}" target="_blank" rel="noopener">
      ${article.referenceLabel ? escapeHtml(article.referenceLabel) : "Read the reference article ↗"}
    </a>
  </div>` : "";

  const body = `
<article class="article">
  <div class="article-meta">
    <span class="breadcrumb">${parent ? `<a href="/${parent.slug}">${escapeHtml(parent.title)}</a> / ` : ""}${escapeHtml(article.title)}</span>
    <span class="updated">${toDate(article.updated || article.created)}</span>
  </div>
  <div class="article-actions">
    <a href="/${article.slug}/edit" class="btn btn-ghost btn-sm">✏️ Edit</a>
  </div>
  <h1 class="article-title">${escapeHtml(article.title)}</h1>
  ${article.lead ? `<p class="lead">${escapeHtml(article.lead)}</p>` : ""}
  <div class="wiki-body">${html}</div>
  ${refBlock}
  ${article.tags && article.tags.length ? `<div class="tags">${article.tags.map((t) => `<a class="tag" href="/tags/${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join("")}</div>` : ""}
</article>
${backlinks.length ? `<section class="backlinks"><h2>Linked from</h2><ul>${backlinks.map((b) => `<li><a href="/${b.slug}">${escapeHtml(b.title)}</a></li>`).join("")}</ul></section>` : ""}
${unresolved.length ? `<section class="unresolved"><h2>Unresolved links</h2><p>These wiki links point to pages that don't exist yet:</p><ul>${unresolved.map((u) => `<li><a class="redlink" href="/new?title=${encodeURIComponent(u)}">${escapeHtml(u)}</a></li>`).join("")}</ul></section>` : ""}
${kids.length ? `<section class="sub-articles"><h2>Sub-articles</h2><ul>${kids.map((k) => `<li><a href="/${k.slug}">${escapeHtml(k.title)}</a></li>`).join("")}</ul></section>` : ""}
${allTags.length ? `<section class="all-tags"><h2>All tags</h2>${allTags.map((t) => `<a class="tag" href="/tags/${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join("")}</section>` : ""}`;

  res.send(layout(article.title, body, treeHtml(tree, slug)));
});

app.post("/api/upload", upload.array("files"), (req, res) => {
  if (!req.files || !req.files.length) return res.redirect("/uploads?error=none");
  res.redirect("/uploads?ok=" + req.files.length);
});

app.post("/api/articles", (req, res) => {
  const { slug: existingSlug, title, parent, tags, reference, referenceLabel, content } = req.body;
  if (!title || !String(title).trim()) return res.status(400).send("Title is required");
  const trimmed = String(content || "").trim().replace(/^\n+/, "").trimStart();
  const meta = { title: String(title).trim(), parent: parent || "", tags, reference: reference || "", referenceLabel: referenceLabel || "" };
  const article = saveArticle({ existingSlug, meta, content: trimmed });
  res.redirect(`/${article.slug}`);
});

app.post("/api/articles/:slug/delete", (req, res) => {
  const kids = listArticles().filter((a) => a.parent === req.params.slug);
  if (kids.length) return res.status(400).send("Cannot delete: it has sub-articles. Remove or re-parent them first.");
  deleteArticle(req.params.slug);
  res.redirect("/");
});

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 1) return res.json([]);
  res.json(listArticles().filter((a) => a.title.toLowerCase().includes(q)).slice(0, 8).map((a) => ({ title: a.title, slug: a.slug })));
});

app.use((req, res) => res.status(404).send(layout("Not found", `<div class="error"><h1>404</h1><p>Nothing here.</p><a class="btn btn-primary" href="/">Go home</a></div>`, treeHtml(buildTree()))));

app.listen(PORT, () => console.log(`Personal Wiki running at http://localhost:${PORT}`));
