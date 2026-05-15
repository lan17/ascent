#!/usr/bin/env node
// Builds the tunnel-shooter Vite app with file://-safe relative paths and
// copies the static output into desktop/dist-web/ for Electron to load.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..");
const webSrcDir = resolve(repoRoot, "artifacts", "tunnel-shooter");
const webOutDir = resolve(webSrcDir, "dist", "public");
const targetDir = resolve(desktopDir, "dist-web");

function run(cmd, args, cwd, env) {
  console.log(`\n$ ${cmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const res = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(`Command failed with exit code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

if (!existsSync(webSrcDir)) {
  console.error(`Could not find tunnel-shooter source at ${webSrcDir}`);
  process.exit(1);
}

// vite.config.ts validates PORT and BASE_PATH at config-load time even for
// `vite build`. PORT is unused for build; BASE_PATH must be "./" so the
// emitted index.html references assets with relative paths (file:// safe).
const buildEnv = { PORT: "1", BASE_PATH: "./", NODE_ENV: "production" };

run("pnpm", ["--filter", "@workspace/tunnel-shooter", "run", "build"], repoRoot, buildEnv);

if (!existsSync(webOutDir)) {
  console.error(`Expected build output at ${webOutDir} but it does not exist.`);
  process.exit(1);
}

if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(webOutDir, targetDir, { recursive: true });

console.log(`\n✓ Web build copied to ${targetDir}`);
