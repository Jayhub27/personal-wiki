#!/usr/bin/env node
// Aetherwiki — one-shot helpers
//
//   node scripts/export.mjs                    -> writes aetherwiki-backup.json
//   node scripts/export.mjs --sql              -> prints INSERT statements for Supabase/Vercel
//
// The JSON is the same portable bundle the app's /data page exports. Use it to
// move data into Supabase/Vercel, or to back up your local content.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content");

function slugify(title) {
  return String(title || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";
}

function parse(slug) {
  const p = path.join(CONTENT_DIR, slug + ".md");
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  const lines = raw.split(/\r?\n/);
  const meta = {};
  if (lines[0] === "---") {
    let end = 1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") { end = i; break; }
      const m = lines[i].match(/^([\w-]+):\s?(.*)$/);
      if (m) meta[m[1]] = m[2];
    }
    meta.content = lines.slice(end + 1).join("\n");
  } else {
    meta.content = raw;
  }
  return {
    slug: slugify(slug),
    title: meta.title || slug,
    content: meta.content || "",
    parent: meta.parent ? slugify(meta.parent) : "",
    tags: meta.tags ? String(meta.tags).split(",").map((t) => t.trim()).filter(Boolean) : [],
    reference: meta.reference || "",
    referenceLabel: meta.referenceLabel || "",
    lead: meta.lead || "",
    created: meta.created || "",
    updated: meta.updated || "",
  };
}

const articles = fs.existsSync(CONTENT_DIR)
  ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md")).map((f) => parse(f.replace(/\.md$/, ""))).filter(Boolean)
  : [];

const bundle = { app: "aetherwiki", version: 1, exportedAt: new Date().toISOString(), articles };

if (process.argv.includes("--sql")) {
  const esc = (s) => String(s ?? "").replace(/'/g, "''");
  console.log("-- Aetherwiki INSERT statements (run in Supabase/Vercel SQL editor)");
  for (const a of articles) {
    console.log(`insert into articles (slug, title, content, parent, reference, reference_label, lead, tags, created_at, updated_at)
values ('${a.slug}', '${esc(a.title)}', '${esc(a.content)}', ${a.parent ? "'" + a.parent + "'" : null}, ${a.reference ? "'" + esc(a.reference) + "'" : null}, ${a.referenceLabel ? "'" + esc(a.referenceLabel) + "'" : null}, ${a.lead ? "'" + esc(a.lead) + "'" : null}, '{"${a.tags.join('","')}"}', '${a.created}', '${a.updated}')
on conflict (slug) do update set title=excluded.title, content=excluded.content, parent=excluded.parent, reference=excluded.reference, reference_label=excluded.reference_label, lead=excluded.lead, tags=excluded.tags, updated_at=excluded.updated_at;`);
  }
} else {
  fs.writeFileSync(path.join(ROOT, "aetherwiki-backup.json"), JSON.stringify(bundle, null, 2));
  console.log(`Exported ${articles.length} articles to aetherwiki-backup.json`);
}