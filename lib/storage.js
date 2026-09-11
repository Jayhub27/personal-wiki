import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ADAPTER = (process.env.STORAGE_ADAPTER || "files").toLowerCase();
const ROOT_CONTENT = process.env.CONTENT_DIR || path.join(__dirname, "..", "content");
const REVISIONS_DIR = path.join(ROOT_CONTENT, ".revisions");
const TRASH_DIR = path.join(ROOT_CONTENT, ".trash");
const MAX_REVISIONS = 20;

// ---------------------------------------------------------------------------
// Normalized article shape used by every adapter:
//   { slug, title, content, parent, tags: [], reference, referenceLabel, lead, created, updated }
// ---------------------------------------------------------------------------

/* eslint-disable no-unused-vars */
const adapters = {
  files: {
    name: "files",
    CONTENT_DIR: ROOT_CONTENT,

    async list() {
      if (!fs.existsSync(this.CONTENT_DIR)) return [];
      return fs.readdirSync(this.CONTENT_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => this.fromDisk(f.replace(/\.md$/, "")))
        .filter(Boolean);
    },

    async get(slug) {
      return this.fromDisk(slugify(slug));
    },

    async save(article) {
      const slug = slugify(article.slug);
      const p = path.join(this.CONTENT_DIR, slug + ".md");
      fs.mkdirSync(this.CONTENT_DIR, { recursive: true });
      if (fs.existsSync(p)) this.snapshot(slug, fs.readFileSync(p, "utf8"));
      const frontmatter = [
        "---",
        `title: ${yamlValue(article.title)}`,
        `created: ${article.created}`,
        `updated: ${article.updated}`,
        article.parent ? `parent: ${slugify(article.parent)}` : null,
        article.tags?.length ? `tags: ${article.tags.join(", ")}` : null,
        article.reference ? `reference: ${yamlValue(article.reference)}` : null,
        article.referenceLabel ? `referenceLabel: ${yamlValue(article.referenceLabel)}` : null,
        article.lead ? `lead: ${yamlValue(article.lead)}` : null,
        "---",
      ].filter(Boolean).join("\n");
      fs.writeFileSync(p, frontmatter + "\n\n" + (article.content || ""));
    },

    snapshot(slug, raw) {
      const dir = path.join(REVISIONS_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${Date.now()}.md`), raw);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
      while (files.length > MAX_REVISIONS) {
        const old = files.shift();
        try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
      }
    },

    async remove(slug) {
      const p = path.join(this.CONTENT_DIR, slugify(slug) + ".md");
      if (!fs.existsSync(p)) return;
      fs.mkdirSync(TRASH_DIR, { recursive: true });
      fs.renameSync(p, path.join(TRASH_DIR, `${Date.now()}--${slugify(slug)}.md`));
    },

    async listRevisions(slug) {
      const dir = path.join(REVISIONS_DIR, slugify(slug));
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse().map((f) => ({
        id: f.replace(/\.md$/, ""),
        at: new Date(Number(f.replace(/\.md$/, "")) || 0).toISOString(),
      }));
    },

    async getRevision(slug, id) {
      if (!/^\d+$/.test(String(id))) return null;
      const p = path.join(REVISIONS_DIR, slugify(slug), `${id}.md`);
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, "utf8");
      const meta = parseFrontmatter(raw);
      return { id: String(id), slug: slugify(slug), title: meta.title || slugify(slug), content: meta.content || "", at: new Date(Number(id)).toISOString() };
    },

    async listTrash() {
      if (!fs.existsSync(TRASH_DIR)) return [];
      return fs.readdirSync(TRASH_DIR).filter((f) => f.endsWith(".md")).map((f) => {
        const raw = fs.readFileSync(path.join(TRASH_DIR, f), "utf8");
        const meta = parseFrontmatter(raw);
        const [stamp, ...rest] = f.replace(/\.md$/, "").split("--");
        return { id: f, slug: rest.join("--"), title: meta.title || rest.join("--"), at: new Date(Number(stamp) || 0).toISOString() };
      }).sort((a, b) => b.at.localeCompare(a.at));
    },

    async restoreTrash(id) {
      const name = path.basename(String(id));
      const src = path.join(TRASH_DIR, name);
      if (!src.startsWith(TRASH_DIR + path.sep) || !fs.existsSync(src)) return null;
      const raw = fs.readFileSync(src, "utf8");
      const meta = parseFrontmatter(raw);
      const slug = slugify(meta.title || name.replace(/\.md$/, "").split("--").slice(1).join("--"));
      fs.mkdirSync(this.CONTENT_DIR, { recursive: true });
      fs.writeFileSync(path.join(this.CONTENT_DIR, slug + ".md"), raw);
      fs.unlinkSync(src);
      return this.fromDisk(slug);
    },

    async purgeTrash(id) {
      const name = path.basename(String(id));
      const target = path.join(TRASH_DIR, name);
      if (name && target.startsWith(TRASH_DIR + path.sep) && fs.existsSync(target)) fs.unlinkSync(target);
    },

    fromDisk(slug) {
      const p = path.join(this.CONTENT_DIR, slug + ".md");
      if (!fs.existsSync(p)) return null;
      const meta = parseFrontmatter(fs.readFileSync(p, "utf8"));
      return {
        slug: slugify(slug),
        title: meta.title || slugify(slug),
        content: meta.content || "",
        parent: meta.parent ? slugify(meta.parent) : "",
        tags: meta.tags ? String(meta.tags).split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) : [],
        reference: meta.reference || "",
        referenceLabel: meta.referenceLabel || "",
        lead: meta.lead || "",
        created: meta.created || "",
        updated: meta.updated || "",
      };
    },
  },

  supabase: {
    name: "supabase",

    async init() {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error("STORAGE_ADAPTER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) env vars");
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn("[aetherwiki] SUPABASE_ANON_KEY in use — RLS must allow access. Prefer SUPABASE_SERVICE_ROLE_KEY kept server-side only.");
      }
      this.url = url.replace(/\/+$/, "");
      this.key = key;
    },

    async list() {
      await maybeInit(this);
      const r = await fetch(`${this.url}/rest/v1/articles?select=*`, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`Supabase list failed: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      return rows.map(rowFromSupabase);
    },

    async get(slug) {
      await maybeInit(this);
      const r = await fetch(`${this.url}/rest/v1/articles?select=*&slug=eq.${encodeURIComponent(slugify(slug))}`, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`supabase get failed: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      return rows.length ? rowFromSupabase(rows[0]) : null;
    },

    async save(article) {
      await maybeInit(this);
      const row = rowToSupabase(article);
      const r = await fetch(`${this.url}/rest/v1/articles?on_conflict=slug`, {
        method: "POST",
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([row]),
      });
      if (!r.ok && r.status !== 409 && r.status !== 204) throw new Error(`supabase save failed: ${r.status} ${await r.text()}`);
    },

    async remove(slug) {
      await maybeInit(this);
      const r = await fetch(`${this.url}/rest/v1/articles?slug=eq.${encodeURIComponent(slugify(slug))}`, {
        method: "DELETE",
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, Prefer: "return=minimal" },
      });
      if (!r.ok && r.status !== 204) throw new Error(`supabase remove failed: ${r.status} ${await r.text()}`);
    },
  },

  vercel: {
    name: "vercel",

    // Uses Vercel Postgres via @vercel/postgres.
    async list() {
      const { sql } = await import("@vercel/postgres");
      const rows = await sql`SELECT slug, title, content, parent, reference, referenceLabel, lead, created, updated, array_to_string(tags, ',') as tags FROM articles`;
      return (rows.rows || rows).map(rowFromSupabase);
    },
    async get(slug) {
      const { sql } = await import("@vercel/postgres");
      const rows = await sql`SELECT * FROM articles WHERE slug = ${slugify(slug)} LIMIT 1`;
      return (rows.rows || rows)?.[0] ? rowFromSupabase((rows.rows || rows)[0]) : null;
    },
    async save(article) {
      const { sql } = await import("@vercel/postgres");
      await sql`
        INSERT INTO articles (slug, title, content, parent, reference, reference_label, lead, tags, created_at, updated_at)
        VALUES (${slugify(article.slug)}, ${article.title}, ${article.content}, ${article.parent || null},
                ${article.reference || null}, ${article.referenceLabel || null}, ${article.lead || null},
                ${article.tags?.join(",") || null}, ${article.created || new Date().toISOString().slice(0,10)}, ${new Date().toISOString().slice(0,10)})
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title, content = EXCLUDED.content, parent = EXCLUDED.parent,
          reference = EXCLUDED.reference, reference_label = EXCLUDED.reference_label,
          lead = EXCLUDED.lead, tags = EXCLUDED.tags, updated_at = EXCLUDED.updated_at`;
    },
    async remove(slug) {
      const { sql } = await import("@vercel/postgres");
      await sql`DELETE FROM articles WHERE slug = ${slugify(slug)}`;
    },
  },
};

// Helper: shared pool of env vars on first use
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
      if (m) meta[m[1]] = parseYamlScalar(m[2]);
    }
    meta.content = lines.slice(end + 1).join("\n");
  } else {
    meta.content = raw;
  }
  return meta;
}

function parseYamlScalar(value) {
  const s = String(value ?? "");
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return s;
}

function yamlValue(value) {
  const s = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!s) return '""';
  if (/^[A-Za-z0-9][A-Za-z0-9 _.,|/@()'-]*$/.test(s)) return s;
  return JSON.stringify(s);
}

function rowFromSupabase(r) {
  return {
    slug: slugify(r.slug),
    title: r.title,
    content: r.content || "",
    parent: r.parent ? slugify(r.parent) : "",
    tags: Array.isArray(r.tags) ? r.tags : String(r.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
    reference: r.reference || "",
    referenceLabel: r.reference_label || r.referenceLabel || "",
    lead: r.lead || "",
    created: (r.created || r.created_at || "").slice(0, 10),
    updated: (r.updated || r.updated_at || "").slice(0, 10),
  };
}

function rowToSupabase(a) {
  return {
    slug: slugify(a.slug || a.title),
    title: a.title,
    content: a.content || "",
    parent: a.parent ? slugify(a.parent) : null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    reference: a.reference || null,
    reference_label: a.referenceLabel || null,
    lead: a.lead || null,
    created_at: a.created || new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString().slice(0, 10),
  };
}

async function maybeInit(adapter) {
  if (!adapter._initialized) {
    await adapter.init?.();
    adapter._initialized = true;
  }
}

export function getAdapter() {
  const a = adapters[ADAPTER];
  if (!a) throw new Error(`Unknown STORAGE_ADAPTER "${ADAPTER}". Use "files", "supabase", or "vercel".`);
  return a;
}

// Generic helpers used by server routes
export async function storageList() { return getAdapter().list(); }
export async function storageGet(slug) { return getAdapter().get(slug); }
export async function storageSave(article) { return getAdapter().save(article); }
export async function storageRemove(slug) { return getAdapter().remove(slug); }

export function supportsHistory() { return typeof getAdapter().listRevisions === "function"; }
export function supportsTrash() { return typeof getAdapter().listTrash === "function"; }
export async function listRevisions(slug) { return getAdapter().listRevisions ? getAdapter().listRevisions(slug) : []; }
export async function getRevision(slug, id) { return getAdapter().getRevision ? getAdapter().getRevision(slug, id) : null; }
export async function listTrash() { return getAdapter().listTrash ? getAdapter().listTrash() : []; }
export async function restoreTrash(id) { return getAdapter().restoreTrash ? getAdapter().restoreTrash(id) : null; }
export async function purgeTrash(id) { return getAdapter().purgeTrash ? getAdapter().purgeTrash(id) : null; }

// Full export (portable JSON) — works regardless of adapter
export async function exportData() {
  return { app: "aetherwiki", version: 1, exportedAt: new Date().toISOString(), articles: await storageList() };
}

// Import a portable JSON bundle (upserts each article)
export async function importData(bundle) {
  const rows = Array.isArray(bundle) ? bundle : bundle?.articles;
  if (!Array.isArray(rows)) throw new Error("Invalid import bundle — expected { articles: [...] } or an array.");
  const results = [];
  for (const r of rows) {
    const article = {
      slug: slugify(r.title || r.slug),
      title: r.title || "",
      content: r.content || "",
      parent: r.parent || "",
      tags: Array.isArray(r.tags) ? r.tags : String(r.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      reference: r.reference || "",
      referenceLabel: r.referenceLabel || r.reference_label || "",
      lead: r.lead || "",
      created: r.created ? String(r.created).slice(0, 10) : new Date().toISOString().slice(0, 10),
      updated: r.updated ? String(r.updated).slice(0, 10) : new Date().toISOString().slice(0, 10),
    };
    await storageSave(article);
    results.push(article.slug);
  }
  return results;
}