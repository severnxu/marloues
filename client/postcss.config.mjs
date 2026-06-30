import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: resolve(__here, "tailwind.config.ts") },
    autoprefixer: {},
  },
};
