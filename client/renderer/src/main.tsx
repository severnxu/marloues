import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/workbench-tokens.css";
import "./styles/workbench-shell.css";
import "./styles/workbench-interaction.css";
import { UI_BUILD_VERSION } from "@shared/build-info";
import {
  HOT_UPDATE_CAPABILITY,
  HOT_UPDATE_PROTOCOL_VERSION,
} from "@shared/hot-update";

const platform = window.marloues?.app.platform;
if (platform) {
  document.documentElement.classList.add(`platform-${platform}`);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  void window.marloues.app
    .markRendererReady({
      uiVersion: UI_BUILD_VERSION,
      protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
      capabilities: [HOT_UPDATE_CAPABILITY],
    })
    .catch(() => undefined);
});
