(() => {
  const root = document.documentElement;
  const initialQuery = new URLSearchParams(window.location.search);

  const navItems = document.querySelectorAll(".nav-item");
  const panes = document.querySelectorAll(".section-pane");
  const contentHeader = document.querySelector('[data-section-head]');
  const runtimeSelect = document.querySelector(".runtime-settings-select");
  const reviewModeLink = document.querySelector('[data-review="acceptance"]');
  const trafficClose = document.querySelector(".traffic-light.is-close");
  const trafficMinimize = document.querySelector(".traffic-light.is-minimize");
  const trafficZoom = document.querySelector(".traffic-light.is-zoom");
  const captionControls = document.querySelectorAll(
    ".windows-caption-controls button",
  );

  const sectionMeta = {
    general: { title: "通用", desc: "运行行为与通知" },
    personalization: { title: "个性化", desc: "回复风格与指令" },
    appearance: { title: "外观", desc: "主题和强调色" },
    providers: { title: "模型", desc: "端点与模型" },
    runtimes: { title: "运行时", desc: "引擎与任务执行" },
    security: { title: "安全中心", desc: "权限、沙箱与访问规则" },
    audit: { title: "审计", desc: "工具调用" },
    "im-channels": { title: "IM 渠道", desc: "企微 / 飞书双向桥接" },
    "im-bots": { title: "机器人实例", desc: "空间、用途与权限" },
    version: { title: "更新", desc: "版本与热更新" },
  };

  const runtimeOptions = [
    { value: "SDK · Responses", note: "Responses API" },
    { value: "SDK · Chat Completions", note: "Chat Completions" },
    { value: "CLI · Codex CLI", note: "本地进程" },
  ];

  const validThemes = ["light", "dark", "warm"];
  const validPlatforms = ["macos", "windows"];
  const validSections = Object.keys(sectionMeta);

  const defaults = {
    platform: validPlatforms.includes(initialQuery.get("platform"))
      ? initialQuery.get("platform")
      : "macos",
    theme: validThemes.includes(initialQuery.get("theme"))
      ? initialQuery.get("theme")
      : "dark",
    section: validSections.includes(initialQuery.get("section"))
      ? initialQuery.get("section")
      : "general",
    reviewMode:
      initialQuery.get("review") === "acceptance" ? "acceptance" : "presentation",
    selectOpen: false,
    selectValue: "SDK · Responses",
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
      2200,
    );
  }

  function renderSelectMenu() {
    if (!runtimeSelect) return;
    const existing = runtimeSelect.querySelector(".settings-select-menu");
    if (existing) existing.remove();
    if (!state.selectOpen) {
      runtimeSelect.removeAttribute("data-open");
    } else {
      const menu = document.createElement("div");
      menu.className = "settings-select-menu";
      menu.setAttribute("role", "listbox");
      runtimeOptions.forEach((option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "option");
        item.dataset.selectValue = option.value;
        const label = document.createElement("span");
        label.textContent = option.value;
        const note = document.createElement("span");
        note.className = "select-option-note";
        note.textContent = option.note;
        item.append(label, note);
        if (option.value === state.selectValue) {
          item.setAttribute("aria-selected", "true");
          const check = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          check.setAttribute("viewBox", "0 0 24 24");
          const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          path.setAttribute("d", "M20 6 9 17l-5-5");
          check.append(path);
          item.append(check);
        }
        menu.append(item);
      });
      runtimeSelect.append(menu);
      runtimeSelect.setAttribute("data-open", "");
    }
    const valueEl = runtimeSelect.querySelector(".settings-select-value");
    if (valueEl) valueEl.textContent = state.selectValue;
  }

  function render() {
    root.dataset.platform = state.platform;
    root.dataset.theme = state.theme;
    root.dataset.reviewMode = state.reviewMode;

    navItems.forEach((item) => {
      const active = item.dataset.section === state.section;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-current", active ? "true" : "false");
    });
    panes.forEach((pane) => {
      pane.classList.toggle("is-active", pane.dataset.pane === state.section);
    });

    const meta = sectionMeta[state.section];
    if (meta && contentHeader) {
      const heading = contentHeader.querySelector("h1");
      const paragraph = contentHeader.querySelector("p");
      if (heading) heading.textContent = meta.title;
      if (paragraph) paragraph.textContent = meta.desc;
    }

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

    renderSelectMenu();
    syncUrl();
  }

  function syncUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("platform", state.platform);
      url.searchParams.set("theme", state.theme);
      url.searchParams.set("section", state.section);
      if (state.reviewMode === "acceptance")
        url.searchParams.set("review", "acceptance");
      else url.searchParams.delete("review");
      window.history.replaceState(null, "", url);
    } catch {
      /* file:// may not support history state — prototype still works. */
    }
  }

  function setSection(section) {
    if (!sectionMeta[section]) return;
    state.section = section;
    state.selectOpen = false;
    const scroll = document.querySelector(".settings-content-scroll");
    if (scroll) scroll.scrollTop = 0;
    render();
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

  function toggleSwitch(button) {
    const active = button.classList.toggle("active");
    button.setAttribute("aria-pressed", String(active));
    const row = button.closest(".settings-row-inline");
    const label = row && row.querySelector("strong");
    showToast(`${label ? label.textContent : "开关"}已${active ? "开启" : "关闭"}`);
  }

  function selectSegment(button) {
    const group = button.closest(".settings-segmented-options");
    if (!group) return;
    group.querySelectorAll("button").forEach((sibling) => {
      const on = sibling === button;
      sibling.classList.toggle("active", on);
      sibling.setAttribute("aria-pressed", String(on));
      const check = sibling.querySelector("svg");
      if (check) check.style.opacity = on ? "1" : "0";
    });
    const label = button.querySelector("strong");
    showToast(`已选择「${label ? label.textContent : "选项"}」`);
  }

  function toggleSelect() {
    state.selectOpen = !state.selectOpen;
    render();
  }

  function chooseSelect(value) {
    state.selectValue = value;
    state.selectOpen = false;
    render();
    showToast(`运行时已切换为 ${value}`);
  }

  function closeSelect() {
    if (!state.selectOpen) return;
    state.selectOpen = false;
    render();
  }

  function toggleReviewMode() {
    state.reviewMode =
      state.reviewMode === "acceptance" ? "presentation" : "acceptance";
    render();
    if (state.reviewMode === "acceptance")
      showToast("已进入像素验收模式，按 Esc 退出");
  }

  function goBack() {
    if (state.reviewMode === "acceptance") {
      state.reviewMode = "presentation";
      render();
      showToast("已返回交互稿展示模式");
      return;
    }
    window.location.href = "../workbench-prototype/index.html";
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

    const navItem = event.target.closest(".nav-item[data-section]");
    if (navItem) {
      setSection(navItem.dataset.section);
      return;
    }

    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      toggleSwitch(toggle);
      return;
    }

    const segment = event.target.closest("[data-segment]");
    if (segment) {
      selectSegment(segment);
      return;
    }

    const selectTrigger = event.target.closest(".settings-select-trigger");
    if (selectTrigger) {
      toggleSelect();
      return;
    }

    const selectOption = event.target.closest("[data-select-value]");
    if (selectOption) {
      chooseSelect(selectOption.dataset.selectValue);
      return;
    }

    const back = event.target.closest('[data-action="back"]');
    if (back) {
      goBack();
      return;
    }

    const reviewLink = event.target.closest('[data-review="acceptance"]');
    if (reviewLink) {
      event.preventDefault();
      toggleReviewMode();
      return;
    }

    if (state.selectOpen && !event.target.closest(".settings-select")) {
      closeSelect();
    }
  });

  trafficClose && trafficClose.addEventListener("click", () =>
    showToast("macOS：已关闭当前窗口，应用保留在 Dock"),
  );
  trafficMinimize && trafficMinimize.addEventListener("click", () =>
    showToast("macOS：窗口已最小化（交互演示）"),
  );
  trafficZoom && trafficZoom.addEventListener("click", () =>
    showToast("macOS：窗口已缩放（交互演示）"),
  );
  captionControls.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-close"))
        showToast("Windows：窗口已隐藏到系统托盘，应用继续运行");
      else showToast("Windows：窗口已最小化（交互演示）");
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.selectOpen) {
        closeSelect();
        return;
      }
      if (state.reviewMode === "acceptance") {
        state.reviewMode = "presentation";
        render();
        showToast("已返回交互稿展示模式");
        return;
      }
      goBack();
      return;
    }

    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      document.activeElement &&
      document.activeElement.closest(".settings-sidebar")
    ) {
      event.preventDefault();
      const items = Array.from(navItems);
      const currentIndex = items.findIndex(
        (item) => item.dataset.section === state.section,
      );
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + delta + items.length) % items.length;
      const nextItem = items[nextIndex];
      if (nextItem) {
        nextItem.focus();
        setSection(nextItem.dataset.section);
      }
    }
  });

  render();
})();
