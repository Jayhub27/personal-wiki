import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CONTENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetherwiki-auth-"));
process.env.STORAGE_ADAPTER = "files";
process.env.AUTH_USERNAME = "admin";
process.env.AUTH_PASSWORD = "hunter2";
process.env.SESSION_SECRET = "test-session-secret";

const app = (await import("../server.js")).default;
const { saveArticle } = await import("../lib/articles.js");

let server;
let base;

before(async () => {
  await saveArticle({ existingSlug: "", meta: { title: "Secret Page" }, content: "classified" });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function getCsrf(pathname = "/login") {
  const res = await fetch(base + pathname, { redirect: "manual" });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie().join("; ") : res.headers.get("set-cookie") || "";
  return raw.match(/aetherwiki_csrf=([^;]+)/)?.[1] || "";
}

test("redirects unauthenticated page requests to /login", async () => {
  const res = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/login/);
});

test("keeps /health public", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test("returns 401 for unauthenticated API calls", async () => {
  const res = await fetch(`${base}/api/search?q=a`, { redirect: "manual" });
  assert.equal(res.status, 401);
});

test("rejects bad credentials", async () => {
  const token = await getCsrf();
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `aetherwiki_csrf=${token}` },
    body: new URLSearchParams({ username: "admin", password: "wrong", _csrf: token }),
    redirect: "manual",
  });
  assert.equal(res.status, 401);
});

test("logs in and serves protected pages", async () => {
  const token = await getCsrf();
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `aetherwiki_csrf=${token}` },
    body: new URLSearchParams({ username: "admin", password: "hunter2", _csrf: token, next: "/secret-page" }),
    redirect: "manual",
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/secret-page");
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie().join("; ") : res.headers.get("set-cookie") || "";
  const session = raw.match(/aetherwiki_session=([^;]+)/)?.[1];
  assert.ok(session);
  const page = await fetch(`${base}/secret-page`, { headers: { Cookie: `aetherwiki_session=${session}` } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /classified/);
});
