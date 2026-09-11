import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { listArticles, getArticle, saveArticle, deleteArticle, buildTree, slugify } from "./lib/articles.js";
import { renderMarkdown, extractExcerpt } from "./lib/render.js";
import { ADAPTER, exportData, importData } from "./lib/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, "content");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");

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

const layout = (title, body, active = "", meta = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(meta.description || "Aetherwiki — a personal wiki draped in an animated aether.")}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(meta.description || "A personal wiki draped in an animated aether.")}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
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
      <a href="/timeline" class="btn btn-ghost btn-sm">Timeline</a>
      <a href="/uploads" class="btn btn-ghost btn-sm">Media</a>
      <a href="/data" class="btn btn-ghost btn-sm">Data</a>
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

function safeUrl(url) {
  const value = String(url ?? "").trim();
  return /^https?:\/\//i.test(value) ? value : "";
}

const adapterLabels = { files: "Local files (content/*.md)", supabase: "Supabase (Postgres)", vercel: "Vercel Postgres" };

function toDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

app.get("/", async (req, res) => {
  const tree = await buildTree();
  const articles = (await listArticles()).sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
  const recent = articles.slice(0, 8);
  const body = `
<section class="hero">
  <span class="chip">✦ your personal library</span>
  <h1>Weave your knowledge<br/>into the aether</h1>
  <p>Turn scattered notes into a living library — write articles, link ideas together, and bring them to life with images, video and audio.</p>
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

app.get("/new", async (req, res) => {
  const tree = await buildTree();
  const parent = req.query.parent ? await getArticle(req.query.parent) : null;
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
        <span>Reference (optional — link to a real encyclopedia article)</span>
        <input name="reference" placeholder="https://example.org/wiki/article" />
      </label>
      <label class="field">
        <span>Reference label</span>
        <input name="referenceLabel" placeholder="Read the full article" />
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

app.get("/:slug/edit", async (req, res) => {
  const tree = await buildTree();
  const article = await getArticle(req.params.slug);
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
        <input name="reference" placeholder="https://example.org/wiki/article" value="${escapeHtml(article.reference || "")}" />
      </label>
      <label class="field">
        <span>Reference label</span>
        <input name="referenceLabel" placeholder="Read the full article" value="${escapeHtml(article.referenceLabel || "")}" />
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

app.get("/uploads", async (req, res) => {
  const tree = await buildTree();
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

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  const tree = await buildTree();
  if (!q) return res.redirect("/");
  const results = (await listArticles())
    .filter((a) => a.title.toLowerCase().includes(q) || (a.content || "").toLowerCase().includes(q) || (a.tags || []).some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title));
  const body = `
<section>
  <h1>Search: "${escapeHtml(q)}"</h1>
  ${results.length ? `<div class="card-list">${results.map((a) => `<a class="card" href="/${a.slug}"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(extractExcerpt(a))}</p></a>`).join("")}</div>` : '<p class="empty">No results. <a href="/new?title=' + encodeURIComponent(q) + '">Create it?</a></p>'}
</section>`;
  res.send(layout(`Search: ${q}`, body, treeHtml(tree)));
});

app.get("/tags/:tag", async (req, res) => {
  const tag = req.params.tag;
  const tree = await buildTree();
  const results = (await listArticles()).filter((a) => (a.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase()));
  const body = `<section><h1>#${escapeHtml(tag)}</h1>
    ${results.length ? `<div class="card-list">${results.map((a) => `<a class="card" href="/${a.slug}"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(extractExcerpt(a))}</p></a>`).join("")}</div>` : '<p class="empty">No articles with this tag.</p>'}
  </section>`;
  res.send(layout(`#${tag}`, body, treeHtml(tree)));
});

