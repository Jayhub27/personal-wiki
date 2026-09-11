import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { ADAPTER } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
export const BUCKET = process.env.SUPABASE_MEDIA_BUCKET || "media";
export const MEDIA_ADAPTER = (process.env.MEDIA_ADAPTER || (ADAPTER === "supabase" ? "supabase" : "files")).toLowerCase();

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"];
const VIDEO = ["mp4", "webm", "mov", "ogg", "m4v"];
const AUDIO = ["mp3", "wav", "m4a", "flac", "aac"];

export function kindOf(ext) {
  const e = String(ext || "").toLowerCase();
  if (IMAGE.includes(e)) return "image";
  if (VIDEO.includes(e)) return "video";
  if (AUDIO.includes(e)) return "audio";
  return "file";
}

export function safeName(originalname) {
  return `${Date.now()}-${String(originalname).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

function svc() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase media requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

function rowToMedia(row) {
  return {
    name: row.name,
    size: Number(row.size) || 0,
    date: row.created_at || "",
    ext: row.ext || "",
    kind: row.kind || kindOf(row.ext),
    url: `/media/${encodeURIComponent(row.name)}`,
  };
}

export function uploadStorage() {
  if (MEDIA_ADAPTER === "supabase") {
    return multer.memoryStorage();
  }
  return multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, safeName(file.originalname)),
  });
}

export async function listMedia() {
  if (MEDIA_ADAPTER === "supabase") {
    const { url, headers } = svc();
    const r = await fetch(`${url}/rest/v1/media?select=*&order=created_at.desc`, { headers: { ...headers, Accept: "application/json" } });
    if (!r.ok) throw new Error(`media list failed: ${r.status} ${await r.text()}`);
    return (await r.json()).map(rowToMedia);
  }
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  return fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith(".")).map((f) => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, f));
    const ext = path.extname(f).slice(1).toLowerCase();
    return { name: f, size: stat.size, date: stat.mtime.toISOString(), ext, kind: kindOf(ext), url: `/uploads/${f}` };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveMedia(files) {
  if (MEDIA_ADAPTER !== "supabase") return files.map((f) => ({ name: f.filename }));
  const { url, key, headers } = svc();
  const saved = [];
  for (const file of files) {
    const name = safeName(file.originalname);
    const ext = path.extname(name).slice(1).toLowerCase();
    const upload = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": file.mimetype || "application/octet-stream", "x-upsert": "true" },
      body: file.buffer,
    });
    if (!upload.ok) throw new Error(`media upload failed: ${upload.status} ${await upload.text()}`);
    const row = { name, ext, kind: kindOf(ext), size: file.size || file.buffer?.length || 0 };
    const insert = await fetch(`${url}/rest/v1/media`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([row]),
    });
    if (!insert.ok) throw new Error(`media record failed: ${insert.status} ${await insert.text()}`);
    saved.push({ name });
  }
  return saved;
}

export async function removeMedia(name) {
  const safe = path.basename(String(name || ""));
  if (!safe) return;
  if (MEDIA_ADAPTER === "supabase") {
    const { url, headers } = svc();
    await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(safe)}`, { method: "DELETE", headers });
    await fetch(`${url}/rest/v1/media?name=eq.${encodeURIComponent(safe)}`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
    return;
  }
  const target = path.join(UPLOAD_DIR, safe);
  if (target.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(target)) fs.unlinkSync(target);
}

export async function streamMedia(name, res) {
  const safe = path.basename(String(name || ""));
  if (MEDIA_ADAPTER !== "supabase") {
    return res.sendFile(path.join(UPLOAD_DIR, safe));
  }
  const { url, key } = svc();
  const upstream = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(safe)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!upstream.ok) return res.status(upstream.status).send("Media not found");
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  const cache = upstream.headers.get("cache-control");
  if (cache) res.setHeader("Cache-Control", cache);
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.send(buffer);
}
