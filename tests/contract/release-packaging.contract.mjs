import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const contractRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(contractRoot, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const clientPackage = JSON.parse(
  readFileSync(join(repositoryRoot, "client", "package.json"), "utf8"),
);
assert(
  clientPackage.build.electronDist === undefined,
  "electron-builder must resolve Electron from the workspace dependency graph",
);

const releaseWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "release.yml"),
  "utf8",
);
assert(
  releaseWorkflow.includes("runner: windows-2022"),
  "Windows installers must build on a runner supported by node-gyp",
);
assert(
  releaseWorkflow.includes("unset CSC_LINK"),
  "empty macOS signing secrets must not be treated as certificate paths",
);
assert(
  clientPackage.build.linux.maintainer.includes("@users.noreply.github.com"),
  "Linux deb metadata must include a maintainer email address",
);
assert(
  releaseWorkflow.includes('--repo "$GITHUB_REPOSITORY"'),
  "Release publishing must not depend on a git checkout for repository discovery",
);

console.log("release packaging contract passed");
