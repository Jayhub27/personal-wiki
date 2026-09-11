import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { slugify } from "./articles.js";

marked.setOptions({ gfm: true, breaks: true });

const SANITIZE_OPTIONS = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "em", "del", "s",
    "blockquote", "ul", "ol", "li", "a", "img", "code", "pre", "table", "thead", "tbody",
    "tr", "th", "td", "video", "audio", "source", "figure", "figcaption", "span", "sup", "sub", "input",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel", "title"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    video: ["src", "controls", "width", "height", "poster", "preload", "muted", "loop", "playsinline"],
    audio: ["src", "controls", "preload", "loop"],
    source: ["src", "type"],
    input: ["type", "checked", "disabled"],
    code: ["class"],
    pre: ["class"],
    th: ["colspan", "rowspan", "align"],
    td: ["colspan", "rowspan", "align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
};

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
  const raw = sanitizeHtml(marked.parse(article.content || ""), SANITIZE_OPTIONS);
  const { html, backlinks, unresolved } = renderWikiLinks(raw, tree);
  const backlinkList = backlinks.map((slug) => tree.find((n) => n.slug === slug)).filter(Boolean);
  return { html, backlinks: backlinkList, unresolved: [...new Set(unresolved)] };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}