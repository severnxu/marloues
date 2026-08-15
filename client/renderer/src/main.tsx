import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/tokens.css";
import "./styles/legacy-tokens.css";
import "./styles/components/index.css";
import App from "./App";
import { UI_BUILD_VERSION } from "@shared/build-info";
import { HOT_UPDATE_PROTOCOL_VERSION } from "@shared/hot-update";
import { initScrollbarActivity } from "./lib/scrollbar-activity";

const platform = window.marloues?.app.platform;
if (platform) {
  document.documentElement.classList.add(`platform-${platform}`);
}

initScrollbarActivity();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void window.marloues.app
  .markRendererReady({
    uiVersion: UI_BUILD_VERSION,
    protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
    capabilities: ["hot-update.ui.v2"],
  })
  .catch(() => undefined);
