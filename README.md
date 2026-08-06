# 📚 Personal Wiki

A modern, sleek, self-hosted wiki for writing articles and sub-articles, linking pages with hyperlinks, referencing real encyclopedia articles, and embedding images, video, and audio.

## ✨ Features

- **Articles & sub-articles** — nest related pages under a parent (shown as a collapse tree in the sidebar)
- **Wiki links** — link any page with `[[Page Title]]`; unresolved links show as red links you can click to create
- **External references** — attach a URL to a real wiki (e.g. Wikipedia) shown as a reference box on the article
- **Media library** — upload **images, video and audio**, then embed them with one click
- **Full-text & instant search**
- **Backlinks** — see which pages link to the one you're reading
- **Tags** — organize and filter articles
- **Markdown editor** with toolbar buttons and live preview of wiki links

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