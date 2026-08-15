import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const __here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["../tests/vitest-setup.ts"],
    include: [
      "../tests/unit/**/*.test.ts",
      "../tests/unit/**/*.test.tsx",
      "renderer/src/**/*.test.ts",
      "renderer/src/**/*.test.tsx",
    ],
    globals: true,
  },
  resolve: {
    alias: {
      "@": resolve(__here, "renderer/src"),
      "@shared": resolve(__here, "shared"),
    },
  },
});
