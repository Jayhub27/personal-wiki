# ✦ Aetherwiki

A modern, sleek, self-hosted **personal wiki** draped in an animated aether — with a Three.js
particle background. Write articles and sub-articles, link pages with wiki-links, reference real
encyclopedia pages, and embed images, video and audio.

Server-rendered with **Express 5** and vanilla JS — no build step, no heavy framework.

## Features

- **Animated 3D backdrop** — Three.js stars, an orbiting wireframe artifact, and a cursor-following particle ring
- **Light / dark theme** — toggle in the topbar, follows your system preference, saved locally
- **Articles & sub-articles** — nest related pages under a parent (shown as a tree)
- **Wiki-links** — link any page with `[[Page Title]]`; unresolved links show as red links you can create
- **Backlinks, tags & ranked search** — full-text results with match highlighting and pagination
- **Interactive graph** — a draggable force graph of every `[[link]]` and parent relation at `/graph`
- **Branching timeline** — add branches & sub-branches on a pulsing, animated timeline
- **Media library** — upload images, video and audio, then copy a link or one-click embed
- **Markdown editor** — toolbar, syntax highlighting, live preview and an on-this-page TOC
- **Revision history** — every save is versioned; browse and restore old revisions
- **Trash** — deleted articles are recoverable instead of gone
- **Portable storage** — adapter layer for local files, **Supabase**, or **Vercel Postgres**, plus one-click export/import
- **Portable media** — optional Supabase Storage backend with a server-side media proxy
- **Security** — optional login, CSRF protection, helmet + strict CSP, rate limiting, input validation and HTML sanitisation
- **PWA** — installable with an offline app shell
- **Tests & CI** — Node built-in test runner (`npm test`) and a GitHub Actions workflow

## 🚀 Run it

```bash
npm install
npm start        # http://localhost:3210
npm test         # Node built-in test runner
npm run lint     # syntax check every source file
```

### Docker

```bash
cp .env.example .env
docker compose up --build
```

## 🔐 Authentication (optional, recommended)

By default the wiki is open (fine for local use). Set `AUTH_PASSWORD` to require login — all
pages, APIs, media and uploads then need a signed session cookie; `/health` stays public.

```bash
AUTH_USERNAME=admin AUTH_PASSWORD=secret SESSION_SECRET=$(openssl rand -hex 32) npm start
```

Prefer not to keep a plaintext password in the environment? Generate a hash:

```bash
node scripts/hash-password.mjs 'your password'    # prints a sha256 hash
AUTH_PASSWORD_HASH=<hash> SESSION_SECRET=<long-random-string> npm start
```

Multiple accounts sharing one wiki (JSON of username → sha256 hash):

```bash
AUTH_USERS='{"alice":"<hash>","bob":"<hash>"}' SESSION_SECRET=... npm start
```

## 📡 Feeds

`/rss.xml` and `/sitemap.xml` are available (behind auth when login is enabled).

## 💾 Storage — Supabase or Vercel

The wiki ships with an adapter layer (`lib/storage.js`) so you can back it with local files
(default), **Supabase**, or **Vercel Postgres** — no code changes.

| Backend | `STORAGE_ADAPTER` | Env vars |
| --- | --- | --- |
| Local files (default) | `files` | none |
| Supabase | `supabase` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only) |
| Vercel Postgres | `vercel` | install `@vercel/postgres`, `DATABASE_URL` |

> [!NOTE]
> The `vercel` adapter talks to a Vercel/Neon **Postgres** database from the long-running Node
> server. This app is **not** a serverless function, so it cannot be deployed to Vercel as-is —
> run `server.js` on a host that keeps a process alive.

### Media

Media uses local disk by default. With `STORAGE_ADAPTER=supabase` it automatically uses a
private Supabase Storage bucket (`SUPABASE_MEDIA_BUCKET`, default `media`) and the `media`
table, served through the auth-protected `/media/:name` proxy.

### Migrate your data

1. Open **/data** in the app (or run `node scripts/export.mjs`) → download `backup.json`.
2. Supabase: run `supabase/schema.sql` in the SQL editor. For plain Postgres/Vercel use the
   versioned files in `migrations/` (`npm run migrate` with `DATABASE_URL`).
3. Restart with the adapter + env vars above.
4. **Import** the bundle on the **/data** page. Everything else works unchanged.

## 🗂 Layout

```
server.js             Express app (routes, middleware, HTML layout)
lib/storage.js        Adapter layer: files / supabase / vercel (+ revisions, trash, export)
lib/media.js          Media adapter: local disk or Supabase Storage (+ proxy streaming)
lib/articles.js       Content helpers: cache, slugify, parent tree, revisions, trash
lib/render.js         Markdown + wiki-link renderer, highlighter, TOC
lib/search.js         Ranked search + match highlighting
public/app.js         Client interactions (theme, preview, CSRF, drag-drop)
public/background.js  Three.js aether scene
public/graph.js       Interactive SVG force graph
migrations/           Versioned SQL migrations
scripts/              export.mjs · hash-password.mjs · migrate.mjs · check.mjs
supabase/schema.sql   Supabase tables + RLS
content/              Your articles (Markdown + frontmatter)
```

## 🔗 Wiki-link syntax

```
[[Page Title]]              -> link to that page (creates it if missing)
[[Page Title|My label]]    -> link with custom label
![](/uploads/image.png)    -> embed image
<video controls src="/uploads/video.mp4"></video>
<audio controls src="/uploads/audio.mp3"></audio>
```

## Hosting

Free/secure hosting options are documented in the Obsidian vault note **Hosting Research**.
The short version: a free VM (Oracle Always Free / GCP `e2-micro`) or an always-on free service
(render-with-sleep or Northflank Sandbox) plus Supabase Free for data and media.
