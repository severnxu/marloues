import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preparePagesArtifact } from "../../client/scripts/prepare-hot-update-pages.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(value, status = 200) {
  return new Response(value, { status });
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "marloues-hot-pages-"));
const selectedFeed = join(temporaryRoot, "selected-feed");
mkdirSync(join(selectedFeed, "packages"), { recursive: true });
writeFileSync(
  join(selectedFeed, "manifest.json"),
  JSON.stringify({
    schemaVersion: 1,
    channel: "stable",
    packages: [{ url: "packages/stable.zip" }],
  }),
);
writeFileSync(join(selectedFeed, "manifest.sig"), "stable-signature");
writeFileSync(join(selectedFeed, "packages", "stable.zip"), "stable-package");

const baseUrl = "https://marloues.github.io/marloues/ui/";
const betaManifest = {
  schemaVersion: 1,
  channel: "beta",
  packages: [{ url: "packages/beta.zip" }],
};
const requestedUrls = [];
const fetchExistingChannels = async (input) => {
  const url = String(input);
  requestedUrls.push(url);
  if (url === `${baseUrl}beta/manifest.json`) return jsonResponse(betaManifest);
  if (url === `${baseUrl}beta/manifest.sig`)
    return bytesResponse("beta-signature");
  if (url === `${baseUrl}beta/packages/beta.zip`)
    return bytesResponse("beta-package");
  if (url === `${baseUrl}nightly/manifest.json`)
    return bytesResponse("missing", 404);
  return bytesResponse("unexpected request", 500);
};

const pagesRoot = join(temporaryRoot, "pages");
const result = await preparePagesArtifact({
  channel: "stable",
  feedRoot: selectedFeed,
  outputRoot: pagesRoot,
  baseUrl,
  fetchImpl: fetchExistingChannels,
});

assert(result.selectedChannel === "stable", "selected channel is reported");
assert(
  result.preservedChannels.join(",") === "beta",
  "existing beta feed is preserved and missing nightly feed is skipped",
);
assert(
  readFileSync(
    join(pagesRoot, "ui", "stable", "packages", "stable.zip"),
    "utf8",
  ) === "stable-package",
  "newly built stable package is copied",
);
assert(
  readFileSync(
    join(pagesRoot, "ui", "beta", "packages", "beta.zip"),
    "utf8",
  ) === "beta-package",
  "existing beta package is downloaded",
);
assert(existsSync(join(pagesRoot, ".nojekyll")), "Pages marker is created");
assert(
  requestedUrls.includes(`${baseUrl}nightly/manifest.json`),
  "all unselected channels are checked",
);

let traversalRejected = false;
try {
  await preparePagesArtifact({
    channel: "stable",
    feedRoot: selectedFeed,
    outputRoot: join(temporaryRoot, "traversal-pages"),
    baseUrl,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === `${baseUrl}beta/manifest.json`) {
        return jsonResponse({
          schemaVersion: 1,
          channel: "beta",
          packages: [{ url: "../../outside.zip" }],
        });
      }
      if (url === `${baseUrl}beta/manifest.sig`)
        return bytesResponse("signature");
      if (url === `${baseUrl}nightly/manifest.json`)
        return bytesResponse("missing", 404);
      throw new Error(`Package download should not occur: ${url}`);
    },
  });
} catch (error) {
  traversalRejected = /Unsafe feed path/.test(String(error));
}
assert(traversalRejected, "unsafe package paths are rejected before download");

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "hot-update.yml"),
  "utf8",
);
for (const requiredFragment of [
  "npm run prepare:hot-pages",
  "actions/upload-pages-artifact@v4",
  "actions/deploy-pages@v4",
  "pages: write",
  "id-token: write",
]) {
  assert(
    workflow.includes(requiredFragment),
    `hot-update workflow contains ${requiredFragment}`,
  );
}

console.log(`hot-update Pages contract passed (${temporaryRoot})`);
