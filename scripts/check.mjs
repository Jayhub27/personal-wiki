import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["server.js"];
for (const dir of ["lib", "public", "scripts", "test"]) {
  for (const file of readdirSync(path.join(root, dir))) {
    if (/\.(js|mjs)$/.test(file)) targets.push(path.join(dir, file));
  }
}

let failed = 0;
for (const rel of targets) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, rel)], { encoding: "utf8" });
  if (result.status !== 0) {
    failed++;
    console.error(result.stderr || result.stdout);
  }
}

if (failed) {
  console.error(`${failed} file(s) failed the syntax check`);
  process.exit(1);
}
console.log(`Syntax OK — ${targets.length} files`);
