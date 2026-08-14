import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["client", "site", "packages"];
const ignoredDirectories = new Set([
  ".astro",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release",
  "test-results",
]);
const testArtifactPattern = /\.(?:test|spec|contract|smoke|visual)\.[cm]?[jt]sx?$/i;
const violations = [];

for (const sourceRoot of sourceRoots) {
  const absoluteRoot = join(repoRoot, sourceRoot);
  if (existsSync(absoluteRoot)) scan(absoluteRoot);
}

if (violations.length > 0) {
  console.error("Test files must live under the repository-level tests/ directory:");
  for (const path of violations.sort()) console.error(`- ${path}`);
  process.exit(1);
}

console.log("test layout ok");

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scan(join(directory, entry.name));
      continue;
    }
    if (entry.isFile() && testArtifactPattern.test(entry.name)) {
      violations.push(relative(repoRoot, join(directory, entry.name)));
    }
  }
}
