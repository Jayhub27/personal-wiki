import express from "express";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { listArticles, getArticle, saveArticle, deleteArticle, buildTree, slugify, invalidateCache, historySupported, trashSupported, articleRevisions, articleRevision, restoreRevision, listTrashItems, restoreTrashed, purgeTrashed } from "./lib/articles.js";
import { renderMarkdown, extractExcerpt, extractLinks } from "./lib/render.js";
import { searchArticles, highlight, matchExcerpt } from "./lib/search.js";
import { ADAPTER, exportData, importData } from "./lib/storage.js";
import { MEDIA_ADAPTER, uploadStorage, listMedia, saveMedia, removeMedia, streamMedia } from "./lib/media.js";
import { askWiki, aiConfigured } from "./lib/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, "content");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");

fs.mkdirSync(CONTENT_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3210;
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const globalLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false });
const mutationLimiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
app.use(globalLimiter);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const CSRF_COOKIE = "aetherwiki_csrf";
const parseCookies = (header = "") => {
  const out = {};
  String(header).split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
};

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[CSRF_COOKIE];
  if (!token || token.length < 32) {
    token = crypto.randomBytes(24).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      secure: req.secure,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
  }
  res.locals.csrf = token;
  next();
});

const AUTH_ENABLED = !!(process.env.AUTH_PASSWORD || process.env.AUTH_PASSWORD_HASH);
const AUTH_USER = process.env.AUTH_USERNAME || "admin";
const SESSION_COOKIE = "aetherwiki_session";
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
const SESSION_SECRET = process.env.SESSION_SECRET || (AUTH_ENABLED ? crypto.randomBytes(32).toString("hex") : "");
if (AUTH_ENABLED && !process.env.SESSION_SECRET) {
  console.warn("[aetherwiki] AUTH is enabled without SESSION_SECRET — a random secret is used and sessions reset on restart.");
}

const sha256hex = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || (process.env.AUTH_PASSWORD ? sha256hex(process.env.AUTH_PASSWORD) : "");

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${mac}`;
}

function verifySession(token) {
  if (!AUTH_ENABLED || !SESSION_SECRET || !token) return null;
  const [data, mac] = String(token).split(".");
  if (!data || !mac) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return !!verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

function checkCredentials(username, password) {
  return safeEqual(username || "", AUTH_USER) && safeEqual(sha256hex(password || ""), PASSWORD_HASH);
}

function safeNext(value) {
  const next = String(value || "");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const OPEN_PATHS = new Set(["/login", "/logout", "/health", "/style.css", "/app.js", "/background.js", "/theme-init.js", "/graph.js", "/ask.js", "/sw.js", "/manifest.webmanifest", "/icon.svg"]);
const isOpenPath = (pathname) => OPEN_PATHS.has(pathname) || pathname.startsWith("/vendor/");

app.use((req, res, next) => {
  if (isAuthed(req) || isOpenPath(req.path)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Authentication required" });
  return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "three", "build")));

function verifyCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  const sent = (req.body && req.body._csrf) || req.get("x-csrf-token") || "";
  if (!token || !sent || sent.length !== token.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token))) {
    return res.status(403).send("Invalid or missing CSRF token");
  }
  next();
}

const articleSchema = z.object({
  slug: z.string().trim().max(200).optional().default(""),
  title: z.string().trim().min(1).max(300),
  parent: z.string().trim().max(200).optional().default(""),
  tags: z.string().max(2000).optional().default(""),
  reference: z.string().trim().max(2000).optional().default(""),
  referenceLabel: z.string().trim().max(300).optional().default(""),
  content: z.string().max(5_000_000).optional().default(""),
});

const branchSchema = z.object({
  title: z.string().trim().min(1).max(300),
  parent: z.string().trim().max(200).optional().default(""),
});

const importRowSchema = z.object({ title: z.string().optional(), slug: z.string().optional() }).passthrough()
  .refine((r) => r.title || r.slug, { message: "each article needs a title or slug" });
const importSchema = z.union([
  z.array(importRowSchema).max(10_000),
  z.object({ articles: z.array(importRowSchema).max(10_000) }),
]);

function firstIssue(error) {
  const issue = error.issues?.[0];
  return issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input";
}

const MEDIA_MIME = /^(image|video|audio)\//;
const upload = multer({
  storage: uploadStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, MEDIA_MIME.test(file.mimetype)),
});

function uploadFiles(req, res, next) {
  upload.array("files")(req, res, (err) => {
    if (err) return res.status(400).send("Upload rejected: " + err.message);
    if (!req.files?.length) return res.redirect("/uploads?error=type");
    next();
  });
}

const layout = (title, body, active = "", meta = {}) => {
  const bare = !!meta.bare;
  const logout = AUTH_ENABLED && !bare
    ? `<form class="logout-form" action="/logout" method="POST"><button class="btn btn-ghost btn-sm" type="submit">Log out</button></form>`
    : "";
  const nav = bare ? "" : `
      <button id="theme-btn" class="icon-btn" type="button" aria-label="Toggle color theme" title="Toggle theme">🌙</button>
      <a href="/timeline" class="btn btn-ghost btn-sm">Timeline</a>
      <a href="/graph" class="btn btn-ghost btn-sm">Graph</a>
      <a href="/ask" class="btn btn-ghost btn-sm">Ask</a>
      <a href="/uploads" class="btn btn-ghost btn-sm">Media</a>
      <a href="/data" class="btn btn-ghost btn-sm">Data</a>
      <a href="/new" class="btn btn-primary btn-sm">+ New article</a>
      ${logout}`;
  const drawer = bare ? "" : `
