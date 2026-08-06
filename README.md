# ✦ Aetherwiki

A modern, sleek, self-hosted **personal wiki** draped in an animated aether — with a Three.js particle background. Write articles and sub-articles, link pages with hyperlinks, reference real encyclopedia pages, and embed images, video, and audio.

## ✨ Features

- **Animated 3D backdrop** — a Three.js scene of stars, an orbiting wireframe artifact, and an interactive particle ring that follows your cursor
- **Glassmorphism UI** — sticky blur topbar, slide-in toc drawer, aurora glows
- **Articles & sub-articles** — nest related pages under a parent (shown as a tree)
- **Wiki links** — link any page with `[[Page Title]]`; unresolved links show as red links you can click to create
- **External references** — attach a URL to a real encyclopedia article shown as a glowing reference box
- **Media library** — upload **images, video and audio**, then embed them with one click
- **Full-text & instant search**
- **Backlinks** & **tags** to organize and explore

## 🚀 Run it

```bash
npm install
npm start        # http://localhost:3210
```

> Articles are stored as Markdown files with YAML frontmatter in `content/`.
> Uploads land in `public/uploads/`. Both are gitignored by default.

## 🗂 Layout

```
server.js            Express app (routes, uploads, rendering)
lib/articles.js      Content store: frontmatter, slugify, parent tree
lib/render.js        Markdown + wiki-link renderer
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