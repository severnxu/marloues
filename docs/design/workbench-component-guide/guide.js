(() => {
  const components = [
    {
      id: "platform-window",
      name: "PlatformWindow",
      cn: "平台窗口",
      parent: "Root",
      depth: 0,
      role: "桌面窗口的生命周期与平台能力边界。它承载外骨架，但不拥有任何业务路由或会话状态。",
      includes: "WindowChrome、WorkbenchLayout、WorkbenchOverlayHost",
      excludes: "Conversation Store、Runtime、文件数据与业务路由",
      geometry: "默认 1280 × 860；最小 900 × 640；窗口首帧使用当前主题背景",
      states:
        "normal / maximized / fullscreen；Windows 额外包含 hidden-to-tray",
      macos:
        "使用原生 frame + hiddenInset；红灯关闭窗口但应用保留 Dock 生命周期。",
      windows:
        "使用 frameless BrowserWindow 与自绘 caption controls；关闭默认隐藏到系统托盘。",
    },
    {
      id: "window-chrome",
      name: "WindowChrome",
      cn: "窗口控制层",
      parent: "PlatformWindow",
      depth: 1,
      role: "全宽透明坐标层，组织系统窗口控件、左右栏入口和可拖拽空白区；不是一整块视觉背景。",
      includes:
        "TitleLeading、AuxiliaryToggle、DragRegion、平台窗口按钮、Windows RuntimeStatusSlot",
      excludes: "工作区名称、会话标题、辅助区标签和任何业务标题",
      geometry:
        "高 46px；自身 pointer-events: none；控件岛 28px；Windows caption 单格 46px",
      states:
        "顶部按钮由当前视图 × 左栏状态共同决定：主视图收起左栏时显示新建会话；辅助覆盖页收起左栏时同一位置改为返回主视图；辅助区全局关闭与区内收回右栏保持不同职责；RuntimeStatusSlot 仅在 MainWorkspace 为当前视图时激活",
      macos:
        "保留原生交通灯安全区 76px；TitleLeading 从 window-leading 136px 推导；不绘制 caption controls。",
      windows:
        "absolute overlay 与 WorkspaceHeader 共用同一条 46px 轨道；主区为当前视图时 RuntimeStatus 进入 trailing 序列并位于 AuxiliaryToggle 左侧，primary-overlay 中隐藏且不占位；右侧 3 × 46px caption controls 固定。",
    },
    {
      id: "workbench-layout",
      name: "WorkbenchLayout",
      cn: "三栏几何层",
      parent: "PlatformWindow",
      depth: 1,
      role: "管理标准三栏宽度、折叠和拖拽，并在辅助区进入 primary-overlay 时切换为覆盖几何，是外骨架的唯一事实源。",
      includes:
        "PrimarySidebar、MainWorkspace、AuxiliarySidebar、双侧 ResizeHandle",
      excludes: "任何栏内业务组件、窗口生命周期与全局浮层内容",
      geometry:
        "标准态 275px / min 400px / 319px；拖拽会重分配宽度；primary-overlay 脱离 flex，但以等宽占位轨道冻结主区排版",
      states:
        "left expanded/collapsed/peek/resizing 在所有右栏状态下有效；right closed/open/primary-overlay；覆盖态只禁用 right resize",
      macos: "三栏表面从窗口顶部连续铺开，透明 WindowChrome 覆盖其上。",
      windows:
        "工作台同样从 y=0 开始；主区共享顶栏，1px 横线属于顶部轨道的下边界；辅助区从 y=46 开始，ResizeHandle 不进入顶部窗口轨道。",
    },
    {
      id: "primary-sidebar",
      name: "PrimarySidebar",
      cn: "左侧导航区",
      parent: "WorkbenchLayout",
      depth: 2,
      role: "承载工作区、会话、全局入口和账户，是唯一使用 navigation surface 的一级区域。",
      includes: "PrimaryActions、WorkspaceTree、ThreadList、AccountDock",
      excludes: "当前任务正文、文件审核详情和窗口 caption controls",
      geometry: "默认/最小 275px；最大 480px；内容避让顶部 46px 控件轨道",
      states: "expanded / collapsed / peek；拖至低于 220px 后折叠",
      macos:
        "展开态顶部与交通灯、品牌连续；Peek 为覆盖层，不推动 MainWorkspace。",
      windows:
        "表面保持整高，内容从 46px 后开始；左上开关位于透明 WindowChrome 控件岛。",
    },
    {
      id: "main-workspace",
      name: "MainWorkspace",
      cn: "主功能区",
      parent: "WorkbenchLayout",
      depth: 2,
      role: "当前主要任务的唯一承载区。它组合上下文标题、业务视图和任务输入，不处理全局导航。",
      includes: "WorkspaceHeader、WorkspaceViewHost、InteractionDock",
      excludes: "工作区树、账户入口、辅助文件树与全局 Overlay",
      geometry:
        "flex: 1；最小宽度 400px；标准三栏拖宽会改变主区宽度；进入 primary-overlay 前后宽度必须相等",
      states:
        "conversation / settings / diff 等业务路由；辅助区 primary-overlay 时保留在覆盖层后方，不卸载",
      macos: "从 y=0 开始，WorkspaceHeader 与透明 WindowChrome 对齐。",
      windows:
        "从 y=0 开始；WorkspaceHeader 与 caption controls 共用第一条 46px 轨道，不能产生额外顶部。",
    },
    {
      id: "workspace-header",
      name: "WorkspaceHeader",
      cn: "主区上下文标题",
      parent: "MainWorkspace",
      depth: 2,
      role: "呈现当前任务标题，并为 macOS 提供运行状态插槽；Windows 的同一 RuntimeStatus 状态源投影到 WindowChrome trailing 插槽。",
      includes: "TaskTitle、WorkspaceGlyph、macOS RuntimeStatusSlot",
      excludes: "品牌标识、窗口按钮、辅助区标签和全局搜索入口",
      geometry:
        "高 46px；标题允许省略；macOS RuntimeStatus 右对齐主区当前可用边界",
      states:
        "左栏收起时同步位移并出现 18px 短分隔线；辅助区覆盖主视图时整个 WorkspaceHeader 仍保留在后方，但任务标题、文件夹图标、短分隔线与 RuntimeStatus 都不再表达当前视图",
      macos:
        "收起态标题位移 159px，分隔线位于 164px；展开态随 MainWorkspace 自然起始。",
      windows:
        "收起态标题位移 77px，分隔线位于 82px；主区为当前视图时运行状态挂载到 WindowChrome trailing 插槽，不以无边线的主区右缘定位。长标题仍避让 194px 控件安全区；primary-overlay 中标题、分隔线和运行状态隐藏，由辅助区标签表达当前视图。",
    },
    {
      id: "workspace-view-host",
      name: "WorkspaceViewHost",
      cn: "业务视图承载区",
      parent: "MainWorkspace",
      depth: 2,
      role: "为 Conversation、Settings、Diff 等页面提供统一的可滚动内容边界，路由内容可替换但外骨架不变。",
      includes: "ConversationViewport 或当前 WorkspaceView",
      excludes: "WorkspaceHeader、InteractionDock、跨窗口浮层",
      geometry:
        "min-height: 0；flex: 1；自行拥有纵向滚动，内容阅读宽度受 max-width 约束",
      states:
        "loading / empty / content / error 由具体 View 提供，Host 只管理尺寸与滚动",
      macos: "正文从共享 46px 标题轨道之后开始，滚动内容不得进入交通灯区。",
      windows:
        "正文同样只避让一次 46px；WindowChrome absolute overlay 不再增加布局高度。",
    },
    {
      id: "interaction-dock",
      name: "InteractionDock",
      cn: "任务交互坞",
      parent: "MainWorkspace",
      depth: 2,
      role: "主区底部的交互决策插槽；脱离消息文档流但不脱离 MainWorkspace。它只负责在输入分支与权限分支之间互斥切换。",
      includes: "InputInteractionStack、PermissionRequestPanel",
      excludes: "全局搜索、窗口快捷操作、辅助区筛选与任务历史",
      geometry:
        "absolute 定位于 MainWorkspace 底部；当前可见分支最大宽度 760px；正文终点跟随当前分支顶边动态升降",
      states:
        "input-active ↔ permission-pending；两者严格互斥，切换时不销毁隐藏分支状态",
      macos:
        "固定的是 Dock 底边；用户在底部时随 Dock 增高保持 bottom-lock，浏览历史时不抢滚动位置。",
      windows:
        "与 macOS 使用同一动态正文终点；宽度与水平中心只跟随 MainWorkspace，不得进入辅助区或 caption 轨道。",
    },
    {
      id: "input-interaction-stack",
      name: "InputInteractionStack",
      cn: "输入交互栈",
      parent: "InteractionDock",
      depth: 3,
      role: "承载所有输入相关状态。结果摘要、等待引导、附件和文本输入属于同一输入分支，并随权限请求整体隐藏或恢复。",
      includes:
        "TaskResultSummary、SteerQueue、ComposerPanel；ComposerPanel 内含 ComposerAttachmentList、PromptInput、Attachment、Permission、ModelPicker、Submit",
      excludes: "PermissionRequestPanel、消息文档流和全局浮层",
      geometry:
        "最大宽度 760px；TaskResultSummary 居中并与下层保持 8px；SteerQueue 左右缩进 14px、无下边框并零间隙贴合 Composer；多附件只在附件带内部滚动",
      states:
        "empty / text / image / file / mixed-attachments / result-summary / steer-single / steer-multiple；各状态可按规则组合",
      macos: "与 MainWorkspace 水平中心对齐；输入栈增高时保持 Dock 底边不变。",
      windows:
        "与 macOS 使用同一输入组件和尺寸规则，不进入 caption controls 安全区。",
    },
    {
      id: "permission-request-panel",
      name: "PermissionRequestPanel",
      cn: "权限请求面板",
      parent: "InteractionDock",
      depth: 3,
      role: "任务等待授权时独占 InteractionDock 的决策面；出现时隐藏整个 InputInteractionStack，审批结束后恢复原输入状态。",
      includes: "权限说明、命令摘要、拒绝、任务级允许、单次允许",
      excludes: "TaskResultSummary、SteerQueue、ComposerPanel 与附件",
      geometry: "最大宽度 760px；完整边框和四角圆角；独占 Dock 当前分支高度",
      states: "pending / resolving；不得与 input-active 同时可见",
      macos: "使用与 Composer 相同的水平中心和底部间距。",
      windows: "使用与 Composer 相同的水平中心和底部间距，不进入窗口控件轨道。",
    },
    {
      id: "auxiliary-sidebar",
      name: "AuxiliarySidebar",
      cn: "右侧辅助区",
      parent: "WorkbenchLayout",
      depth: 2,
      role: "MainWorkspace 的上下文延伸，承载文件、变更、计划等辅助信息；不是第二个导航栏。",
      includes: "AuxiliaryHeader、AuxiliaryViewHost、Files/Changes/Plan Views",
      excludes: "主任务输入、工作区导航、窗口标题和账户入口",
      geometry:
        "open 为三栏中的 319–500px flex 区域；primary-overlay 才右锚定并向左覆盖至展开左栏右缘",
      states:
        "closed / open / primary-overlay；覆盖态禁用 AuxiliaryResizeHandle，但 PrimaryResizeHandle、左栏折叠与 Peek 继续有效；open 与 primary-overlay 之间先淡出内容、原子切换几何、再于最终坐标淡入，文字不参与宽度动画",
      macos:
        "左栏展开时覆盖层从其右缘开始，标签使用标题栏标准 12px 内边距；左栏收起时改用固定 164px leading 安全区，使返回按钮与标签保持 16px；标题栏不追随居中的正文列，Peek 可叠在覆盖层之上。",
      windows:
        "区域从共享顶栏下方 y=46 开始，自身不绘制顶边框；横线由 WindowChrome 的下边界统一提供，ResizeHandle 同样从 y=46 开始。",
    },
    {
      id: "overlay-host",
      name: "WorkbenchOverlayHost",
      cn: "全局浮层宿主",
      parent: "PlatformWindow",
      depth: 1,
      role: "统一承载全局搜索、命令面板、模态对话框和 Toast，保证不被三栏 overflow 或拖拽层截断。",
      includes: "GlobalSearch、CommandPalette、Modal、Toast",
      excludes: "栏内 Popover、业务 View 的局部菜单和系统原生对话框",
      geometry:
        "覆盖 PlatformWindow 内容盒；z-index 高于 WindowChrome；背景遮罩消费 overlay token",
      states: "closed / open；打开后焦点进入浮层，Escape 关闭并恢复触发点",
      macos: "快捷键显示 ⌘K；必须覆盖透明标题层且不影响原生交通灯。",
      windows:
        "快捷键显示 Ctrl+K；遮罩覆盖 caption 下的应用内容，但不伪造系统窗口控件。",
    },
  ];

  const labels = { macos: "macOS", windows: "Windows" };
  const reviewState = { macos: {}, windows: {} };
  let platform = "macos";
  let cardObserver;

  const cardsRoot = document.querySelector("#component-cards");
  const treeRoot = document.querySelector("#component-tree");
  const dialog = document.querySelector("#image-dialog");
  const dialogImage = document.querySelector("#dialog-image");
  const dialogCaption = document.querySelector("#dialog-caption");

  function imagePath(item) {
    return `./assets/${platform}-${item.id}.png`;
  }

  function reviewLabel(value) {
    if (value === "approved") return "已认可";
    if (value === "change") return "需调整";
    return "待审核";
  }

  function renderTree() {
    treeRoot.innerHTML = components
      .map(
        (item, index) => `
      <a class="tree-link" href="#${platform}-${item.id}" data-index="${String(index + 1).padStart(2, "0")}" data-depth="${item.depth}">${item.name}</a>
    `,
      )
      .join("");
  }

  function renderCards() {
    cardsRoot.innerHTML = components
      .map((item, index) => {
        const review = reviewState[platform][item.id] ?? "pending";
        return `
        <article class="component-card" id="${platform}-${item.id}" data-component="${item.id}" data-review="${review}">
          <header class="card-header">
            <div class="component-name"><span class="component-index">${String(index + 1).padStart(2, "0")}</span><div><h3>${item.name}</h3><p>${item.cn} · Parent: ${item.parent}</p></div></div>
            <span class="status-chip">${reviewLabel(review)}</span>
          </header>
          <div class="card-body">
            <figure class="component-shot" data-image="${imagePath(item)}" data-caption="${labels[platform]} / ${item.name}"><img src="${imagePath(item)}" alt="${labels[platform]} ${item.cn}截图" /></figure>
            <div class="component-spec">
              <p class="role-copy">${item.role}</p>
              <dl class="spec-grid">
                <div><dt>包含</dt><dd>${item.includes}</dd></div>
                <div><dt>不包含</dt><dd>${item.excludes}</dd></div>
                <div><dt>尺寸边界</dt><dd>${item.geometry}</dd></div>
                <div><dt>状态</dt><dd>${item.states}</dd></div>
              </dl>
              <p class="platform-rule"><strong>${labels[platform]}：</strong>${item[platform]}</p>
              <div class="review-actions" aria-label="${item.name} 审核结论">
                <button type="button" data-review-value="approved" class="${review === "approved" ? "is-active" : ""}">结构正确</button>
                <button type="button" data-review-value="change" class="${review === "change" ? "is-active" : ""}">需要调整</button>
              </div>
            </div>
          </div>
        </article>`;
      })
      .join("");
    if (cardObserver) {
      document
        .querySelectorAll(".component-card")
        .forEach((card) => cardObserver.observe(card));
    }
  }

  function updateSummary() {
    const values = Object.values(reviewState[platform]);
    const approved = values.filter((value) => value === "approved").length;
    const changes = values.filter((value) => value === "change").length;
    document.querySelector("#approved-count").textContent = String(approved);
    document.querySelector("#change-count").textContent = String(changes);
    document.querySelector("#progress-fill").style.width =
      `${((approved + changes) / components.length) * 100}%`;
  }

  function renderPlatform() {
    document.documentElement.dataset.platform = platform;
    document
      .querySelectorAll('[role="tab"][data-platform]')
      .forEach((button) => {
        const active = button.dataset.platform === platform;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
    document.querySelector("#overview-image").src =
      `./assets/${platform}-platform-window.png`;
    document.querySelector("#overview-image").alt =
      `${labels[platform]} 工作台整体结构`;
    document.querySelector("#overview-label").textContent =
      `${labels[platform]} / PlatformWindow`;
    document.querySelector("#summary-platform").textContent = labels[platform];
    document.querySelector("#tree-platform").textContent = labels[platform];
    document.querySelector("#list-title").textContent =
      `${labels[platform]} 区块说明`;
    renderTree();
    renderCards();
    updateSummary();
  }

  function openImage(src, caption) {
    dialogImage.src = src;
    dialogCaption.textContent = caption;
    dialog.showModal();
  }

  document.addEventListener("click", (event) => {
    const platformButton = event.target.closest('[role="tab"][data-platform]');
    if (platformButton) {
      platform = platformButton.dataset.platform;
      renderPlatform();
      return;
    }

    const reviewButton = event.target.closest("[data-review-value]");
    if (reviewButton) {
      const card = reviewButton.closest(".component-card");
      const next = reviewButton.dataset.reviewValue;
      reviewState[platform][card.dataset.component] =
        reviewState[platform][card.dataset.component] === next
          ? "pending"
          : next;
      renderCards();
      updateSummary();
      return;
    }

    const shot = event.target.closest(".component-shot");
    if (shot) openImage(shot.dataset.image, shot.dataset.caption);

    if (
      event.target.closest('[data-zoom-target="overview-image"]') ||
      event.target.id === "overview-image"
    ) {
      openImage(
        document.querySelector("#overview-image").src,
        `${labels[platform]} / PlatformWindow`,
      );
    }

    if (event.target.closest('[data-action="close-dialog"]')) dialog.close();

    if (event.target.closest('[data-action="reset-review"]')) {
      reviewState.macos = {};
      reviewState.windows = {};
      renderCards();
      updateSummary();
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  cardObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      document
        .querySelectorAll(".tree-link")
        .forEach((link) =>
          link.classList.toggle(
            "is-active",
            link.hash === `#${visible.target.id}`,
          ),
        );
    },
    { rootMargin: "-20% 0px -65%", threshold: [0.1, 0.4, 0.7] },
  );
  renderPlatform();
})();
