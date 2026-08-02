(() => {
  const root = document.documentElement;
  const initialQuery = new URLSearchParams(window.location.search);
  const readPixelQuery = (name, fallback, min, max) => {
    const parsed = Number.parseFloat(initialQuery.get(name) ?? "");
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
  };
  const initialAuxiliaryState = initialQuery.get("auxiliary");
  const appWindow = document.getElementById("app-window");
  const workbench = document.getElementById("workbench");
  const workspaceHeader = document.querySelector(".workspace-header");
  const titleTrailing = document.querySelector(".title-trailing");
  const windowsAuxiliaryPrimaryAction = titleTrailing.querySelector(
    '[data-role="windows-auxiliary-primary-action"]',
  );
  const runtimeStatus = document.getElementById("runtime-status");
  const primarySidebar = document.getElementById("primary-sidebar");
  const mainWorkspace = document.getElementById("main-workspace");
  const auxiliarySidebar = document.getElementById("auxiliary-sidebar");
  const collapsedContextAction = document.querySelector(
    '[data-role="collapsed-context-action"]',
  );
  const searchOverlay = document.getElementById("search-overlay");
  const searchInput = document.getElementById("search-input");
  const composer = document.getElementById("composer");
  const composerInput = document.getElementById("composer-input");
  const composerAttachments = document.getElementById("composer-attachments");
  const interactionDock = document.getElementById("interaction-dock");
  const inputInteractionStack = document.getElementById(
    "input-interaction-stack",
  );
  const taskResultSummary = document.getElementById("task-result-summary");
  const steerQueue = document.getElementById("steer-queue");
  const steerQueueSummary = document.getElementById("steer-queue-summary");
  const steerList = document.getElementById("steer-list");
  const permissionRequestPanel = document.getElementById(
    "permission-request-panel",
  );
  const conversationScroll = document.getElementById("conversation-scroll");
  const toast = document.getElementById("prototype-toast");
  const reviewModeButton = document.querySelector(
    '[data-action="toggle-review-mode"]',
  );

  const sampleAttachments = [
    {
      id: "sample-image",
      kind: "image",
      name: "工作台参考.png",
      meta: "PNG · 1.2 MB",
      src: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%232f6075'/%3E%3Cstop offset='1' stop-color='%23c77b5c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='120' height='120' rx='16' fill='url(%23g)'/%3E%3Ccircle cx='88' cy='32' r='13' fill='%23f6d58a'/%3E%3Cpath d='M0 96 35 61l22 20 16-14 47 39v14H0Z' fill='%23d9e4de' fill-opacity='.82'/%3E%3C/svg%3E",
    },
    { id: "sample-file", kind: "file", name: ".env.example", meta: "EXAMPLE" },
  ];

  const defaults = {
    platform: initialQuery.get("platform") === "windows" ? "windows" : "macos",
    theme: initialQuery.get("theme") === "light" ? "light" : "dark",
    reviewMode:
      initialQuery.get("review") === "acceptance"
        ? "acceptance"
        : "presentation",
    primaryOpen: initialQuery.get("primary") !== "collapsed",
    auxiliaryOpen: initialAuxiliaryState !== "closed",
    primaryPeeking: false,
    auxiliaryPrimary: initialAuxiliaryState === "primary-overlay",
    primaryWidth: readPixelQuery("primaryWidth", 275, 275, 480),
    auxiliaryWidth: readPixelQuery("auxiliaryWidth", 319, 319, 500),
    maximized: initialQuery.get("window") === "maximized",
    permissionPending: false,
    resultSummaryVisible: true,
    attachments: sampleAttachments.map((item) => ({ ...item })),
    steerItems: [],
  };

  const state = { ...defaults };
  let resizeTarget = null;
  let peekTimer = null;
  let toastTimer = null;
  let auxiliaryTransitionTimer = null;
  let auxiliaryTransitioning = false;
  let steerSequence = 0;
  let draggedSteerId = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function updateShortcuts() {
    const mac = state.platform === "macos";
    document.querySelectorAll('[data-shortcut="new"]').forEach((element) => {
      element.textContent = mac ? "⌘N" : "Ctrl+N";
    });
    document.querySelectorAll('[data-shortcut="search"]').forEach((element) => {
      element.textContent = mac ? "⌘K" : "Ctrl+K";
    });
  }

  function createSteerButton(label, action, steerId, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.dataset.steerId = steerId;
    button.textContent = label;
    return button;
  }

  function renderAttachments() {
    const items = state.attachments;
    composerAttachments.hidden = items.length === 0;
    composer.classList.toggle("has-attachments", items.length > 0);
    document
      .querySelectorAll('[data-action="toggle-sample-attachments"]')
      .forEach((button) => {
        button.classList.toggle("is-active", items.length > 0);
        button.setAttribute("aria-pressed", String(items.length > 0));
      });
    composerAttachments.replaceChildren();

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = `composer-attachment is-${item.kind}`;
      card.dataset.attachmentId = item.id;

      if (item.kind === "image") {
        const image = document.createElement("img");
        image.src = item.src;
        image.alt = item.name;
        card.append(image);
      } else {
        const icon = document.createElement("span");
        icon.className = "attachment-file-icon";
        icon.innerHTML = '<svg aria-hidden="true"><use href="#i-file" /></svg>';
        const copy = document.createElement("span");
        copy.className = "attachment-file-copy";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const meta = document.createElement("small");
        meta.textContent = item.meta;
        copy.append(name, meta);
        card.append(icon, copy);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "attachment-remove";
      remove.dataset.action = "remove-attachment";
      remove.dataset.attachmentId = item.id;
      remove.setAttribute("aria-label", `移除附件 ${item.name}`);
      remove.textContent = "×";
      card.append(remove);
      composerAttachments.append(card);
    });
  }

  function renderSteerQueue() {
    const items = state.steerItems;
    const hasSteers = items.length > 0;
    steerQueue.hidden = !hasSteers;
    interactionDock.classList.toggle("has-steers", hasSteers);
    steerQueue.classList.toggle("is-multiple", items.length > 1);
    steerQueueSummary.hidden = items.length < 2;
    steerQueueSummary.textContent = `${items.length} 条等待引导 · 拖动可调整顺序`;
    steerList.replaceChildren();

    items.forEach((item) => {
      const row = document.createElement("article");
      row.className = "steer-row";
      row.draggable = true;
      row.dataset.steerId = item.id;

      const dragHandle = createSteerButton(
        "⠿",
        "drag-steer",
        item.id,
        "steer-drag-handle",
      );
      dragHandle.setAttribute("aria-label", "拖动调整引导顺序");
      dragHandle.title = "拖动调整顺序";

      const copy = document.createElement("span");
      copy.className = "steer-text";
      copy.textContent = item.text;

      const actions = document.createElement("div");
      actions.className = "steer-actions";
      const steerNow = createSteerButton(
        "引导",
        "send-steer-now",
        item.id,
        "steer-now",
      );
      steerNow.title = "立即引导，不中断当前运行";
      const remove = createSteerButton("×", "remove-steer", item.id);
      remove.setAttribute("aria-label", "删除这条引导");
      const edit = createSteerButton("…", "edit-steer", item.id);
      edit.setAttribute("aria-label", "编辑这条引导");
      edit.title = "编辑引导";
      actions.append(steerNow, remove, edit);
      row.append(dragHandle, copy, actions);
      steerList.append(row);
    });
  }

  function render() {
    root.dataset.platform = state.platform;
    root.dataset.theme = state.theme;
    root.dataset.reviewMode = state.reviewMode;
    if (state.platform === "windows") {
      titleTrailing.insertBefore(runtimeStatus, windowsAuxiliaryPrimaryAction);
    } else {
      workspaceHeader.append(runtimeStatus);
    }
    runtimeStatus.hidden = state.auxiliaryPrimary;
    runtimeStatus.setAttribute("aria-hidden", String(state.auxiliaryPrimary));
    appWindow.style.setProperty(
      "--primary-sidebar-width",
      `${state.primaryWidth}px`,
    );
    appWindow.style.setProperty(
      "--auxiliary-sidebar-width",
      `${state.auxiliaryWidth}px`,
    );
    appWindow.classList.toggle("is-primary-collapsed", !state.primaryOpen);
    renderPrimaryPeekState();
    appWindow.classList.toggle("is-auxiliary-collapsed", !state.auxiliaryOpen);
    appWindow.classList.toggle("is-auxiliary-primary", state.auxiliaryPrimary);
    appWindow.classList.toggle("is-maximized", state.maximized);
    mainWorkspace.inert = state.auxiliaryPrimary;
    mainWorkspace.setAttribute("aria-hidden", String(state.auxiliaryPrimary));
    auxiliarySidebar.inert = !state.auxiliaryOpen || auxiliaryTransitioning;
    auxiliarySidebar.setAttribute("aria-hidden", String(!state.auxiliaryOpen));
    permissionRequestPanel.hidden = !state.permissionPending;
    inputInteractionStack.hidden = state.permissionPending;
    taskResultSummary.hidden = !state.resultSummaryVisible;
    document
      .querySelectorAll('[data-action="toggle-result-summary"]')
      .forEach((button) => {
        button.classList.toggle("is-active", state.resultSummaryVisible);
        button.setAttribute("aria-pressed", String(state.resultSummaryVisible));
      });
    renderAttachments();
    renderSteerQueue();

    document
      .querySelectorAll('[data-action="toggle-auxiliary"]')
      .forEach((button) => {
        const auxiliaryVisible = state.auxiliaryOpen;
        const label = state.auxiliaryPrimary
          ? "关闭辅助区并返回主视图"
          : auxiliaryVisible
            ? "收起右侧辅助区"
            : "展开右侧辅助区";
        button.classList.toggle("is-active", auxiliaryVisible);
        button.setAttribute("aria-pressed", String(auxiliaryVisible));
        button.setAttribute("aria-label", label);
        button.title = label;
      });

    document
      .querySelectorAll('[data-action="toggle-aux-primary"]')
      .forEach((button) => {
        const label = state.auxiliaryPrimary
          ? "收回辅助区至右栏"
          : "展开辅助区至主视图区";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.disabled = auxiliaryTransitioning;
        button
          .querySelector("use")
          ?.setAttribute(
            "href",
            state.auxiliaryPrimary ? "#i-contract" : "#i-expand",
          );
      });
    auxiliarySidebar.setAttribute("aria-busy", String(auxiliaryTransitioning));

    document
      .querySelectorAll('[data-action="toggle-primary"]')
      .forEach((button) => {
        const label = state.primaryOpen
          ? "收起左侧边栏"
          : state.auxiliaryPrimary
            ? "展开左侧边栏，辅助区保持当前页面"
            : "展开左侧边栏";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.setAttribute("aria-pressed", String(state.primaryOpen));
      });

    if (state.auxiliaryPrimary) {
      collapsedContextAction.dataset.action = "return-main";
      collapsedContextAction.setAttribute("aria-label", "返回主视图");
      collapsedContextAction.title = "返回主视图";
      collapsedContextAction
        .querySelector("use")
        ?.setAttribute("href", "#i-back");
    } else {
      collapsedContextAction.dataset.action = "new-thread";
      collapsedContextAction.setAttribute("aria-label", "新建会话");
      collapsedContextAction.title = "新建会话";
      collapsedContextAction
        .querySelector("use")
        ?.setAttribute("href", "#i-compose");
    }

    document.querySelectorAll("[data-set-platform]").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.setPlatform === state.platform,
      );
    });
    document.querySelectorAll("[data-set-theme]").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.setTheme === state.theme,
      );
    });

    const reviewingPixels = state.reviewMode === "acceptance";
    reviewModeButton.classList.toggle("is-active", reviewingPixels);
    reviewModeButton.setAttribute("aria-pressed", String(reviewingPixels));
    reviewModeButton.textContent = reviewingPixels ? "返回展示" : "像素验收";
    reviewModeButton.title = reviewingPixels
      ? "按 Esc 返回交互稿展示模式"
      : "隐藏演示画布，只显示 Renderer 客户区";

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("platform", state.platform);
      url.searchParams.set("theme", state.theme);
      url.searchParams.set(
        "primary",
        state.primaryOpen ? "expanded" : "collapsed",
      );
      url.searchParams.set(
        "auxiliary",
        state.auxiliaryPrimary
          ? "primary-overlay"
          : state.auxiliaryOpen
            ? "open"
            : "closed",
      );
      url.searchParams.set("primaryWidth", String(state.primaryWidth));
      url.searchParams.set("auxiliaryWidth", String(state.auxiliaryWidth));
      url.searchParams.set(
        "window",
        state.maximized ? "maximized" : "restored",
      );
      if (reviewingPixels) url.searchParams.set("review", "acceptance");
      else url.searchParams.delete("review");
      window.history.replaceState(null, "", url);
    } catch {
      // file:// 环境不支持历史状态时，不影响原型交互与像素验收。
    }

    updateShortcuts();
  }

  /* Peek 只更新覆盖层自身，不触发附件、steer 或消息区的全量重建。 */
  function renderPrimaryPeekState() {
    appWindow.classList.toggle("is-primary-peeking", state.primaryPeeking);
    const primaryUnavailable = !state.primaryOpen && !state.primaryPeeking;
    primarySidebar.inert = primaryUnavailable;
    primarySidebar.setAttribute("aria-hidden", String(primaryUnavailable));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(
      () => toast.classList.remove("is-visible"),
      2200,
    );
  }

  function openSearch() {
    searchOverlay.classList.add("is-open");
    searchOverlay.setAttribute("aria-hidden", "false");
    window.setTimeout(() => searchInput.focus(), 0);
  }

  function closeSearch() {
    searchOverlay.classList.remove("is-open");
    searchOverlay.setAttribute("aria-hidden", "true");
  }

  function togglePrimary() {
    state.primaryOpen = !state.primaryOpen;
    state.primaryPeeking = false;
    if (state.primaryOpen)
      state.primaryWidth = Math.max(275, state.primaryWidth);
    render();
  }

  function toggleAuxiliary() {
    if (auxiliaryTransitioning) return;
    if (state.auxiliaryPrimary) {
      transitionAuxiliaryPrimary(false, {
        closeAfter: true,
        message: "辅助区已关闭，返回主视图",
      });
      return;
    } else {
      state.auxiliaryOpen = !state.auxiliaryOpen;
      if (state.auxiliaryOpen)
        state.auxiliaryWidth = Math.max(319, state.auxiliaryWidth);
    }
    render();
  }

  function transitionAuxiliaryPrimary(nextPrimary, options = {}) {
    if (auxiliaryTransitioning) return;
    const { closeAfter = false, message = "", onComplete = null } = options;
    state.auxiliaryOpen = true;

    if (
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      state.auxiliaryPrimary = nextPrimary;
      if (closeAfter) state.auxiliaryOpen = false;
      render();
      onComplete?.();
      if (message) showToast(message);
      return;
    }

    auxiliaryTransitioning = true;
    appWindow.classList.add("is-auxiliary-switching");
    render();

    auxiliaryTransitionTimer = window.setTimeout(() => {
      state.auxiliaryPrimary = nextPrimary;
      if (closeAfter) state.auxiliaryOpen = false;
      render();

      auxiliaryTransitionTimer = window.setTimeout(() => {
        appWindow.classList.remove("is-auxiliary-switching");
        auxiliaryTransitioning = false;
        auxiliaryTransitionTimer = null;
        render();
        onComplete?.();
        if (message) showToast(message);
      }, 140);
    }, 140);
  }

  function toggleAuxiliaryPrimary() {
    const enteringPrimary = !state.auxiliaryPrimary;
    transitionAuxiliaryPrimary(enteringPrimary, {
      message: enteringPrimary
        ? "辅助区已覆盖主视图区，文字在新位置重新出现"
        : "辅助区已收回至右栏，主视图区状态保持不变",
    });
  }

  function returnToMain() {
    if (!state.auxiliaryPrimary) return;
    transitionAuxiliaryPrimary(false, {
      message: "已返回主视图，辅助区恢复为右栏",
    });
  }

  function setAuxiliaryTab(tab) {
    document.querySelectorAll("[data-aux-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.auxTab === tab);
      button.setAttribute(
        "aria-selected",
        String(button.dataset.auxTab === tab),
      );
    });
    document.querySelectorAll("[data-aux-panel]").forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.dataset.auxPanel !== tab);
    });
  }

  function reviewFile() {
    state.auxiliaryOpen = true;
    render();
    setAuxiliaryTab("changes");
    showToast("已在右侧辅助区打开文件变更");
  }

  function resetLayout() {
    window.clearTimeout(auxiliaryTransitionTimer);
    auxiliaryTransitionTimer = null;
    auxiliaryTransitioning = false;
    appWindow.classList.remove("is-auxiliary-switching");
    Object.assign(state, defaults);
    state.steerItems = [];
    state.attachments = sampleAttachments.map((item) => ({ ...item }));
    setAuxiliaryTab("files");
    closeSearch();
    render();
    showToast("布局与平台状态已重置");
  }

  function newThread() {
    document
      .querySelectorAll(".thread-row")
      .forEach((row) => row.classList.remove("is-active"));
    composerInput.value = "";
    composerInput.focus();
    showToast("已创建新会话，输入框已聚焦");
  }

  function handleAction(action, actionElement) {
    if (action === "toggle-primary") togglePrimary();
    if (action === "toggle-auxiliary") toggleAuxiliary();
    if (action === "toggle-aux-primary") toggleAuxiliaryPrimary();
    if (action === "return-main") returnToMain();
    if (action === "open-search") openSearch();
    if (action === "new-thread") newThread();
    if (action === "review-file") reviewFile();
    if (action === "toggle-result-summary") {
      state.resultSummaryVisible = !state.resultSummaryVisible;
      render();
      showToast(
        state.resultSummaryVisible
          ? "已显示任务结果摘要"
          : "已隐藏任务结果摘要",
      );
    }
    if (action === "toggle-sample-attachments") {
      state.attachments = state.attachments.length
        ? []
        : sampleAttachments.map((item) => ({ ...item }));
      render();
      showToast(
        state.attachments.length ? "已显示图片与文件附件" : "已清空附件",
      );
    }
    if (action === "add-attachment") {
      const nextIndex = state.attachments.length + 1;
      state.attachments.push({
        id: `attachment-${Date.now()}`,
        kind: "file",
        name: `需求说明-${nextIndex}.pdf`,
        meta: "PDF · 680 KB",
      });
      render();
      showToast("已添加示例文件");
    }
    if (action === "remove-attachment") {
      state.attachments = state.attachments.filter(
        (item) => item.id !== actionElement.dataset.attachmentId,
      );
      render();
      showToast("已移除附件");
    }
    if (action === "show-permission-request") {
      state.permissionPending = true;
      render();
      permissionRequestPanel.querySelector(".permission-allow").focus();
      showToast("任务正在等待权限确认");
    }
    if (action === "deny-permission") {
      state.permissionPending = false;
      render();
      composerInput.focus();
      showToast("已拒绝本次工具调用");
    }
    if (action === "allow-permission") {
      state.permissionPending = false;
      render();
      composerInput.focus();
      showToast("已授权，任务继续执行");
    }
    if (action === "send-steer-now") {
      const index = state.steerItems.findIndex(
        (item) => item.id === actionElement.dataset.steerId,
      );
      if (index >= 0) {
        state.steerItems.splice(index, 1);
        render();
        showToast("已立即发送这条引导，当前运行不中断");
      }
    }
    if (action === "remove-steer") {
      state.steerItems = state.steerItems.filter(
        (item) => item.id !== actionElement.dataset.steerId,
      );
      render();
      showToast("已从引导队列移除");
    }
    if (action === "edit-steer") {
      const item = state.steerItems.find(
        (entry) => entry.id === actionElement.dataset.steerId,
      );
      if (item) {
        composerInput.value = item.text;
        state.steerItems = state.steerItems.filter(
          (entry) => entry.id !== item.id,
        );
        state.permissionPending = false;
        render();
        composerInput.focus();
        showToast("已取回输入框编辑");
      }
    }
    if (action === "toggle-review-mode") {
      state.reviewMode =
        state.reviewMode === "acceptance" ? "presentation" : "acceptance";
      render();
    }
    if (action === "reset") resetLayout();
  }

  document.addEventListener("click", (event) => {
    const platformButton = event.target.closest("[data-set-platform]");
    if (platformButton) {
      state.platform = platformButton.dataset.setPlatform;
      render();
      showToast(
        `已切换为 ${state.platform === "macos" ? "macOS" : "Windows"} 窗口模式`,
      );
      return;
    }

    const themeButton = event.target.closest("[data-set-theme]");
    if (themeButton) {
      state.theme = themeButton.dataset.setTheme;
      render();
      return;
    }

    const actionElement = event.target.closest("[data-action]");
    if (actionElement) {
      const action = actionElement.dataset.action;
      if (action === "toggle-activity") {
        actionElement.classList.toggle("is-open");
        return;
      }
      if (action === "toggle-workspace") {
        actionElement
          .closest(".workspace-item")
          .classList.toggle("is-expanded");
        return;
      }
      handleAction(action, actionElement);
      return;
    }

    const auxTab = event.target.closest("[data-aux-tab]");
    if (auxTab) {
      setAuxiliaryTab(auxTab.dataset.auxTab);
      return;
    }

    const windowAction = event.target.closest("[data-window-action]");
    if (windowAction) {
      if (windowAction.dataset.windowAction === "maximize") {
        state.maximized = !state.maximized;
        render();
      }
      if (windowAction.dataset.windowAction === "minimize") {
        showToast("窗口已最小化（交互演示）");
      }
      if (windowAction.dataset.windowAction === "close") {
        showToast("Windows：窗口已隐藏到系统托盘，应用继续运行");
      }
      return;
    }

    if (event.target === searchOverlay) closeSearch();
  });

  appWindow
    .querySelector(".traffic-light.is-close")
    .addEventListener("click", () => {
      showToast("macOS：已关闭当前窗口，应用保留在 Dock");
    });
  appWindow
    .querySelector(".traffic-light.is-minimize")
    .addEventListener("click", () => {
      showToast("macOS：窗口已最小化（交互演示）");
    });
  appWindow
    .querySelector(".traffic-light.is-zoom")
    .addEventListener("click", () => {
      state.maximized = !state.maximized;
      render();
    });

  appWindow.addEventListener("dblclick", (event) => {
    if (state.platform !== "windows") return;
    const windowRect = appWindow.getBoundingClientRect();
    const titlebarHeight = Number.parseFloat(
      getComputedStyle(appWindow).getPropertyValue("--titlebar-height"),
    );
    const withinTitleTrack = event.clientY - windowRect.top <= titlebarHeight;
    const insideControlIsland = event.target.closest(
      "button, .title-leading, .title-trailing, .windows-caption-controls",
    );
    if (!withinTitleTrack || insideControlIsland) return;
    state.maximized = !state.maximized;
    render();
  });

  function startResize(target, event) {
    if (target === "auxiliary" && state.auxiliaryPrimary) return;
    resizeTarget = target;
    appWindow.classList.add("is-resizing");
    event.currentTarget.classList.add("is-active");
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic prototype tests do not create an active browser pointer.
    }
    event.preventDefault();
  }

  document
    .querySelector(".primary-resize")
    .addEventListener("pointerdown", (event) => startResize("primary", event));
  document
    .querySelector(".auxiliary-resize")
    .addEventListener("pointerdown", (event) =>
      startResize("auxiliary", event),
    );

  window.addEventListener("pointermove", (event) => {
    if (!resizeTarget) return;
    const rect = workbench.getBoundingClientRect();
    const primarySpace = state.primaryOpen ? state.primaryWidth : 0;
    if (resizeTarget === "primary") {
      const proposed = event.clientX - rect.left;
      if (proposed < 220) {
        state.primaryOpen = false;
        state.primaryWidth = 275;
        finishResize();
        render();
        return;
      }
      const auxSpace = state.auxiliaryOpen ? state.auxiliaryWidth : 0;
      const dynamicMax = rect.width - auxSpace - 400;
      state.primaryWidth = clamp(proposed, 275, Math.min(480, dynamicMax));
      state.primaryOpen = true;
      render();
    }
    if (resizeTarget === "auxiliary") {
      const proposed = rect.right - event.clientX;
      if (proposed < 220) {
        state.auxiliaryOpen = false;
        state.auxiliaryWidth = 319;
        finishResize();
        render();
        return;
      }
      const dynamicMax = rect.width - primarySpace - 400;
      state.auxiliaryWidth = clamp(proposed, 319, Math.min(500, dynamicMax));
      state.auxiliaryOpen = true;
      render();
    }
  });

  function finishResize() {
    resizeTarget = null;
    appWindow.classList.remove("is-resizing");
    document
      .querySelectorAll(".column-resize-handle")
      .forEach((handle) => handle.classList.remove("is-active"));
  }

  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);

  const peekZone = document.querySelector(".sidebar-peek-zone");
  const primaryToggle = document.querySelector(
    '[data-action="toggle-primary"]',
  );

  function showPeek() {
    window.clearTimeout(peekTimer);
    if (!state.primaryOpen) {
      state.primaryPeeking = true;
      renderPrimaryPeekState();
    }
  }

  function scheduleHidePeek() {
    window.clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => {
      if (!state.primaryOpen) {
        state.primaryPeeking = false;
        renderPrimaryPeekState();
      }
    }, 120);
  }

  peekZone.addEventListener("pointerenter", showPeek);
  peekZone.addEventListener("pointerleave", scheduleHidePeek);
  primaryToggle.addEventListener("pointerenter", showPeek);
  primaryToggle.addEventListener("pointerleave", scheduleHidePeek);
  primarySidebar.addEventListener("pointerenter", () =>
    window.clearTimeout(peekTimer),
  );
  primarySidebar.addEventListener("pointerleave", scheduleHidePeek);

  searchOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
  });

  window.addEventListener("keydown", (event) => {
    const commandKey =
      state.platform === "macos" ? event.metaKey : event.ctrlKey;
    if (commandKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
    if (commandKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      newThread();
    }
    if (event.key === "Escape" && searchOverlay.classList.contains("is-open"))
      closeSearch();
    else if (event.key === "Escape" && state.reviewMode === "acceptance") {
      state.reviewMode = "presentation";
      render();
      showToast("已返回交互稿展示模式");
    }
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = composerInput.value.trim();
    if (!text && state.attachments.length === 0) {
      showToast("请输入任务内容或添加附件后再发送");
      composerInput.focus();
      return;
    }
    const attachmentCount = state.attachments.length;
    state.steerItems.push({
      id: `steer-${++steerSequence}`,
      text: text || `发送 ${attachmentCount} 个附件`,
    });
    composerInput.value = "";
    state.attachments = [];
    render();
    composerInput.focus();
    showToast(
      state.steerItems.length === 1
        ? "已加入引导队列"
        : `已有 ${state.steerItems.length} 条等待引导`,
    );
  });

  composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  steerList.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".steer-row");
    if (!row) return;
    draggedSteerId = row.dataset.steerId;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  steerList.addEventListener("dragover", (event) => {
    const row = event.target.closest(".steer-row");
    if (!row || row.dataset.steerId === draggedSteerId) return;
    event.preventDefault();
    steerList
      .querySelectorAll(".is-drop-target")
      .forEach((item) => item.classList.remove("is-drop-target"));
    row.classList.add("is-drop-target");
  });

  steerList.addEventListener("drop", (event) => {
    const targetRow = event.target.closest(".steer-row");
    if (!targetRow || !draggedSteerId) return;
    event.preventDefault();
    const fromIndex = state.steerItems.findIndex(
      (item) => item.id === draggedSteerId,
    );
    const targetIndex = state.steerItems.findIndex(
      (item) => item.id === targetRow.dataset.steerId,
    );
    if (fromIndex >= 0 && targetIndex >= 0 && fromIndex !== targetIndex) {
      const [moved] = state.steerItems.splice(fromIndex, 1);
      state.steerItems.splice(targetIndex, 0, moved);
      render();
      showToast("已调整引导顺序");
    }
  });

  steerList.addEventListener("dragend", () => {
    draggedSteerId = null;
    steerList
      .querySelectorAll(".is-dragging, .is-drop-target")
      .forEach((item) => {
        item.classList.remove("is-dragging", "is-drop-target");
      });
  });

  const responsiveObserver = new ResizeObserver(([entry]) => {
    if (
      entry.contentRect.width < 995 &&
      state.auxiliaryOpen &&
      !state.auxiliaryPrimary
    ) {
      state.auxiliaryOpen = false;
      state.auxiliaryWidth = 319;
      render();
      showToast("空间不足，右侧辅助区已自动收起");
    }
  });
  responsiveObserver.observe(appWindow);

  const interactionDockObserver = new ResizeObserver(() => {
    const distanceToBottom =
      conversationScroll.scrollHeight -
      conversationScroll.scrollTop -
      conversationScroll.clientHeight;
    const shouldKeepBottomLocked = distanceToBottom <= 24;
    const dockStyle = getComputedStyle(interactionDock);
    const contentGap =
      Number.parseFloat(
        getComputedStyle(appWindow).getPropertyValue(
          "--interaction-content-gap",
        ),
      ) || 8;
    const fadeInset = Number.parseFloat(dockStyle.paddingTop) || 0;
    const visibleDockHeight =
      interactionDock.getBoundingClientRect().height - fadeInset;
    const safeArea = Math.ceil(visibleDockHeight + contentGap);
    appWindow.style.setProperty(
      "--interaction-dock-safe-area",
      `${safeArea}px`,
    );
    window.requestAnimationFrame(() => {
      if (shouldKeepBottomLocked) {
        conversationScroll.scrollTop = Math.max(
          0,
          conversationScroll.scrollHeight - conversationScroll.clientHeight,
        );
      }
    });
  });
  interactionDockObserver.observe(interactionDock);

  document
    .querySelector('[data-action="review-file"]')
    .addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        reviewFile();
      }
    });

  render();
})();