app.get("/timeline", async (req, res) => {
  const tree = await buildTree();

  const renderTree = (nodes) => {
    let items = "";
    nodes.forEach((n) => {
      const kids = n.children.length
        ? `<div class="tl-children">${renderTree(n.children)}</div>`
        : "";
      items += `
      <div class="tl-node">
        <div class="tl-branch-handle"></div>
        <div class="tl-item reveal">
          <div class="tl-dot" data-depth="${n.depth || 0}"></div>
          <div class="tl-card">
            <h3><a href="/${n.slug}">${escapeHtml(n.title)}</a></h3>
            <div class="tl-excerpt">${escapeHtml(extractExcerpt(n))}</div>
            <div class="tl-actions">
              <a href="/${n.slug}" class="btn btn-ghost btn-sm">View</a>
              <button class="tl-new-btn" data-parent="${n.slug}">+ branch</button>
            </div>
            <form class="tl-form hidden" action="/api/branch" method="POST">
              <input type="hidden" name="parent" value="${n.slug}" />
              <input name="title" placeholder="Sub-branch title…" required />
              <button class="btn btn-primary btn-sm" type="submit">Add</button>
            </form>
          </div>
        </div>
        ${kids}
      </div>`;
    });
    return items;
  };

  const body = `
<section class="timeline-wrap">
  <div class="timeline-head">
    <h1 class="page-title">The timeline</h1>
    <p>Trace your ideas as living branches. Click <span class="lg-new">+ branch</span> on any illustration to sprout a new branch or sub-branch beneath it.</p>
  </div>
  <div class="timeline-scroll">
    <div class="timeline">
      ${tree.length ? `<div class="tl-root">${renderTree(tree)}</div>` : '<div class="empty empty-tl"><p>No branches yet.</p><a class="btn btn-primary" href="/new">Create the first branch</a></div>'}
      <div class="tl-footer-add">
        <button class="tl-new-add" data-slug="">+ new root article</button>
        <form class="tl-form hidden" action="/api/branch" method="POST">
          <input type="hidden" name="parent" value="" />
          <input name="title" placeholder="Root article title…" required />
          <button class="btn btn-primary btn-sm" type="submit">Add</button>
        </form>
      </div>
    </div>
  </div>
  <div class="timeline-legend">
    <span class="lg lg-root">● root</span>
    <span class="lg lg-child">○ branch</span>
    <span class="lg lg-new">+ new branch</span>
  </div>
</section>`;
  res.send(layout("Timeline", body, treeHtml(tree)));
});

app.get("/data", async (req, res) => {
  const tree = await buildTree();
  const imported = req.query.imported ? `<div class="toast">✅ Imported ${escapeHtml(req.query.imported)} article(s).</div>` : "";
  const body = `
<section class="editor-wrap">
  <div class="editor-toolbar"><h2>Data & backup</h2><a href="/" class="btn btn-ghost btn-sm">← Home</a></div>
  ${imported}
  <p class="hint">Storage adapter: <code>${escapeHtml(ADAPTER)}</code> — ${escapeHtml(adapterLabels[ADAPTER] || adapterLabels.files)}.
  Set <code>STORAGE_ADAPTER=files|supabase|vercel</code> when starting the server to switch backends.</p>

  <div class="card-list data-cards">
    <div class="card">
      <h3>⬇️ Export all data</h3>
      <p>Download every article as a portable JSON bundle. You can import it back here, into Supabase, or into Vercel.</p>
      <a href="/api/export" class="btn btn-primary btn-sm">Download JSON</a>
    </div>
    <div class="card">
      <h3>⬆️ Import data</h3>
      <p>Upload a previously exported JSON bundle to restore or merge articles.</p>
      <form class="import-form" action="/api/import" method="POST" enctype="multipart/form-data">
        <input type="file" name="bundle" accept=".json,application/json" required />
        <button class="btn btn-primary btn-sm" type="submit">Import</button>
      </form>
    </div>
  </div>

  <div class="storage-guide">
    <h3>How to move to Supabase or Vercel</h3>
    <ol>
      <li><strong>Export</strong> your data (button above) to <code>backup.json</code>.</li>
      <li>In Supabase: open the SQL editor and run <code>supabase/schema.sql</code> to create the <code>articles</code> table.</li>
      <li>Restart with <code>STORAGE_ADAPTER=supabase</code> plus <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> env vars.</li>
      <li>Hit <strong>Import</strong> to push your file into Supabase. Everything else works unchanged.</li>
      <li>On Vercel, install <code>@vercel/postgres</code>, run <code>vercel/schema.sql</code>, set <code>STORAGE_ADAPTER=vercel</code>, and connect your Postgres env.</li>
    </ol>
  </div>
</section>`;
  res.send(layout("Data & backup", body, treeHtml(tree)));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", adapter: ADAPTER, uptime: Math.round(process.uptime()) });
});

