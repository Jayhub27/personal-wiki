#!/usr/bin/env node
import crypto from "node:crypto";

const password = process.argv[2] || process.env.AUTH_PASSWORD;
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}
console.log(crypto.createHash("sha256").update(String(password)).digest("hex"));
