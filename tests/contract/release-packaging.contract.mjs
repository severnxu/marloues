import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const contractRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(contractRoot, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readWindowsIconEntries(icon) {
  assert(icon.readUInt16LE(0) === 0, "Windows icon header must be reserved");
  assert(icon.readUInt16LE(2) === 1, "Windows icon must use ICO format");
  const count = icon.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const directoryOffset = 6 + index * 16;
    const width = icon.readUInt8(directoryOffset) || 256;
    const height = icon.readUInt8(directoryOffset + 1) || 256;
    const size = icon.readUInt32LE(directoryOffset + 8);
    const imageOffset = icon.readUInt32LE(directoryOffset + 12);
    const image = icon.subarray(imageOffset, imageOffset + size);
    assert(
      image.length === size,
      `Windows ${width}x${height} icon payload must be complete`,
    );
    assert(
      image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
      `Windows ${width}x${height} icon must use PNG image data`,
    );
    entries.push({ width, height, image });
  }
  return entries;
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
  clientPackage.build.win.icon === "build/icon.ico",
  "Windows packages must use the checked-in multi-size icon",
);
assert(
  releaseWorkflow.includes('--repo "$GITHUB_REPOSITORY"'),
  "Release publishing must not depend on a git checkout for repository discovery",
);

const iconPng = readFileSync(
  join(repositoryRoot, "client", "build", "icon.png"),
);
const windowsIconEntries = readWindowsIconEntries(
  readFileSync(join(repositoryRoot, "client", "build", "icon.ico")),
);
assert(
  windowsIconEntries.map(({ width }) => width).join(",") ===
    "16,32,48,64,128,256",
  "Windows icon must contain 16, 32, 48, 64, 128 and 256px images",
);
for (const { width, height, image } of windowsIconEntries) {
  const expectedPixels = await sharp(iconPng)
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer();
  const actualPixels = await sharp(image).ensureAlpha().raw().toBuffer();
  assert(
    actualPixels.equals(expectedPixels),
    `Windows ${width}x${height} icon must match the current application artwork`,
  );
}

console.log("release packaging contract passed");
