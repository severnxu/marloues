import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/workbench-tokens.css";
import "./styles/workbench-shell.css";
import "./styles/workbench-interaction.css";

const platform = window.marloues?.app.platform;
if (platform) {
  document.documentElement.classList.add(`platform-${platform}`);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
