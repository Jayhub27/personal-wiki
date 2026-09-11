export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function searchArticles(articles, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const results = [];
  for (const article of articles) {
    const title = (article.title || "").toLowerCase();
    const content = (article.content || "").toLowerCase();
    const tags = (article.tags || []).map((t) => t.toLowerCase());
    let score = 0;
    if (title === q) score += 200;
    if (title.includes(q)) score += 100;
    if (tags.some((t) => t === q)) score += 80;
    else if (tags.some((t) => t.includes(q))) score += 50;
    if (content.includes(q)) score += 20;
    for (const term of terms) {
      if (title.includes(term)) score += 10;
      if (tags.some((t) => t.includes(term))) score += 6;
      if (content.includes(term)) score += 2;
    }
    if (score > 0) results.push({ article, score });
  }
  results.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));
  return results.map((r) => r.article);
}

export function highlight(text, query) {
  const escaped = escapeHtml(text);
  const terms = [...new Set(String(query).toLowerCase().split(/\s+/).filter((t) => t.length >= 2))];
  let out = escaped;
  for (const term of terms) {
    out = out.replace(new RegExp(`(${escapeRegExp(term)})`, "gi"), "<mark>$1</mark>");
  }
  return out;
}

export function matchExcerpt(article, query, length = 190) {
  const plain = (article.content || "").replace(/[#*_>`[\]]/g, " ").replace(/\s+/g, " ").trim();
  const idx = plain.toLowerCase().indexOf(String(query || "").toLowerCase());
  const start = idx > 40 ? idx - 40 : 0;
  const slice = plain.slice(start, start + length).trim();
  return start > 0 ? "…" + slice : slice;
}