<aside id="drawer" class="drawer" aria-hidden="true">
  <div class="drawer-head">Table of contents</div>
  <div class="sidebar-search">
    <input id="search" type="search" placeholder="Search the aether…" autocomplete="off" />
    <div id="search-results" class="search-results hidden"></div>
  </div>
  <nav class="tree">${active}</nav>
  <div class="drawer-foot">
    <button id="bg-toggle" class="btn btn-ghost btn-sm" type="button" aria-pressed="true">✦ Animated background</button>
  </div>
</aside>
<div id="scrim" class="scrim" aria-hidden="true"></div>`;
  return `<!doctype html>
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
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#9f6bff" />
<link rel="apple-touch-icon" href="/icon.svg" />
<link rel="icon" href="/icon.svg" />
<script src="/theme-init.js"></script>
</head>
<body>
<canvas id="bg-canvas" aria-hidden="true"></canvas>
<div class="aurora aurora-1"></div>
<div class="aurora aurora-2"></div>
<header class="topbar">
  <div class="topbar-inner">
    ${bare ? "" : '<button id="menu-btn" class="icon-btn" aria-label="Toggle navigation">☰</button>'}
    <a class="brand" href="/"><span class="brand-mark">✦</span> Aetherwiki</a>
    <div class="topbar-right">${nav}
    </div>
  </div>
</header>${drawer}
<main class="content">
${body}
</main>
<script src="/app.js"></script>
<script type="module" src="/background.js"></script>
${(meta.scripts || []).map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`).join("")}
</body>
</html>`;
};

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

function paginate(items, page, perPage) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { items: items.slice((current - 1) * perPage, current * perPage), page: current, pages, total };
}

function pageBar(base, page, pages) {
  if (pages <= 1) return "";
  const sep = base.includes("?") ? "&" : "?";
  const link = (p, label, disabled) => (disabled
    ? `<span class="page-btn disabled">${label}</span>`
    : `<a class="page-btn" href="${base}${sep}page=${p}">${label}</a>`);
  return `<nav class="pagination">${link(page - 1, "← Prev", page <= 1)}<span class="page-count">Page ${page} / ${pages}</span>${link(page + 1, "Next →", page >= pages)}</nav>`;
}

const adapterLabels = { files: "Local files (content/*.md)", supabase: "Supabase (Postgres)", vercel: "Vercel Postgres" };

function toDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

app.get("/login", (req, res) => {
  if (AUTH_ENABLED && isAuthed(req)) return res.redirect(safeNext(req.query.next));
  const error = req.query.error ? `<div class="toast toast-error">${escapeHtml(req.query.error)}</div>` : "";
  const body = `
<section class="login-wrap">
  <h1 class="page-title">✦ Sign in</h1>
  <p class="login-sub">This wiki is private. Enter your credentials to continue.</p>
  ${error}
  <form class="editor-form login-form" action="/login" method="POST">
    <input type="hidden" name="next" value="${escapeHtml(safeNext(req.query.next))}" />
    <label class="field"><span>Username</span><input name="username" autocomplete="username" required autofocus /></label>
    <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
    <button class="btn btn-primary" type="submit">Sign in</button>
  </form>
</section>`;
  res.send(layout("Sign in", body, "", { bare: true }));
});

app.post("/login", verifyCsrf, (req, res) => {
  const { username, password } = req.body || {};
  const next = safeNext(req.body?.next);
  if (!checkCredentials(username, password)) {
    return res.status(401).send(layout("Sign in failed", `<div class="login-wrap"><div class="toast toast-error">Invalid username or password.</div><a class="btn btn-primary" href="/login">Try again</a></div>`, "", { bare: true }));
  }
  res.cookie(SESSION_COOKIE, signSession({ user: AUTH_USER, exp: Date.now() + SESSION_TTL }), {
    httpOnly: true, sameSite: "lax", path: "/", secure: req.secure, maxAge: SESSION_TTL,
  });
  res.redirect(next);
});

app.post("/logout", verifyCsrf, (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.redirect("/login");
});

