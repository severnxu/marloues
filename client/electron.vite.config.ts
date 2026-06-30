import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const __here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
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
    plugins: [react()],
  },
});
