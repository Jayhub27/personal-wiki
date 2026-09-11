# ✦ Aetherwiki

A modern, sleek, self-hosted **personal wiki** draped in an animated aether — with a Three.js particle background. Write articles and sub-articles, link pages with hyperlinks, reference real encyclopedia pages, and embed images, video, and audio.

## Feature
- **Animated 3D backdrop** — a Three.js scene of stars, an orbiting wireframe artifact, and an interactive particle ring that follows your cursor
- **Animated branching timeline** — add branches & sub-branches visually with pulsing nodes and staggered reveals
- **Portable storage** — adapter layer that runs on local files, **Supabase**, or **Vercel Postgres**, with one-click export/import
- **Glassmorphism UI** — sticky blur topbar, slide-in toc drawer, aurora glows
- **Articles & sub-articles** — nest related pages under a parent (shown as a tree)
- **Wiki links** — link any page with `[[Page Title]]`; unresolved links show as red links you can click to create
- **External references** — attach a URL to a real encyclopedia article shown as a glowing reference box
- **Media library** — upload **images, video and audio**, then embed them with one click
- **Full-text & instant search**, **backlinks** & **tags**
- **Health endpoint** (`GET /health`) and a Node test suite (`npm test`)

## 🚀 Run it

```bash
npm install
npm start        # http://localhost:3210
```

## 💾 Storage — Supabase or Vercel

The wiki ships with an adapter layer (`lib/storage.js`) so you can back it with local files (default), **Supabase**, or **Vercel Postgres** — no code changes.

### Switch adapter

| Backend | `STORAGE_ADAPTER` | Env vars |
| --- | --- | --- |
| Local files (default) | `files` | none |
| Supabase | `supabase` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or service-role) |
| Vercel Postgres | `vercel` | install `@vercel/postgres`, `DATABASE_URL` |

> [!NOTE]
> The `vercel` adapter talks to a Vercel/Neon **Postgres** database from the long-running
> Node server. This app is **not** a serverless function, so it cannot be deployed to Vercel
> as-is — run `server.js` on a host that keeps a process alive (see the hosting notes).

```bash
STORAGE_ADAPTER=supabase SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<key> node server.js
```

### Migrate your data

1. Open **/data** in the app (or run `node scripts/export.mjs`) → download `backup.json`.
2. Supabase: run `supabase/schema.sql` in the SQL editor to create the `articles` table.
   Vercel: run `vercel/schema.sql` on your Postgres instance.
3. Restart with the adapter + env vars above.
4. **Import** the `backup‑json` on the **/data** page to push your articles in. Everything else works unchanged.

`scripts/export.mjs --sql` also prints INSERT statements if you'd rather import via SQL directly.

## 🗂 Layout

```
server.js            Express app (routes, uploads, rendering)
lib/storage.js      Adapter layer: files / supabase / vercel (+ export/import)
lib/articles.js      Content helpers: slugify, parent tree
lib/render.js        Markdown + wiki-link renderer
scripts/export.mjs   CLI backup / SQL export
supabase/schema.sql  Supabase table schema
vercel/schema.sql    Vercel Postgres table schema
content/             Your articles (Markdown + frontmatter)
public/              Static assets, app.js, style.css, uploads/
```

## 🔗 Wiki-link syntax

```
[[Page Title]]              -> link to that page (creates it if missing)
[[Page Title|My label]]    -> link with custom label
![](/uploads/image.png)    -> embed image
<video controls src="/uploads/video.mp4"></video>
<audio controls src="/uploads/audio.mp3"></audio>
```