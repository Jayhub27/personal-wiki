import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import sanitizeHtml from "sanitize-html";
import { slugify } from "./articles.js";

marked.setOptions({ gfm: true, breaks: true });
marked.use(markedHighlight({
  langPrefix: "hljs language-",
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    try { return hljs.highlight(code, { language }).value; } catch { return ""; }
  },
}));

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
    span: ["class"],
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

export function extractLinks(content) {
  const out = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = re.exec(content || "")) !== null) out.push(slugify(match[1].trim()));
  return out;
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

function buildToc(html) {
  const toc = [];
  const used = new Set();
  const out = html.replace(/<(h2|h3)>([\s\S]*?)<\/\1>/g, (match, tag, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    if (!text) return match;
    const base = slugify(text) || "section";
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    toc.push({ id, text, level: tag === "h2" ? 2 : 3 });
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
  return { html: out, toc };
}

export function renderMarkdown(article, opts = {}) {
  const tree = opts.tree || [];
  const raw = sanitizeHtml(marked.parse(article.content || ""), SANITIZE_OPTIONS);
  const { html, backlinks, unresolved } = renderWikiLinks(raw, tree);
  const { html: finalHtml, toc } = buildToc(html);
  const backlinkList = backlinks.map((slug) => tree.find((n) => n.slug === slug)).filter(Boolean);
  return { html: finalHtml, backlinks: backlinkList, unresolved: [...new Set(unresolved)], toc };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}