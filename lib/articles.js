import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = path.join(__dirname, "..", "content");

export function slugify(title) {
  const s = String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "untitled";
}

export function parseFrontmatter(raw) {
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
  return meta;
}

export function readFile(slug) {
  const p = path.join(CONTENT_DIR, slugify(slug) + ".md");
  if (!fs.existsSync(p)) return null;
  const meta = parseFrontmatter(fs.readFileSync(p, "utf8"));
  meta.slug = slugify(slug);
  meta.tags = meta.tags ? String(meta.tags).split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) : [];
  return meta;
}

export function saveArticle({ existingSlug, meta, content }) {
  const slug = slugify(existingSlug || meta.title);
  const tags = meta.tags ? String(meta.tags).split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) : [];
  const existing = getArticle(slug);
  const created = existing?.created || new Date().toISOString().slice(0, 10);
  const lead = (content || "").split(/\r?\n+/).find((l) => l.trim() && !l.trim().startsWith("#"))?.trim().slice(0, 180) || "";
  const frontmatter = [
    "---",
    `title: ${meta.title.replace(/\n/g, " ").replace(/"/g, '\\"')}`,
    `created: ${created}`,
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    meta.parent ? `parent: ${slugify(meta.parent)}` : null,
    tags.length ? `tags: ${tags.join(", ")}` : null,
    meta.reference ? `reference: ${meta.reference}` : null,
    meta.referenceLabel ? `referenceLabel: ${meta.referenceLabel}` : null,
    lead ? `lead: ${lead.replace(/"/g, '\\"')}` : null,
    "---",
  ].filter(Boolean).join("\n");
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONTENT_DIR, slug + ".md"), frontmatter + "\n\n" + (content || ""));
  return getArticle(slug);
}

export function getArticle(slug) {
  const a = readFile(slug);
  if (!a) return null;
  a.content = a.content || "";
  a.referenceLabel = a.referenceLabel || "";
  return a;
}

export function listArticles() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFile(f.replace(/\.md$/, "")))
    .filter(Boolean);
}

export function deleteArticle(slug) {
  const p = path.join(CONTENT_DIR, slugify(slug) + ".md");
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function buildTree() {
  const articles = listArticles();
  const map = new Map();
  articles.forEach((a) => map.set(a.slug, { ...a, children: [], depth: 0 }));
  const roots = [];
  articles.forEach((a) => {
    const node = map.get(a.slug);
    const parent = a.parent && map.get(a.parent);
    if (parent) {
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  });
  const sortRec = (nodes) => {
    nodes.sort((a, b) => a.title.localeCompare(b.title));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}