app.get("/", async (req, res) => {
  const tree = await buildTree();
  const sorted = (await listArticles()).sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
  const { items, page, pages, total } = paginate(sorted, req.query.page, 12);
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
${total ? `<section>
<div class="section-title">Articles <span class="count">${total}</span></div>
<div class="card-list">
${items.map((a) => `<a class="card" href="/${a.slug}">
  <h3>${escapeHtml(a.title)}</h3>
  <p>${escapeHtml(extractExcerpt(a))}</p>
  <span class="card-meta">${toDate(a.updated || a.created)}${a.parent ? ` · sub-article` : ""}</span>
</a>`).join("")}
</div>
${pageBar("/", page, pages)}
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
        <button type="button" data-preview-toggle aria-pressed="false">👁️ Preview</button>
      </div>
      <textarea name="content" rows="18" placeholder="Write in markdown… Use [[Page Title]] to link to another wiki page."></textarea>
      <div id="md-preview" class="md-preview hidden" aria-live="polite"></div>
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
        <button type="button" data-preview-toggle aria-pressed="false">👁️ Preview</button>
      </div>
      <textarea name="content" rows="18">${escapeHtml(article.content)}</textarea>
      <div id="md-preview" class="md-preview hidden" aria-live="polite"></div>
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

app.get("/:slug/history", async (req, res) => {
  const tree = await buildTree();
  const article = await getArticle(req.params.slug);
  if (!article) return res.status(404).send(layout("Not found", `<div class="error"><h1>404</h1><p>Article not found.</p><a class="btn btn-primary" href="/">Go home</a></div>`, treeHtml(tree)));
  const revisions = historySupported() ? await articleRevisions(article.slug) : [];
  const body = `
<section class="editor-wrap">
  <div class="editor-toolbar"><a href="/${article.slug}" class="btn btn-ghost btn-sm">← Article</a><h2>History: ${escapeHtml(article.title)}</h2></div>
  ${revisions.length ? `<ul class="revision-list">${revisions.map((r) => `<li>
    <span class="revision-date">${new Date(r.at).toLocaleString()}</span>
    <span class="revision-actions">
      <a class="btn btn-ghost btn-sm" href="/${article.slug}/revision/${r.id}">View</a>
      <form action="/api/articles/${article.slug}/revisions/${r.id}/restore" method="POST"><button class="btn btn-ghost btn-sm" type="submit">Restore</button></form>
    </span>
  </li>`).join("")}</ul>` : `<p class="empty">${historySupported() ? "No revisions yet — a revision is stored on each save." : "This storage adapter does not keep revisions."}</p>`}
</section>`;
  res.send(layout(`History: ${article.title}`, body, treeHtml(tree, article.slug)));
});

app.get("/:slug/revision/:id", async (req, res) => {
  const tree = await buildTree();
  const article = await getArticle(req.params.slug);
  const revision = await articleRevision(req.params.slug, req.params.id);
  if (!article || !revision) return res.status(404).send(layout("Not found", `<div class="error"><h1>404</h1><p>Revision not found.</p><a class="btn btn-primary" href="/">Go home</a></div>`, treeHtml(tree)));
  const { html } = renderMarkdown(revision, { tree });
  const body = `
<article class="article">
  <div class="article-meta"><span class="breadcrumb"><a href="/${article.slug}">${escapeHtml(article.title)}</a> / revision</span><span class="updated">${new Date(revision.at).toLocaleString()}</span></div>
  <h1 class="article-title">${escapeHtml(revision.title)}</h1>
  <div class="wiki-body">${html}</div>
  <form action="/api/articles/${article.slug}/revisions/${revision.id}/restore" method="POST"><button class="btn btn-primary" type="submit">Restore this revision</button></form>
</article>`;
  res.send(layout(`Revision: ${revision.title}`, body, treeHtml(tree, article.slug)));
});

app.post("/api/articles/:slug/revisions/:id/restore", mutationLimiter, verifyCsrf, async (req, res) => {
  const restored = await restoreRevision(req.params.slug, req.params.id);
  if (!restored) return res.status(404).send("Revision not found");
  res.redirect(`/${restored.slug}`);
});

app.get("/trash", async (req, res) => {
  const tree = await buildTree();
  const items = trashSupported() ? await listTrashItems() : [];
  const body = `
<section class="editor-wrap">
  <div class="editor-toolbar"><h2>Trash</h2><a href="/data" class="btn btn-ghost btn-sm">← Data</a></div>
  ${items.length ? `<ul class="revision-list">${items.map((t) => `<li>
    <span class="revision-date">${escapeHtml(t.title)}<br><small>${t.slug} · ${new Date(t.at).toLocaleString()}</small></span>
    <span class="revision-actions">
      <form action="/api/trash/${encodeURIComponent(t.id)}/restore" method="POST"><button class="btn btn-ghost btn-sm" type="submit">Restore</button></form>
      <form action="/api/trash/${encodeURIComponent(t.id)}/delete" method="POST"><button class="btn btn-danger btn-sm" type="submit">Delete forever</button></form>
    </span>
  </li>`).join("")}</ul>` : `<p class="empty">${trashSupported() ? "Trash is empty." : "This storage adapter does not support trash."}</p>`}
</section>`;
  res.send(layout("Trash", body, treeHtml(tree)));
});

app.post("/api/trash/:id/restore", mutationLimiter, verifyCsrf, async (req, res) => {
  await restoreTrashed(req.params.id);
  res.redirect("/trash");
});

app.post("/api/trash/:id/delete", mutationLimiter, verifyCsrf, async (req, res) => {
  await purgeTrashed(req.params.id);
  res.redirect("/trash");
});

app.get("/uploads", async (req, res) => {
  const tree = await buildTree();
  const all = await listMedia();
  const { items: files, page, pages } = paginate(all, req.query.page, 24);
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
        <button class="btn btn-ghost btn-sm" data-delete-media="${f.name}">Delete</button>
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
  <div class="media-grid">${all.length ? files.map(mkItem).join("") : '<p class="empty">No media yet. Upload something above.</p>'}</div>
  ${pageBar("/uploads", page, pages)}
</section>`;
  res.send(layout("Media library", body, treeHtml(tree)));
});

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const tree = await buildTree();
  if (!q) return res.redirect("/");
  const ranked = searchArticles(await listArticles(), q);
  const { items, page, pages, total } = paginate(ranked, req.query.page, 20);
  const base = `/search?q=${encodeURIComponent(q)}`;
  const body = `
<section>
  <h1>Search: "${escapeHtml(q)}" <span class="count">${total}</span></h1>
  ${total ? `<div class="card-list">${items.map((a) => `<a class="card" href="/${a.slug}"><h3>${highlight(a.title, q)}</h3><p>${highlight(matchExcerpt(a, q), q)}</p></a>`).join("")}</div>${pageBar(base, page, pages)}` : '<p class="empty">No results. <a href="/new?title=' + encodeURIComponent(q) + '">Create it?</a></p>'}
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

app.get("/ask", async (req, res) => {
  const tree = await buildTree();
  const body = `
<section class="ask-wrap">
  <div class="editor-toolbar"><h2>Ask the wiki</h2><a href="/" class="btn btn-ghost btn-sm">← Home</a></div>
  ${aiConfigured() ? `<p class="hint">Ask a question — the assistant answers from your articles and cites them.</p>
  <form id="ask-form" class="ask-form">
    <input id="ask-input" name="question" placeholder="What do my notes say about…" autocomplete="off" required />
    <button class="btn btn-primary" type="submit">Ask</button>
  </form>
  <div id="ask-answer" class="ask-answer hidden" aria-live="polite"></div>`
    : `<div class="toast toast-error">AI is not configured. Set <code>AI_API_KEY</code> (optionally <code>AI_API_URL</code>, <code>AI_MODEL</code>) to enable this feature.</div>`}
</section>`;
  res.send(layout("Ask the wiki", body, treeHtml(tree), { scripts: ["/ask.js"] }));
});

app.post("/api/ask", mutationLimiter, async (req, res) => {
  const question = String((req.body && req.body.question) || "").trim().slice(0, 500);
  if (!question) return res.status(400).json({ error: "A question is required." });
  try {
    res.json(await askWiki(question, await listArticles()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/graph", async (req, res) => {
  const tree = await buildTree();
  const articles = await listArticles();
  const known = new Set(articles.map((a) => a.slug));
  const nodes = articles.map((a) => ({ id: a.slug, title: a.title, tags: a.tags || [] }));
  const seen = new Set();
  const edges = [];
  const addEdge = (source, target, kind) => {
    if (!known.has(source) || !known.has(target) || source === target) return;
    const key = `${source}|${target}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };
  for (const article of articles) {
    for (const target of extractLinks(article.content)) addEdge(article.slug, target, "link");
    if (article.parent) addEdge(article.parent, article.slug, "parent");
  }
  const graph = JSON.stringify({ nodes, edges });
  const body = `
<section class="graph-wrap">
  <div class="editor-toolbar"><h2>The graph</h2><a href="/" class="btn btn-ghost btn-sm">← Home</a></div>
  <p class="hint">${nodes.length} pages · ${edges.length} links. Drag nodes to explore, click to open an article.</p>
  <div id="graph" class="graph" data-graph="${escapeHtml(graph)}"></div>
</section>`;
  res.send(layout("Graph", body, treeHtml(tree), { scripts: ["/graph.js"] }));
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
    <div class="card">
      <h3>🗑️ Trash</h3>
      <p>Deleted articles are kept in the trash (files adapter) so you can restore them.</p>
      <a href="/trash" class="btn btn-ghost btn-sm">Open trash</a>
    </div>
  </div>

  <div class="storage-guide">
    <h3>How to move to Supabase or Vercel</h3>
    <ol>
      <li><strong>Export</strong> your data (button above) to <code>backup.json</code>.</li>
      <li>In Supabase: open the SQL editor and run <code>supabase/schema.sql</code> to create the <code>articles</code> table.</li>
      <li>Restart with <code>STORAGE_ADAPTER=supabase</code> plus <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> (kept server-side).</li>
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

  const { html, backlinks, unresolved, toc } = renderMarkdown(article, { tree });
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
    ${historySupported() ? `<a href="/${article.slug}/history" class="btn btn-ghost btn-sm">🕘 History</a>` : ""}
  </div>
  <h1 class="article-title">${escapeHtml(article.title)}</h1>
  ${article.lead ? `<p class="lead">${escapeHtml(article.lead)}</p>` : ""}
  ${toc.length > 1 ? `<nav class="article-toc" aria-label="On this page"><div class="article-toc-head">On this page</div><ul>${toc.map((t) => `<li class="toc-${t.level}"><a href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a></li>`).join("")}</ul></nav>` : ""}
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

