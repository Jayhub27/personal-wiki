import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Set DATABASE_URL, e.g. DATABASE_URL=postgres://user:pass@host:5432/db npm run migrate");
  process.exit(1);
}

let pg;
try {
  pg = await import("pg");
} catch {
  console.error("The migration runner needs the optional 'pg' package: npm install pg");
  process.exit(1);
}

const { Client } = pg.default ?? pg;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const client = new Client({ connectionString: databaseUrl });
await client.connect();
await client.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
const { rows } = await client.query("select name from _migrations");
const applied = new Set(rows.map((r) => r.name));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip    ${file}`);
    continue;
  }
  console.log(`apply   ${file}`);
  await client.query("begin");
  try {
    await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await client.query("insert into _migrations (name) values ($1)", [file]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

await client.end();
console.log("Migrations complete.");
