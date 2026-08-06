import { storageList, storageGet, storageSave, storageRemove, slugify } from "./storage.js";

export { slugify };

const makeLead = (content) =>
  (content || "").split(/\r?\n+/).find((l) => l.trim() && !l.trim().startsWith("#"))?.trim().slice(0, 180) || "";

export async function listArticles() {
  return storageList();
}

export async function getArticle(slug) {
  return storageGet(slug);
}

export async function saveArticle({ existingSlug, meta, content }) {
  const slug = slugify(existingSlug || meta.title);
  const existing = await getArticle(slug);
  const tags = meta.tags ? String(meta.tags).split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) : [];
  const article = {
    slug,
    title: String(meta.title || "").trim(),
    content: content || "",
    parent: meta.parent ? slugify(meta.parent) : "",
    tags,
    reference: meta.reference || "",
    referenceLabel: meta.referenceLabel || "",
    lead: makeLead(content),
    created: existing?.created || meta.created || new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
  };
  await storageSave(article);
  return article;
}

export async function deleteArticle(slug) {
  await storageRemove(slug);
}

export async function buildTree() {
  const articles = await listArticles();
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