app.get("/:slug", async (req, res) => {
  const slug = req.params.slug;
  const tree = await buildTree();
  const article = await getArticle(slug);
  if (!article) {
    const body = `<div class="error"><h1>404</h1><p>"${escapeHtml(slug)}" doesn't exist yet.</p><a class="btn btn-primary" href="/new?title=${encodeURIComponent(slug)}">Create it</a></div>`;
    return res.status(404).send(layout("Not found", body, treeHtml(tree)));
  }

  const { html, backlinks, unresolved } = renderMarkdown(article, { tree });
  const kids = tree.find((n) => n.slug === slug)?.children || [];
  const parent = article.parent ? await getArticle(article.parent) : null;
  const allTags = [...new Set((await listArticles()).flatMap((a) => a.tags || []))].sort();

  const refUrl = safeUrl(article.reference);
  const refBlock = refUrl ? `<div class="reference">
    <a href="${escapeHtml(refUrl)}" target="_blank" rel="noopener noreferrer">
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

  res.send(layout(article.title, body, treeHtml(tree, slug), { description: extractExcerpt(article) || article.title }));
});

app.post("/api/upload", upload.array("files"), (req, res) => {
  if (!req.files || !req.files.length) return res.redirect("/uploads?error=none");
  res.redirect("/uploads?ok=" + req.files.length);
});

app.post("/api/articles", async (req, res) => {
  const { slug: existingSlug, title, parent, tags, reference, referenceLabel, content } = req.body;
  if (!title || !String(title).trim()) return res.status(400).send("Title is required");
  const trimmed = String(content || "").trim().replace(/^\n+/, "").trimStart();
  const meta = { title: String(title).trim(), parent: parent || "", tags, reference: safeUrl(reference), referenceLabel: referenceLabel || "" };
  const article = await saveArticle({ existingSlug, meta, content: trimmed });
  res.redirect(`/${article.slug}`);
});

app.post("/api/articles/:slug/delete", async (req, res) => {
  const kids = (await listArticles()).filter((a) => a.parent === req.params.slug);
  if (kids.length) return res.status(400).send("Cannot delete: it has sub-articles. Remove or re-parent them first.");
  await deleteArticle(req.params.slug);
  res.redirect("/");
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 1) return res.json([]);
  res.json((await listArticles()).filter((a) => a.title.toLowerCase().includes(q)).slice(0, 8).map((a) => ({ title: a.title, slug: a.slug })));
});

app.post("/api/branch", async (req, res) => {
  const { title, parent } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title is required" });
  const article = await saveArticle({ existingSlug: "", meta: { title: String(title).trim(), parent: parent || "" }, content: "" });
  res.redirect(`/${article.slug}/edit`);
});

app.get("/api/export", async (req, res) => {
  const data = await exportData();
  res.setHeader("Content-Disposition", 'attachment; filename="aetherwiki-backup.json"');
  res.type("application/json");
  res.send(JSON.stringify(data, null, 2));
});

const bundleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.post("/api/import", bundleUpload.single("bundle"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("Please upload a JSON bundle file.");
    const parsed = JSON.parse(req.file.buffer.toString("utf8"));
    const slugs = await importData(parsed);
    res.redirect(`/data?imported=${slugs.length}`);
  } catch (err) {
    res.status(400).send("Import failed: " + err.message);
  }
});

app.use(async (req, res) => res.status(404).send(layout("Not found", `<div class="error"><h1>404</h1><p>Nothing here.</p><a class="btn btn-primary" href="/">Go home</a></div>`, treeHtml(await buildTree()))));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, () => console.log(`Personal Wiki running at http://localhost:${PORT}`));
}

export default app;
