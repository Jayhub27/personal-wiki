import { searchArticles } from "./search.js";
import { slugify } from "./storage.js";

const apiKey = () => process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const apiUrl = () => {
  if (process.env.AI_API_URL) return process.env.AI_API_URL;
  const base = process.env.OPENAI_BASE_URL;
  if (base) return `${base.replace(/\/+$/, "")}/chat/completions`;
  return "https://api.openai.com/v1/chat/completions";
};
const model = () => process.env.AI_MODEL || "gpt-4o-mini";

export function aiConfigured() {
  return !!apiKey();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function formatAnswer(text, known) {
  return escapeHtml(text)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, name, label) => {
      const slug = slugify(String(name).trim());
      const shown = escapeHtml(label || name.trim());
      return known.has(slug) ? `<a href="/${slug}" class="wikilink">${shown}</a>` : shown;
    })
    .replace(/\n/g, "<br>");
}

export async function askWiki(question, articles) {
  if (!aiConfigured()) return { configured: false };
  const sources = searchArticles(articles, question).slice(0, 6);
  const known = new Set(articles.map((a) => a.slug));
  const context = sources.map((a) => `# ${a.title}\n${(a.content || "").slice(0, 2000)}`).join("\n\n---\n\n");
  const prompt = `You are a helpful assistant for a personal wiki. Answer the question using ONLY the context below. Cite article titles as [[Title]]. If the context does not contain the answer, say so plainly.\n\nContext:\n${context || "(no matching articles)"}\n\nQuestion: ${question}`;

  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model: model(), temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content || "";
  return {
    configured: true,
    answer,
    answerHtml: formatAnswer(answer, known),
    sources: sources.map((a) => ({ slug: a.slug, title: a.title })),
  };
}
