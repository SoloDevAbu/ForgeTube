#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli/index.ts");
const binDir = path.resolve(__dirname, "../node_modules/.bin");

const isWin = process.platform === "win32";
const candidates = isWin
  ? [path.join(binDir, "tsx.exe"), path.join(binDir, "tsx.cmd"), "tsx"]
  : [path.join(binDir, "tsx"), "tsx"];

let executable = "tsx";
for (const c of candidates) {
  if (existsSync(c)) {
    executable = c;
    break;
  }
}

const res = spawnSync(executable, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: isWin && executable === "tsx",
});
process.exit(res.status ?? 0);
