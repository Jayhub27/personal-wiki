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
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ title: "Root Branch", parent: "" }),
    redirect: "manual",
  });
  assert.equal(res.status, 302);
  const created = await getArticle("root-branch");
  assert.ok(created);
  assert.equal(created.title, "Root Branch");
});
