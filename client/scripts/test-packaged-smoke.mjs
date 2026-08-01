import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");
const executable = packagedExecutable(clientRoot);

if (!existsSync(executable)) {
  console.error(`Packaged executable not found: ${executable}`);
  process.exit(2);
}

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "--config", "playwright.config.ts", "--project", "packaged"],
  {
    cwd: clientRoot,
    env: { ...process.env, MARLOUES_E2E_EXECUTABLE: executable },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);

function packagedExecutable(root) {
  if (process.platform === "win32") return join(root, "release", "win-unpacked", "Marloues.exe");
  if (process.platform === "darwin") {
    return join(root, "release", "mac", "Marloues.app", "Contents", "MacOS", "Marloues");
  }
  return join(root, "release", "linux-unpacked", "marloues");
}
