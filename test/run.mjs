import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();

let failed = 0;
for (const file of files) {
  console.log(`\n▶ ${file}`);
  const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: "inherit" });
  if (result.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
