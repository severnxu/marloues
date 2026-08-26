(() => {
  const root = document.documentElement;
  const initialQuery = new URLSearchParams(window.location.search);

  const reviewModeLink = document.querySelector('[data-review="acceptance"]');
  const startButton = document.querySelector('[data-action="finish"]');
  const footerStatus = document.querySelector('[data-footer-status]');
  const trafficClose = document.querySelector('[data-action="close"]');
  const trafficMinimize = document.querySelector('[data-action="minimize"]');
  const trafficZoom = document.querySelector('[data-action="zoom"]');

  const validThemes = ["light", "dark", "warm"];
  const validPlatforms = ["macos", "windows"];

  // Simulated workspace paths so the prototype feels real.
  const samplePaths = [
    "~/Developer/marloues",
    "~/Projects/marloues-workspace",
    "~/Code/marloues",
  ];
  let pathIndex = 0;

  const defaults = {
    platform: validPlatforms.includes(initialQuery.get("platform"))
      ? initialQuery.get("platform")
      : "macos",
    theme: validThemes.includes(initialQuery.get("theme"))
      ? initialQuery.get("theme")
      : "dark",
    selectedWorkspace: initialQuery.get("workspace") === "1",
    configuredModel: initialQuery.get("model") === "1",
    workspacePath: initialQuery.get("workspace") === "1" ? samplePaths[0] : "",
    reviewMode:
      initialQuery.get("review") === "acceptance" ? "acceptance" : "presentation",
  };

  const state = { ...defaults };
  let toastTimer = null;
  let toastElement = null;

  function showToast(message) {
    if (!toastElement) {
      toastElement = document.createElement("div");
      toastElement.className = "prototype-toast";
      toastElement.setAttribute("role", "status");
      toastElement.setAttribute("aria-live", "polite");
      document.body.append(toastElement);
    }
    window.clearTimeout(toastTimer);
    toastElement.textContent = message;
    toastElement.classList.add("is-visible");
    toastTimer = window.setTimeout(
      () => toastElement.classList.remove("is-visible"),
      2400,
    );
  }

  function renderSteps() {
    const workspaceStep = document.querySelector('[data-step="workspace"]');
    const modelStep = document.querySelector('[data-step="model"]');
    const wsIndex = workspaceStep && workspaceStep.querySelector('[data-step-index]');
    const modelIndex = modelStep && modelStep.querySelector('[data-step-index]');
    const wsHint = workspaceStep && workspaceStep.querySelector('[data-step-hint]');
    const modelHint = modelStep && modelStep.querySelector('[data-step-hint]');
    const wsActionLabel = workspaceStep && workspaceStep.querySelector('[data-action-label]');

    // Step 1 — workspace
    if (workspaceStep) {
      workspaceStep.classList.toggle("done", state.selectedWorkspace);
    }
    if (wsIndex) {
      wsIndex.innerHTML = "";
      if (state.selectedWorkspace) {
        wsIndex.textContent = "";
        const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        check.setAttribute("viewBox", "0 0 24 24");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M5 12l5 5L20 7");
        check.append(path);
        wsIndex.append(check);
      } else {
        wsIndex.textContent = "1";
      }
    }
    if (wsHint) {
      if (state.selectedWorkspace && state.workspacePath) {
        wsHint.className = "onboarding-workspace-path";
        wsHint.textContent = state.workspacePath;
      } else {
        wsHint.className = "onboarding-models-hint";
        wsHint.textContent = "Agent 会在该目录下读写文件、运行命令。";
      }
    }
    if (wsActionLabel) {
      wsActionLabel.textContent = state.selectedWorkspace ? "更换文件夹" : "打开文件夹";
    }

    // Step 2 — model
    if (modelStep) {
      modelStep.classList.toggle("done", state.configuredModel);
    }
    if (modelIndex) {
      modelIndex.innerHTML = "";
      if (state.configuredModel) {
        const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        check.setAttribute("viewBox", "0 0 24 24");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M5 12l5 5L20 7");
        check.append(path);
        modelIndex.append(check);
      } else {
        modelIndex.textContent = "2";
      }
    }
    if (modelHint) {
      modelHint.textContent = state.configuredModel
        ? "模型端点已配置，随时可在设置中调整。"
        : "尚未配置模型端点，可在「设置 → 模型端点」中完成。";
    }

    // Footer + start button
    const canStart = state.selectedWorkspace;
    if (footerStatus) {
      footerStatus.textContent = state.selectedWorkspace
        ? "工作区已就绪"
        : "请先选择工作区";
    }
    if (startButton) {
      startButton.disabled = !canStart;
    }
  }

  function render() {
    root.dataset.platform = state.platform;
    root.dataset.theme = state.theme;
    root.dataset.reviewMode = state.reviewMode;

    document
      .querySelectorAll(".segment-button[data-platform]")
      .forEach((button) => {
        button.classList.toggle(
          "is-active",
          button.dataset.platform === state.platform,
        );
      });
    document
      .querySelectorAll(".segment-button[data-theme]")
      .forEach((button) => {
        button.classList.toggle(
          "is-active",
          button.dataset.theme === state.theme,
        );
      });

    const reviewing = state.reviewMode === "acceptance";
    if (reviewModeLink) {
      reviewModeLink.classList.toggle("is-active", reviewing);
      reviewModeLink.textContent = reviewing ? "退出验收" : "像素验收";
    }

    renderSteps();
    syncUrl();
  }

  function syncUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("platform", state.platform);
      url.searchParams.set("theme", state.theme);
      url.searchParams.set("workspace", state.selectedWorkspace ? "1" : "0");
      url.searchParams.set("model", state.configuredModel ? "1" : "0");
      if (state.reviewMode === "acceptance")
        url.searchParams.set("review", "acceptance");
      else url.searchParams.delete("review");
      window.history.replaceState(null, "", url);
    } catch {
      /* file:// may not support history state — prototype still works. */
    }
  }

  function setPlatform(platform) {
    if (!validPlatforms.includes(platform)) return;
    state.platform = platform;
    render();
    showToast(
      `已切换为 ${platform === "macos" ? "macOS" : "Windows"} 窗口模式`,
    );
  }

  function setTheme(theme) {
    if (!validThemes.includes(theme)) return;
    state.theme = theme;
    render();
  }

  function selectWorkspace() {
    state.selectedWorkspace = true;
    state.workspacePath = samplePaths[pathIndex % samplePaths.length];
    pathIndex += 1;
    render();
    showToast(`工作区已设为 ${state.workspacePath}`);
  }

  function skipModel() {
    state.configuredModel = true;
    render();
    showToast("模型端点可稍后在设置中配置");
  }

  function openSettings() {
    state.configuredModel = true;
    render();
    showToast("已前往设置 → 模型端点（交互演示）");
  }

  function finish() {
    if (!state.selectedWorkspace) return;
    showToast("引导完成，即将进入工作台");
    window.setTimeout(() => {
      window.location.href = "../workbench-prototype/index.html";
    }, 600);
  }

  function toggleReviewMode() {
    state.reviewMode =
      state.reviewMode === "acceptance" ? "presentation" : "acceptance";
    render();
    if (state.reviewMode === "acceptance")
      showToast("已进入像素验收模式，按 Esc 退出");
  }

  document.addEventListener("click", (event) => {
    const platformButton = event.target.closest(
      ".segment-button[data-platform]",
    );
    if (platformButton) {
      setPlatform(platformButton.dataset.platform);
      return;
    }

    const themeButton = event.target.closest(".segment-button[data-theme]");
    if (themeButton) {
      setTheme(themeButton.dataset.theme);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
      const name = action.dataset.action;
      switch (name) {
        case "open-folder":
          selectWorkspace();
          break;
        case "skip-model":
          skipModel();
          break;
        case "open-settings":
          openSettings();
          break;
        case "finish":
          finish();
          break;
        case "close":
          showToast("窗口已关闭（交互演示）");
          break;
        case "minimize":
          showToast("窗口已最小化（交互演示）");
          break;
        case "zoom":
          showToast("窗口已缩放（交互演示）");
          break;
      }
      return;
    }

    const reviewLink = event.target.closest('[data-review="acceptance"]');
    if (reviewLink) {
      event.preventDefault();
      toggleReviewMode();
    }
  });

  window.addEventListener("keydown", (event) => {
    // ⌘O / Ctrl+O — open folder
    if (
      (event.metaKey || event.ctrlKey) &&
      (event.key === "o" || event.key === "O")
    ) {
      event.preventDefault();
      selectWorkspace();
      return;
    }

    if (event.key === "Escape") {
      if (state.reviewMode === "acceptance") {
        state.reviewMode = "presentation";
        render();
        showToast("已返回交互稿展示模式");
      }
      return;
    }

    if (event.key === "Enter" && state.selectedWorkspace) {
      finish();
    }
  });

  render();
})();