app.post("/api/upload", uploadLimiter, uploadFiles, verifyCsrf, async (req, res) => {
  try {
    await saveMedia(req.files);
  } catch (err) {
    return res.status(500).send("Upload failed: " + err.message);
  }
  res.redirect("/uploads?ok=" + req.files.length);
});

app.post("/api/media/:name/delete", mutationLimiter, verifyCsrf, async (req, res) => {
  await removeMedia(req.params.name);
  res.redirect("/uploads");
});

app.get("/media/:name", async (req, res) => {
  try {
    await streamMedia(req.params.name, res);
  } catch (err) {
    res.status(500).send("Media error: " + err.message);
  }
});

app.post("/api/articles", mutationLimiter, verifyCsrf, async (req, res) => {
  const parsed = articleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).send("Invalid article: " + firstIssue(parsed.error));
  const { slug: existingSlug, title, parent, tags, reference, referenceLabel, content } = parsed.data;
  const trimmed = String(content || "").trim().replace(/^\n+/, "").trimStart();
  const meta = { title, parent, tags, reference: safeUrl(reference), referenceLabel };
  const article = await saveArticle({ existingSlug, meta, content: trimmed });
  res.redirect(`/${article.slug}`);
});

app.post("/api/articles/:slug/delete", mutationLimiter, verifyCsrf, async (req, res) => {
  const kids = (await listArticles()).filter((a) => a.parent === req.params.slug);
  if (kids.length) return res.status(400).send("Cannot delete: it has sub-articles. Remove or re-parent them first.");
  await deleteArticle(req.params.slug);
  res.redirect("/");
});

