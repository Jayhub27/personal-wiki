import { marked } from "marked";
import { slugify } from "./articles.js";

marked.setOptions({ gfm: true, breaks: true });

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractFirstHeading(article) {
  const lines = (article.lead ? "" : (article.content || "")).split(/\r?\n/);
  const h = lines.find((l) => /^#\s/.test(l.trim()));
  return h ? h.replace(/^#\s+/, "") : article.title;
}

export function extractExcerpt(article) {
  const first = (article.content || "").split(/\r?\n+/).find((l) => {
    const t = l.trim();
    return t && !t.startsWith("#") && !t.startsWith("-") && !t.startsWith(">") && !t.startsWith("!") && !t.startsWith("```");
  });
  return (first || "").replace(/[\[\]()#*_>]/g, "").slice(0, 200);
}

function renderWikiLinks(html, tree) {
  const unresolved = [];
  const backlinks = [];
  const known = new Set(tree.map((n) => n.slug));
  const rendered = html.replace(WIKI_LINK_RE, (_m, name, label) => {
    const slug = slugify(name.trim());
    if (known.has(slug)) {
      backlinks.push(slug);
      return `<a href="/${slug}" class="wikilink">${escapeHtml(label || name.trim())}</a>`;
    }
    unresolved.push(name.trim());
    return `<a href="/new?title=${encodeURIComponent(name.trim())}" class="wikilink redlink">${escapeHtml(label || name.trim())}</a>`;
  });
  return { html: rendered, backlinks, unresolved };
}

export function renderMarkdown(article, opts = {}) {
  const tree = opts.tree || [];
  const raw = marked.parse(article.content || "");
  const { html, backlinks, unresolved } = renderWikiLinks(raw, tree);
  const backlinkList = backlinks.map((slug) => tree.find((n) => n.slug === slug)).filter(Boolean);
  return { html, backlinks: backlinkList, unresolved: [...new Set(unresolved)] };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}