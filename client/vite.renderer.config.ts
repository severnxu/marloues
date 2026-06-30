import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__here, "renderer"),
  resolve: {
    alias: {
      "@": resolve(__here, "renderer/src"),
      "@shared": resolve(__here, "shared"),
    },
  },
  plugins: [react()],
});
