/// <reference types="vite/client" />

import type { MarlouesAPI } from "@shared/types";

declare global {
  interface Window {
    marloues: MarlouesAPI;
  }
}
