import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["../tests/unit/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": resolve(__here, "renderer/src"),
      "@shared": resolve(__here, "shared"),
    },
  },
});
