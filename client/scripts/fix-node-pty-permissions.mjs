#!/usr/bin/env node
/**
 * Restores execute permission on node-pty's macOS spawn helper.
 *
 * npm package extraction can leave this bundled executable with mode 0644.
 * node-pty then fails to create every Unix terminal with `posix_spawnp failed`.
 * This is safe to run repeatedly and intentionally skips non-macOS platforms.
 */
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  process.exit(0);
}

const require = createRequire(import.meta.url);
let nodePtyPackagePath;
try {
  nodePtyPackagePath = require.resolve("node-pty/package.json");
} catch {
  console.warn("[fix-node-pty-permissions] node-pty is not installed, skipping.");
  process.exit(0);
}

const helperPath = join(
  dirname(nodePtyPackagePath),
  "prebuilds",
  `darwin-${process.arch}`,
  "spawn-helper",
);

if (!existsSync(helperPath)) {
  console.warn(
    `[fix-node-pty-permissions] node-pty spawn helper not found: ${helperPath}`,
  );
  process.exit(0);
}

const mode = statSync(helperPath).mode;
if ((mode & 0o111) === 0) {
  chmodSync(helperPath, mode | 0o755);
  console.log(`[fix-node-pty-permissions] Made spawn helper executable: ${helperPath}`);
}