app.post("/api/preview", mutationLimiter, async (req, res) => {
  const content = String((req.body && req.body.content) || "").slice(0, 200_000);
  const tree = await buildTree();
  const { html, toc } = renderMarkdown({ content }, { tree });
  res.json({ html, toc });
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 1) return res.json([]);
  res.json((await listArticles()).filter((a) => a.title.toLowerCase().includes(q)).slice(0, 8).map((a) => ({ title: a.title, slug: a.slug })));
});

app.post("/api/branch", mutationLimiter, verifyCsrf, async (req, res) => {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid branch: " + firstIssue(parsed.error) });
  const { title, parent } = parsed.data;
  const article = await saveArticle({ existingSlug: "", meta: { title, parent }, content: "" });
  res.redirect(`/${article.slug}/edit`);
});

app.get("/api/export", async (req, res) => {
  const data = await exportData();
  res.setHeader("Content-Disposition", 'attachment; filename="aetherwiki-backup.json"');
  res.type("application/json");
  res.send(JSON.stringify(data, null, 2));
});

const bundleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
function uploadBundle(req, res, next) {
  bundleUpload.single("bundle")(req, res, (err) => (err ? res.status(400).send("Import rejected: " + err.message) : next()));
}
app.post("/api/import", uploadLimiter, uploadBundle, verifyCsrf, async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("Please upload a JSON bundle file.");
    const raw = JSON.parse(req.file.buffer.toString("utf8"));
    const parsed = importSchema.safeParse(raw);
    if (!parsed.success) return res.status(400).send("Invalid import bundle: " + firstIssue(parsed.error));
    const slugs = await importData(parsed.data);
    invalidateCache();
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
