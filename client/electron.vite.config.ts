import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import {
  HOT_UPDATE_CAPABILITY,
  HOT_UPDATE_PROTOCOL_VERSION,
  UI_BUILD_IDENTITY_FILE,
} from "./shared/hot-update";
import uiVersionFile from "./ui-version.json";

const __here = dirname(fileURLToPath(import.meta.url));

function readPublicKeys(): Record<string, string> {
  const configuredPath = process.env.MARLOUES_HOT_UPDATE_PUBLIC_KEYS_FILE;
  const filePath = configuredPath
    ? resolve(configuredPath)
    : resolve(__here, "resources/hot-update-public-keys.json");
  if (!existsSync(filePath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hot-update public keys file must contain a JSON object");
  }
  const keys: Record<string, string> = {};
  for (const [keyId, publicKey] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(keyId)) {
      throw new Error(`Invalid hot-update key id: ${keyId}`);
    }
    if (
      typeof publicKey !== "string" ||
      !publicKey.includes("BEGIN PUBLIC KEY")
    ) {
      throw new Error(`Invalid Ed25519 public key: ${keyId}`);
    }
    keys[keyId] = publicKey;
  }
  return keys;
}

function validateHttpsUrl(value: string, label: string): void {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
}

export default defineConfig(({ command }) => {
  const buildEnv =
    process.env.MARLOUES_BUILD_ENV?.trim() ||
    (command === "serve" ? "development" : "production");
  const clientProvider =
    process.env.MARLOUES_CLIENT_UPDATE_PROVIDER?.trim() === "generic"
      ? "generic"
      : "github";
  const clientUpdateUrl = process.env.MARLOUES_CLIENT_UPDATE_URL?.trim() ?? "";
  const hotUpdateUrl = process.env.MARLOUES_HOT_UPDATE_URL?.trim() ?? "";
  const publicKeys = readPublicKeys();

  validateHttpsUrl(clientUpdateUrl, "Client update URL");
  validateHttpsUrl(hotUpdateUrl, "UI hot-update URL");
  if (clientProvider === "generic" && !clientUpdateUrl) {
    throw new Error(
      "MARLOUES_CLIENT_UPDATE_URL is required for the generic update provider",
    );
  }
  if (
    process.env.MARLOUES_REQUIRE_HOT_UPDATE === "1" &&
    (!hotUpdateUrl || Object.keys(publicKeys).length === 0)
  ) {
    throw new Error(
      "A hot-update URL and at least one trusted public key are required",
    );
  }

  const defineEntries = {
    __MARLOUES_UI_VERSION__: JSON.stringify(uiVersionFile.version),
    __MARLOUES_BUILD_ENV__: JSON.stringify(buildEnv),
    __MARLOUES_CLIENT_UPDATE_PROVIDER__: JSON.stringify(clientProvider),
    __MARLOUES_CLIENT_UPDATE_URL__: JSON.stringify(clientUpdateUrl),
    __MARLOUES_HOT_UPDATE_URL__: JSON.stringify(hotUpdateUrl),
    __MARLOUES_HOT_UPDATE_PUBLIC_KEYS__: JSON.stringify(publicKeys),
  };

  return {
    main: {
      define: defineEntries,
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: resolve(__here, "main/index.ts"),
        },
      },
      resolve: {
        alias: {
          "@shared": resolve(__here, "shared"),
        },
      },
    },
    preload: {
      define: defineEntries,
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: resolve(__here, "preload/index.ts"),
        },
      },
      resolve: {
        alias: {
          "@shared": resolve(__here, "shared"),
        },
      },
    },
    renderer: {
      define: defineEntries,
      root: resolve(__here, "renderer"),
      build: {
        rollupOptions: {
          input: resolve(__here, "renderer/index.html"),
        },
      },
      resolve: {
        alias: {
          "@": resolve(__here, "renderer/src"),
          "@shared": resolve(__here, "shared"),
        },
      },
      plugins: [
        react(),
        {
          name: "marloues-ui-build-identity",
          generateBundle() {
            this.emitFile({
              type: "asset",
              fileName: UI_BUILD_IDENTITY_FILE,
              source: `${JSON.stringify(
                {
                  version: uiVersionFile.version,
                  protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
                  buildEnv,
                  capabilities: [HOT_UPDATE_CAPABILITY],
                },
                null,
                2,
              )}\n`,
            });
          },
        },
      ],
    },
  };
});
