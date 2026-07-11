#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "examples");
const target = resolve(root, "public/examples");

if (!existsSync(source)) {
  console.warn("sync-public-examples: examples/ not found, skipping");
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(resolve(root, "public"), { recursive: true });
cpSync(source, target, {
  recursive: true,
  filter: (src) => !src.endsWith(".png") && !src.endsWith(".svg"),
});
console.log("sync-public-examples: copied examples/ → public/examples/");