import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CONTENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetherwiki-"));
process.env.STORAGE_ADAPTER = "files";

const app = (await import("../server.js")).default;
const { saveArticle, getArticle } = await import("../lib/articles.js");

let server;
let base;
let csrf = "";
let cookie = "";

before(async () => {
  await saveArticle({
    existingSlug: "",
    meta: { title: "Hello World", tags: "test, guide", reference: "https://example.com/ref", referenceLabel: "Reference" },
    content: "This is the body of the article.",
  });
  await saveArticle({
    existingSlug: "",
    meta: { title: "Unsafe Ref", reference: "javascript:alert(1)" },
    content: "Unsafe reference body.",
  });
  await saveArticle({ existingSlug: "", meta: { title: "Linker" }, content: "See [[Hello World]] and [[Missing Page]]." });
  await saveArticle({
    existingSlug: "",
    meta: { title: "XSS" },
    content: 'Safe text first line.\n\n<script>alert(1)</script><img src="x" onerror="alert(2)">Safe text',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/`);
  const rawCookie = res.headers.getSetCookie ? res.headers.getSetCookie().join("; ") : res.headers.get("set-cookie") || "";
  const csrfMatch = rawCookie.match(/aetherwiki_csrf=([^;]+)/);
  csrf = csrfMatch ? csrfMatch[1] : "";
  cookie = csrf ? `aetherwiki_csrf=${csrf}` : "";
});

after(() => server.close());

test("serves the health endpoint", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.adapter, "files");
});

test("renders the home page with recent articles", async () => {
  const res = await fetch(`${base}/`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(text, /Hello World/);
});

test("renders an article with its reference", async () => {
  const res = await fetch(`${base}/hello-world`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(text, /This is the body/);
  assert.match(text, /https:\/\/example\.com\/ref/);
});

test("strips unsafe javascript: reference URLs", async () => {
  const res = await fetch(`${base}/unsafe-ref`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(text, /javascript:alert/);
});

test("resolves wiki links and red links", async () => {
  const res = await fetch(`${base}/linker`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(text, /href="\/hello-world"/);
  assert.match(text, /Missing Page/);
});

test("exposes the search API", async () => {
  const res = await fetch(`${base}/api/search?q=hello`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body[0].slug, "hello-world");
});

test("finds articles by tag", async () => {
  const res = await fetch(`${base}/tags/test`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(text, /Hello World/);
});

test("creates a root branch via /api/branch", async () => {
  const res = await fetch(`${base}/api/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ title: "Root Branch", parent: "", _csrf: csrf }),
    redirect: "manual",
  });
  assert.equal(res.status, 302);
  const created = await getArticle("root-branch");
  assert.ok(created);
  assert.equal(created.title, "Root Branch");
});

test("rejects mutations without a CSRF token", async () => {
  const res = await fetch(`${base}/api/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ title: "No Token", parent: "" }),
    redirect: "manual",
  });
  assert.equal(res.status, 403);
  assert.equal(await getArticle("no-token"), null);
});

test("sanitizes embedded HTML", async () => {
  const res = await fetch(`${base}/xss`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(text, /<script>alert/);
  assert.doesNotMatch(text, /onerror=/);
  assert.match(text, /Safe text/);
});

test("sets security headers", async () => {
  const res = await fetch(`${base}/`);
  assert.ok(res.headers.get("content-security-policy"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("keeps revisions and restores a previous one", async () => {
  const { saveArticle } = await import("../lib/articles.js");
  await saveArticle({ existingSlug: "", meta: { title: "Versioned" }, content: "version one" });
  await saveArticle({ existingSlug: "versioned", meta: { title: "Versioned" }, content: "version two" });
  const hist = await fetch(`${base}/versioned/history`);
  const histText = await hist.text();
  assert.equal(hist.status, 200);
  const revId = histText.match(/\/versioned\/revision\/(\d+)/)?.[1];
  assert.ok(revId, "expected a revision link");
  const rev = await fetch(`${base}/versioned/revision/${revId}`);
  assert.match(await rev.text(), /version one/);
  const restore = await fetch(`${base}/api/articles/versioned/revisions/${revId}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ _csrf: csrf }),
    redirect: "manual",
  });
  assert.equal(restore.status, 302);
  assert.match(await (await fetch(`${base}/versioned`)).text(), /version one/);
});

test("moves deleted articles to trash and restores them", async () => {
  const { saveArticle } = await import("../lib/articles.js");
  await saveArticle({ existingSlug: "", meta: { title: "Trash Me" }, content: "gone soon" });
  const del = await fetch(`${base}/api/articles/trash-me/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ _csrf: csrf }),
    redirect: "manual",
  });
  assert.equal(del.status, 302);
  const trash = await (await fetch(`${base}/trash`)).text();
  assert.match(trash, /Trash Me/);
  const id = trash.match(/\/api\/trash\/([^/]+)\/restore/)?.[1];
  assert.ok(id, "expected a trash restore link");
  const restore = await fetch(`${base}/api/trash/${id}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ _csrf: csrf }),
    redirect: "manual",
  });
  assert.equal(restore.status, 302);
  assert.match(await (await fetch(`${base}/trash-me`)).text(), /gone soon/);
});
