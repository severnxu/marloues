(() => {
  const root = document.documentElement;
  const initialQuery = new URLSearchParams(window.location.search);

  const navItems = document.querySelectorAll(".nav-item");
  const panes = document.querySelectorAll(".section-pane");
  const contentHeader = document.querySelector('[data-section-head]');
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

  const selectOptions = {
    runtime: [
      { value: "sdk", label: "Claude SDK", note: "Anthropic" },
      { value: "cli", label: "Codex CLI", note: "OpenAI Responses" },
      { value: "marloues", label: "Marloues 自研", note: "OpenAI Chat" },
    ],
    "sandbox-mode": [
      { value: "workspace-write", label: "工作区可写" },
      { value: "read-only", label: "只读" },
      { value: "workspace-write-network", label: "工作区可写并联网" },
    ],
    "network-policy": [
      { value: "ask", label: "按请求审批" },
      { value: "deny", label: "阻断所有网络" },
      { value: "allow", label: "允许网络" },
    ],
  };

  const seedProviders = [
    {
      id: "builtin-deepseek",
      name: "DeepSeek",
      kind: "builtin",
      presetId: "deepseek",
      enabled: true,
      apiKey: "",
      endpoints: [
        { id: "deepseek-anthropic", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.deepseek.com/anthropic", priority: 10, enabled: true },
        { id: "deepseek-openai", name: "OpenAI Chat", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", priority: 20, enabled: true },
      ],
      models: [
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", enabled: true, contextWindowTokens: 128000, maxOutputTokens: 384000, supportsVision: false, supportsThinking: true },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", enabled: true, contextWindowTokens: 128000, maxOutputTokens: 384000, supportsVision: false, supportsThinking: true },
      ],
    },
    {
      id: "custom-aliyun",
      name: "阿里云百炼",
      kind: "custom",
      enabled: true,
      apiKey: "sk-test-placeholder",
      endpoints: [
        { id: "ep-1", enabled: true, protocol: "openai-chat", priority: 1, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      ],
      models: [
        { id: "qwen-max", label: "Qwen Max", enabled: true, contextWindowTokens: 32000, maxOutputTokens: 8192, supportsVision: false, supportsThinking: true },
      ],
    },
  ];

  const endpointProtocolOptions = [
    { value: "openai-chat", label: "OpenAI Chat" },
    { value: "openai-responses", label: "OpenAI Responses" },
    { value: "anthropic", label: "Anthropic" },
  ];

  const BUILTIN_PRESETS = [
    { id: "deepseek", name: "DeepSeek", endpoints: [
      { id: "deepseek-anthropic", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.deepseek.com/anthropic", priority: 10, enabled: true },
      { id: "deepseek-openai", name: "OpenAI Chat", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", priority: 20, enabled: true },
    ] },
    { id: "minimax", name: "MiniMax", endpoints: [
      { id: "minimax-anthropic", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.minimaxi.com/anthropic", priority: 10, enabled: true },
      { id: "minimax-openai", name: "OpenAI Chat", protocol: "openai-chat", baseUrl: "https://api.minimaxi.com/v1", priority: 20, enabled: true },
    ] },
    { id: "zhipu", name: "智谱 GLM", endpoints: [
      { id: "zhipu-openai", name: "OpenAI Chat", protocol: "openai-chat", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", priority: 10, enabled: true },
    ] },
  ];

  function builtinPreset(id) {
    return BUILTIN_PRESETS.find((p) => p.id === id);
  }

  function createModalEndpoint(index) {
    return {
      id: `ep-${Date.now()}-${index}`,
      name: `端点 ${index}`,
      protocol: "openai-chat",
      baseUrl: "",
      enabled: true,
      priority: index * 10,
    };
  }

  const seedSecurityItems = {
    "auto-allow-paths": ["/Users/demo/workspace", "/tmp/marloues-cache"],
    "protected-paths": ["/Users/demo/Documents", "/Users/demo/.config/secrets"],
    "allow-commands": ["git status", "git log", "npm test", "rg --files"],
    "ask-commands": ["git push", "npm publish", "rm -rf"],
    "allowed-domains": ["api.openai.com", "dashscope.aliyuncs.com"],
    "denied-domains": ["tracking.example.com", "ads.example.net"],
  };

  const securityConfig = {
    "auto-allow-paths": { label: "自动放行路径", icon: "folderOpen", placeholder: "例如：C:\\workspace\\shared-cache" },
    "protected-paths": { label: "强制审批路径", icon: "shieldCheck", placeholder: "例如：C:\\Users\\me\\Documents" },
    "allow-commands": { label: "放行命令", icon: "terminal", placeholder: "例如：git status" },
    "ask-commands": { label: "询问命令", icon: "terminalPrompt", placeholder: "例如：git push" },
    "allowed-domains": { label: "允许域名", icon: "globe", placeholder: "api.example.com" },
    "denied-domains": { label: "拒绝域名", icon: "globeLock", placeholder: "tracking.example.com" },
  };

  const seedBots = [
    {
      id: "bot-wecom-01",
      name: "企微 · 运维告警机器人",
      channel: "wecom",
      channelLabel: "企业微信",
      enabled: true,
      workspace: "platform-ops",
      purpose: "运维告警与审批回调",
      chatId: "wwchat-001",
      userId: "wwuser-admin",
      model: "GPT-4o (OpenAI · 官方)",
      permissions: ["文件读取", "Bash 执行（受限）", "网络访问（白名单）"],
      lastActive: "2 分钟前",
      messageCount: 1284,
    },
    {
      id: "bot-feishu-01",
      name: "飞书 · 代码审查助手",
      channel: "feishu",
      channelLabel: "飞书",
      enabled: true,
      workspace: "dev-team-alpha",
      purpose: "PR 审查与代码质量反馈",
      chatId: "fschat-042",
      userId: "fsuser-reviewer",
      model: "Qwen Max (阿里云百炼)",
      permissions: ["文件读取", "Git 操作"],
      lastActive: "15 分钟前",
      messageCount: 642,
    },
    {
      id: "bot-wecom-02",
      name: "企微 · 定时任务通知",
      channel: "wecom",
      channelLabel: "企业微信",
      enabled: false,
      workspace: "data-pipeline",
      purpose: "每日数据管道状态推送",
      chatId: "wwchat-088",
      userId: "wwuser-scheduler",
      model: "GPT-4o mini (OpenAI · 官方)",
      permissions: ["网络访问（白名单）"],
      lastActive: "3 小时前",
      messageCount: 58,
    },
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
    openSelect: null,
    selectValues: {
      runtime: "sdk",
      "sandbox-mode": "workspace-write",
      "network-policy": "ask",
    },
    providers: seedProviders.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m })) })),
    detailProviderId: null,
    defaultModel: { providerId: "builtin-deepseek", modelId: "deepseek-v4-flash" },
    newProviderId: null,
    visibleApiKeyProviderIds: new Set(),
    manualModelDraft: null,
    modelImportDraft: null,
    checkingEndpointIds: new Set(),
    fetchingModelIds: new Set(),
    expandedEndpointIds: new Set(),
    checkingModelIds: new Set(),
    openEndpointSelect: null,
    securityItems: Object.fromEntries(
      Object.entries(seedSecurityItems).map(([k, v]) => [k, [...v]])
    ),
    expandedSecurityGroups: new Set(Object.keys(securityConfig)),
    securityInputDrafts: {},
    bots: seedBots.map((b) => ({ ...b, permissions: [...b.permissions] })),
    expandedBotIds: new Set(),
    providerModalOpen: false,
    providerModalDraft: null,
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

  function svgEl(viewBox, d) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  }

  const ICONS = {
    chevronDown: [["path", { d: "m6 9 6 6 6-6" }]],
    chevronRight: [["path", { d: "m9 18 6-6-6-6" }]],
    plugZap: [
      ["path", { d: "M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" }],
      ["path", { d: "m2 22 3-3" }],
      ["path", { d: "M7.5 13.5 10 11" }],
      ["path", { d: "M10.5 16.5 13 14" }],
      ["path", { d: "m18 3-4 4h6l-4 4" }],
    ],
    bot: [
      ["path", { d: "M12 8V4H8" }],
      ["rect", { width: 16, height: 12, x: 4, y: 8, rx: 2 }],
      ["path", { d: "M2 14h2" }],
      ["path", { d: "M20 14h2" }],
      ["path", { d: "M15 13v2" }],
      ["path", { d: "M9 13v2" }],
    ],
    eye: [
      ["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }],
      ["circle", { cx: 12, cy: 12, r: 3 }],
    ],
    eyeOff: [
      ["path", { d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" }],
      ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }],
      ["path", { d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" }],
      ["path", { d: "m2 2 20 20" }],
    ],
    trash2: [
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }],
      ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }],
    ],
    refreshCcw: [
      ["path", { d: "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
      ["path", { d: "M3 3v5h5" }],
      ["path", { d: "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" }],
      ["path", { d: "M16 16h5v5" }],
    ],
    plus: [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "M12 5v14" }],
    ],
    check: [
      ["path", { d: "M20 6 9 17l-5-5" }],
    ],
    serverCog: [
      ["path", { d: "M4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5" }],
      ["path", { d: "M4.5 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5" }],
      ["path", { d: "M6 6h.01" }],
      ["path", { d: "M6 18h.01" }],
      ["path", { d: "m15.7 13.4-.9-.3" }],
      ["path", { d: "m9.2 10.9-.9-.3" }],
      ["path", { d: "m10.6 15.7.3-.9" }],
      ["path", { d: "m13.6 15.7-.4-1" }],
      ["path", { d: "m10.8 9.3-.4-1" }],
      ["path", { d: "m8.3 13.6 1-.4" }],
      ["path", { d: "m14.7 10.8 1-.4" }],
      ["path", { d: "m13.4 8.3-.3.9" }],
    ],
    folderOpen: [
      ["path", { d: "M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v1" }],
      ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
      ["rect", { width: 8, height: 5, x: 2, y: 13, rx: 1 }],
      ["path", { d: "M8 13v-2a2 2 0 1 0-4 0v2" }],
    ],
    shieldCheck: [
      ["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
      ["path", { d: "m9 12 2 2 4-4" }],
    ],
    terminal: [
      ["path", { d: "m7 11 2-2-2-2" }],
      ["path", { d: "M11 13h4" }],
      ["rect", { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }],
    ],
    terminalPrompt: [
      ["path", { d: "m7 11 2-2-2-2" }],
      ["path", { d: "M11 13h4" }],
      ["rect", { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }],
    ],
    globe: [
      ["circle", { cx: 12, cy: 12, r: 10 }],
      ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
      ["path", { d: "M2 12h20" }],
    ],
    globeLock: [
      ["path", { d: "M21.54 15H17a2 2 0 0 0-2 2v4.54" }],
      ["path", { d: "M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" }],
      ["path", { d: "M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" }],
      ["circle", { cx: 12, cy: 12, r: 10 }],
    ],
    x: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
    messageSquare: [
      ["path", { d: "M14.9 6.5a8.96 8.96 0 0 0-6.3-1.5C3.4 5.5 1 9.3 1 14.1c0 1.6.3 3.1.9 4.5a.5.5 0 0 0 .9.1c.6-.8 1.3-1.5 2.1-2a8.96 8.96 0 0 0 4.5-1.5" }],
      ["path", { d: "M15 2v4a2 2 0 0 0 2 2h4" }],
      ["rect", { width: 8, height: 5, x: 2, y: 13, rx: 1 }],
    ],
    power: [
      ["path", { d: "M12 2v10" }],
      ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04" }],
    ],
    hash: [
      ["path", { d: "M4 9h16" }],
      ["path", { d: "M4 15h16" }],
      ["path", { d: "M10 3 8 21" }],
      ["path", { d: "M16 3l-2 18" }],
    ],
    user: [
      ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
      ["circle", { cx: 12, cy: 7, r: 4 }],
    ],
    cpu: [
      ["path", { d: "M12 20v2" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M17 20v2" }],
      ["path", { d: "M17 2v2" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M2 17h2" }],
      ["path", { d: "M2 7h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "M20 17h2" }],
      ["path", { d: "M20 7h2" }],
      ["rect", { width: 12, height: 12, x: 4, y: 4, rx: 2 }],
      ["rect", { width: 6, height: 6, x: 9, y: 9, rx: 1 }],
    ],
    clock: [
      ["circle", { cx: 12, cy: 12, r: 10 }],
      ["path", { d: "M12 6v6l4 2" }],
    ],
    lock: [
     ["rect", { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }],
     ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
    ],
    pipette: [
      ["path", { d: "m2 22 1-1h3l3-3" }],
      ["path", { d: "m4 21v-3l3-3" }],
      ["path", { d: "M18 4 7.75 14.375a2.36 2.36 0 0 0 0 3.34l1.53 1.53a2.36 2.36 0 0 0 3.34 0L22 7.25" }],
    ],
  };

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const elements = ICONS[name];
    if (!elements) return svg;
    const NS = "http://www.w3.org/2000/svg";
    for (const [tag, attrs] of elements) {
      const el = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, String(value));
      }
      svg.append(el);
    }
    return svg;
  }

  function renderSelectMenus() {
    document.querySelectorAll("[data-select-id]").forEach((sel) => {
      const sid = sel.dataset.selectId;
      const options = selectOptions[sid];
      if (!options) return;
      const existing = sel.querySelector(".settings-select-menu");
      if (existing) existing.remove();
      const isOpen = state.openSelect === sid;
      const trigger = sel.querySelector(".settings-select-trigger");
      const valueEl = sel.querySelector(".settings-select-value");
      const currentValue = state.selectValues[sid];
      const currentOption = options.find((o) => o.value === currentValue);
      if (valueEl && currentOption) valueEl.textContent = currentOption.label;
      if (trigger) trigger.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        const menu = document.createElement("div");
        menu.className = "settings-select-menu";
        menu.setAttribute("role", "listbox");
        options.forEach((option) => {
          const item = document.createElement("button");
          item.type = "button";
          item.setAttribute("role", "option");
          item.dataset.selectValue = option.value;
          const label = document.createElement("span");
          label.textContent = option.label;
          item.append(label);
          if (option.note) {
            const note = document.createElement("span");
            note.className = "select-option-note";
            note.textContent = option.note;
            item.append(note);
          }
          if (option.value === currentValue) {
            item.setAttribute("aria-selected", "true");
            item.append(icon("check"));
          }
          menu.append(item);
        });
        sel.append(menu);
        sel.setAttribute("data-open", "");
      } else {
        sel.removeAttribute("data-open");
      }
    });
  }

  function findProvider(id) {
    return state.providers.find((p) => p.id === id);
  }

  function openProviderDetail(id) {
    state.detailProviderId = id;
    render();
  }

  function closeProviderDetail() {
    state.detailProviderId = null;
    render();
  }

  function toggleProviderEnabled(id, checked) {
    const p = findProvider(id);
    if (!p) return;
    p.enabled = checked;
    render();
    showToast(`${p.name || "供应商"}已${checked ? "启用" : "禁用"}`);
  }

  function removeProvider(id) {
    const p = findProvider(id);
    if (!p) return;
    state.providers = state.providers.filter((x) => x.id !== id);
    if (state.detailProviderId === id) state.detailProviderId = null;
    render();
    showToast(`已删除 ${p.name || "供应商"}`);
  }

  function testProvider(id) {
    const p = findProvider(id);
    if (!p) return;
    state.checkingEndpointIds.add(id);
    render();
    showToast(`正在测试 ${p.name || "供应商"} 连接…`);
    window.setTimeout(() => {
      state.checkingEndpointIds.delete(id);
      render();
      showToast(`${p.name || "供应商"} 连接正常`);
    }, 1200);
  }

  function openProviderModal() {
    state.providerModalOpen = true;
    state.providerModalDraft = {
      kind: "builtin",
      presetId: "deepseek",
      name: "",
      apiKey: "",
      apiKeyVisible: false,
      endpoints: [createModalEndpoint(1)],
      models: [],
      defaultModelId: null,
      manualId: "",
      fetching: false,
      testing: false,
      importDraft: null,
    };
    render();
    const input = document.querySelector("[data-modal-provider-name]");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function closeProviderModal() {
    state.providerModalOpen = false;
    state.providerModalDraft = null;
    render();
  }

  function setModalKind(kind) {
    if (!state.providerModalDraft) return;
    state.providerModalDraft.kind = kind;
    state.providerModalDraft.models = [];
    state.providerModalDraft.defaultModelId = null;
    state.providerModalDraft.importDraft = null;
    render();
  }

  function setModalApiKeyValue(value) {
    if (state.providerModalDraft) state.providerModalDraft.apiKey = value;
  }

  function toggleModalApiKeyVisible() {
    if (!state.providerModalDraft) return;
    state.providerModalDraft.apiKeyVisible = !state.providerModalDraft.apiKeyVisible;
    render();
  }

  function setModalName(value) {
    if (state.providerModalDraft) state.providerModalDraft.name = value;
  }

  function addModalEndpoint() {
    if (!state.providerModalDraft) return;
    state.providerModalDraft.endpoints.push(
      createModalEndpoint(state.providerModalDraft.endpoints.length + 1),
    );
    render();
  }

  function removeModalEndpoint(endpointId) {
    if (!state.providerModalDraft) return;
    if (state.providerModalDraft.endpoints.length <= 1) {
      showToast("至少保留一个端点");
      return;
    }
    state.providerModalDraft.endpoints = state.providerModalDraft.endpoints.filter(
      (ep) => ep.id !== endpointId,
    );
    render();
  }

  function updateModalEndpoint(endpointId, patch) {
    if (!state.providerModalDraft) return;
    const ep = state.providerModalDraft.endpoints.find((x) => x.id === endpointId);
    if (ep) Object.assign(ep, patch);
  }

  function setModalManualId(value) {
    if (state.providerModalDraft) state.providerModalDraft.manualId = value;
  }

  function addModalManualModel() {
    const draft = state.providerModalDraft;
    if (!draft) return;
    const id = draft.manualId.trim();
    if (!id) {
      showToast("请输入模型 ID");
      return;
    }
    if (draft.models.some((m) => m.id === id)) {
      showToast("模型已存在");
      return;
    }
    draft.models.push({
      id, label: id, enabled: true,
      contextWindowTokens: undefined, maxOutputTokens: undefined,
      supportsVision: false, supportsThinking: false,
    });
    if (!draft.defaultModelId) draft.defaultModelId = id;
    draft.manualId = "";
    render();
  }

  function removeModalModel(modelId) {
    const draft = state.providerModalDraft;
    if (!draft) return;
    draft.models = draft.models.filter((m) => m.id !== modelId);
    if (draft.defaultModelId === modelId) {
      draft.defaultModelId = draft.models.length ? draft.models[0].id : null;
    }
    render();
  }

  function updateModalModel(modelId, patch) {
    const draft = state.providerModalDraft;
    if (!draft) return;
    const m = draft.models.find((x) => x.id === modelId);
    if (m) Object.assign(m, patch);
  }

  function setModalDefaultModel(modelId) {
    if (state.providerModalDraft) state.providerModalDraft.defaultModelId = modelId;
    render();
  }

  function fetchModalModels() {
    const draft = state.providerModalDraft;
    if (!draft) return;
    if (!draft.apiKey.trim()) {
      showToast("请先填写 API Key");
      return;
    }
    if (draft.kind === "custom" && !draft.endpoints.some((ep) => ep.enabled && ep.baseUrl.trim())) {
      showToast("请先填写端点地址");
      return;
    }
    draft.fetching = true;
    render();
    showToast("正在获取模型列表…");
    window.setTimeout(() => {
      if (!state.providerModalDraft) return;
      const preset = draft.kind === "builtin" ? builtinPreset(draft.presetId) : null;
      const seed = preset ? preset.id : "custom";
      const discovered = [];
      if (seed === "deepseek") {
        discovered.push(
          { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
          { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
        );
      } else if (seed === "minimax") {
        discovered.push(
          { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed" },
          { id: "MiniMax-M3", label: "MiniMax M3" },
        );
      } else if (seed === "zhipu") {
        discovered.push({ id: "glm-5.2", label: "GLM-5.2" });
      } else {
        discovered.push(
          { id: "model-a", label: "Model A" },
          { id: "model-b", label: "Model B" },
        );
      }
      const currentIds = new Set(state.providerModalDraft.models.map((m) => m.id));
      const fresh = discovered
        .filter((m) => !currentIds.has(m.id))
        .map((m) => ({ ...m, enabled: false }));
      state.providerModalDraft.fetching = false;
      if (fresh.length === 0) {
        showToast("没有发现新模型");
      } else {
        state.providerModalDraft.importDraft = {
          models: fresh,
          selectedIds: new Set(),
        };
        showToast(`发现 ${fresh.length} 个新模型`);
      }
      render();
    }, 1400);
  }

  function toggleModalImportSelection(modelId) {
    const draft = state.providerModalDraft;
    if (!draft || !draft.importDraft) return;
    const ids = new Set(draft.importDraft.selectedIds);
    if (ids.has(modelId)) ids.delete(modelId);
    else ids.add(modelId);
    draft.importDraft.selectedIds = ids;
    render();
  }

  function applyModalImport() {
    const draft = state.providerModalDraft;
    if (!draft || !draft.importDraft) return;
    const currentIds = new Set(draft.models.map((m) => m.id));
    const selected = draft.importDraft.models
      .filter((m) => draft.importDraft.selectedIds.has(m.id) && !currentIds.has(m.id))
      .map((m) => ({ ...m, enabled: true }));
    if (selected.length === 0) {
      showToast("请勾选要添加的模型");
      return;
    }
    draft.models.push(...selected);
    if (!draft.defaultModelId && draft.models.length) draft.defaultModelId = draft.models[0].id;
    draft.importDraft = null;
    render();
    showToast(`已导入 ${selected.length} 个模型`);
  }

  function dismissModalImport() {
    if (state.providerModalDraft) state.providerModalDraft.importDraft = null;
    render();
  }

  function toggleModelImportSelection(modelId) {
    const draft = state.modelImportDraft;
    if (!draft) return;
    const ids = new Set(draft.selectedIds);
    if (ids.has(modelId)) ids.delete(modelId);
    else ids.add(modelId);
    draft.selectedIds = ids;
    render();
  }

  function applyModelImport() {
    const draft = state.modelImportDraft;
    if (!draft) return;
    const p = findProvider(draft.providerId);
    if (!p) { state.modelImportDraft = null; render(); return; }
    const currentIds = new Set(p.models.map((m) => m.id));
    const selected = draft.models
      .filter((m) => draft.selectedIds.has(m.id) && !currentIds.has(m.id))
      .map((m) => ({ ...m, enabled: true }));
    if (selected.length === 0) {
      showToast("请勾选要添加的模型");
      return;
    }
    p.models.push(...selected);
    if (!state.defaultModel.modelId && p.models.length) {
      state.defaultModel = { providerId: p.id, modelId: p.models[0].id };
    }
    state.modelImportDraft = null;
    render();
    showToast(`已导入 ${selected.length} 个模型`);
  }

  function dismissModelImport() {
    state.modelImportDraft = null;
    render();
  }

  function toggleEndpointExpanded(epCheckId) {
    if (state.expandedEndpointIds.has(epCheckId)) state.expandedEndpointIds.delete(epCheckId);
    else state.expandedEndpointIds.add(epCheckId);
    render();
  }

  function testModalProvider() {
    const draft = state.providerModalDraft;
    if (!draft) return;
    if (!draft.apiKey.trim()) {
      showToast("请先填写 API Key");
      return;
    }
    draft.testing = true;
    render();
    showToast("正在测试连接…");
    window.setTimeout(() => {
      if (!state.providerModalDraft) return;
      state.providerModalDraft.testing = false;
      render();
      showToast("端点连接正常");
    }, 1200);
  }

  function providerIsComplete(draft) {
    if (!draft.apiKey.trim()) return false;
    if (draft.kind === "builtin") return true;
    return draft.endpoints.some((ep) => ep.enabled && ep.baseUrl.trim());
  }

  function buildModalProvider(draft) {
    const providerName =
      draft.kind === "builtin"
        ? (builtinPreset(draft.presetId)?.name || draft.presetId)
        : (draft.name.trim() || "自定义供应商");
    const base = {
      id: `custom-${Date.now()}`,
      name: providerName,
      enabled: true,
      apiKey: draft.apiKey.trim(),
      models: draft.models.map((m) => ({ ...m })),
    };
    if (draft.kind === "builtin") {
      return {
        ...base,
        kind: "builtin",
        presetId: draft.presetId,
        endpoints: builtinPreset(draft.presetId).endpoints.map((ep) => ({ ...ep })),
      };
    }
    return {
      ...base,
      kind: "custom",
      endpoints: draft.endpoints.map((ep) => ({
        ...ep,
        name: ep.name?.trim() || undefined,
        baseUrl: ep.baseUrl.trim(),
      })),
    };
  }

  function confirmProviderModal() {
    const draft = state.providerModalDraft;
    if (!draft) return;
    if (!providerIsComplete(draft)) {
      showToast("请填写 API Key 和端点地址");
      return;
    }
    if (draft.models.length === 0) {
      showToast("请先添加至少一个模型");
      return;
    }
    const provider = buildModalProvider(draft);
    state.providers.push(provider);
    state.detailProviderId = provider.id;
    if (draft.defaultModelId) {
      state.defaultModel = { providerId: provider.id, modelId: draft.defaultModelId };
    }
    state.providerModalOpen = false;
    state.providerModalDraft = null;
    render();
    showToast(`已添加供应商「${provider.name}」`);
  }

  function toggleProviderKeyVisibility(id) {
    if (state.visibleApiKeyProviderIds.has(id)) state.visibleApiKeyProviderIds.delete(id);
    else state.visibleApiKeyProviderIds.add(id);
    render();
  }

  function updateProviderName(id, value) {
    const p = findProvider(id);
    if (p) p.name = value;
  }

  function updateProviderKey(id, value) {
    const p = findProvider(id);
    if (p) p.apiKey = value;
  }

  function toggleProviderModel(providerId, modelId, checked) {
    const p = findProvider(providerId);
    if (!p) return;
    const m = p.models.find((x) => x.id === modelId);
    if (!m) return;
    const isDefault = state.defaultModel.providerId === providerId && state.defaultModel.modelId === modelId;
    if (m.enabled && isDefault && !checked) {
      showToast("默认模型不能直接禁用，请先切换默认模型");
      return;
    }
    m.enabled = checked;
    render();
    showToast(`${m.label || m.id}已${checked ? "启用" : "禁用"}`);
  }

  function setDefaultModel(providerId, modelId) {
    const p = findProvider(providerId);
    if (!p || !p.enabled) {
      showToast("启用供应商和模型后才能设为默认");
      return;
    }
    const m = p.models.find((x) => x.id === modelId);
    if (!m || !m.enabled) {
      showToast("启用模型后才能设为默认");
      return;
    }
    state.defaultModel = { providerId, modelId };
    render();
    showToast(`已将 ${m.label || m.id} 设为默认模型`);
  }

  function fetchProviderModels(id) {
    const p = findProvider(id);
    if (!p) return;
    state.fetchingModelIds.add(id);
    render();
    showToast(`正在获取 ${p.name || "供应商"} 模型列表…`);
    window.setTimeout(() => {
      state.fetchingModelIds.delete(id);
      const discovered = [
        { id: "gpt-4o", label: "GPT-4o" },
        { id: "gpt-4o-mini", label: "GPT-4o mini" },
        { id: "o3-mini", label: "o3-mini" },
      ];
      const currentIds = new Set(p.models.map((m) => m.id));
      const fresh = discovered
        .filter((m) => !currentIds.has(m.id))
        .map((m) => ({ ...m, enabled: false }));
      if (fresh.length === 0) {
        showToast("没有发现新模型");
      } else {
        state.modelImportDraft = { providerId: id, models: fresh, selectedIds: new Set() };
        showToast(`发现 ${fresh.length} 个新模型，请勾选要添加的模型`);
      }
      render();
    }, 1200);
  }

  function setManualModelDraft(providerId) {
    state.manualModelDraft = providerId ? { providerId, modelId: "" } : null;
    render();
    if (providerId) {
      const input = document.querySelector(`[data-manual-model-input="${providerId}"]`);
      if (input) input.focus();
    }
  }

  function applyManualModel(providerId) {
    const input = document.querySelector(`[data-manual-model-input="${providerId}"]`);
    if (!input) return;
    const modelId = input.value.trim();
    if (!modelId) { showToast("请输入模型 ID"); return; }
    const p = findProvider(providerId);
    if (!p) return;
    p.models.push({
      id: modelId, label: modelId, enabled: true,
      contextWindowTokens: undefined, maxOutputTokens: undefined,
      supportsVision: false, supportsThinking: false,
    });
    render();
    showToast(`已添加模型 ${modelId}`);
  }

  function addProviderModel(id) {
    setManualModelDraft(id);
  }

  function testProviderModel(providerId, modelId) {
    const p = findProvider(providerId);
    if (!p) return;
    const m = p.models.find((x) => x.id === modelId);
    if (!m) return;
    const checkId = `${providerId}:${modelId}`;
    state.checkingModelIds.add(checkId);
    render();
    showToast(`正在探测 ${m.label || m.id}…`);
    window.setTimeout(() => {
      state.checkingModelIds.delete(checkId);
      render();
      showToast(`${m.label || m.id} 探测成功`);
    }, 1200);
  }

  function removeProviderModel(providerId, modelId) {
    const p = findProvider(providerId);
    if (!p) return;
    p.models = p.models.filter((x) => x.id !== modelId);
    if (state.defaultModel.providerId === providerId && state.defaultModel.modelId === modelId) {
      const fallback = p.models.find((m) => m.enabled);
      state.defaultModel = fallback
        ? { providerId, modelId: fallback.id }
        : { providerId: "", modelId: "" };
    }
    render();
    showToast(`已删除模型`);
  }

  function updateProviderModel(providerId, modelId, patch) {
    const p = findProvider(providerId);
    if (!p) return;
    const m = p.models.find((x) => x.id === modelId);
    if (!m) return;
    Object.assign(m, patch);
    render();
  }

  function addProviderEndpoint(providerId) {
    const p = findProvider(providerId);
    if (!p || p.kind !== "custom") return;
    if (!p.endpoints) p.endpoints = [];
    p.endpoints.push({
      id: `ep-${Date.now()}`, enabled: true, protocol: "openai-chat",
      priority: p.endpoints.length + 1, baseUrl: "",
    });
    render();
  }

  function removeProviderEndpoint(providerId, endpointId) {
    const p = findProvider(providerId);
    if (!p || !p.endpoints) return;
    if (p.endpoints.length === 1) {
      showToast("至少保留一个端点");
      return;
    }
    p.endpoints = p.endpoints.filter((x) => x.id !== endpointId);
    render();
    showToast("已删除端点");
  }

  function testProviderEndpoint(providerId, endpointId) {
    const p = findProvider(providerId);
    if (!p) return;
    const ep = p.endpoints && p.endpoints.find((x) => x.id === endpointId);
    if (!ep) return;
    const checkId = `${providerId}:${endpointId}`;
    state.checkingEndpointIds.add(checkId);
    render();
    showToast(`正在测试端点…`);
    window.setTimeout(() => {
      state.checkingEndpointIds.delete(checkId);
      render();
      showToast(`端点连接正常`);
    }, 1200);
  }

  function updateProviderEndpoint(providerId, endpointId, patch) {
    const p = findProvider(providerId);
    if (!p || !p.endpoints) return;
    const ep = p.endpoints.find((x) => x.id === endpointId);
    if (!ep) return;
    Object.assign(ep, patch);
    render();
  }

  function confirmNewProviderDraft(id) {
    state.newProviderId = null;
    render();
    showToast("供应商已确认");
  }

  function discardNewProviderDraft(id) {
    state.providers = state.providers.filter((x) => x.id !== id);
    state.newProviderId = null;
    if (state.detailProviderId === id) state.detailProviderId = null;
    render();
    showToast("已取消添加供应商");
  }

  function renderProviderModal() {
    let overlay = document.querySelector(".provider-modal-overlay");
    if (!state.providerModalOpen) {
      if (overlay) overlay.remove();
      return;
    }
    const draft = state.providerModalDraft || { kind: "builtin", presetId: "deepseek", name: "", apiKey: "", apiKeyVisible: false, endpoints: [], models: [], defaultModelId: null, manualId: "", fetching: false, testing: false, importDraft: null };
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "provider-modal-overlay";
      document.body.append(overlay);
    }
    overlay.innerHTML = "";
    const card = document.createElement("div");
    card.className = "provider-modal-card";
    const head = document.createElement("div");
    head.className = "provider-modal-head";
    const headTitle = document.createElement("div");
    headTitle.className = "provider-modal-head-title";
    const title = document.createElement("strong");
    title.textContent = "添加模型供应商";
    const titleSmall = document.createElement("small");
    titleSmall.textContent = "内置供应商自动匹配运行时协议；自定义供应商可配置多个端点。";
    headTitle.append(title, titleSmall);
    const closeBtn = document.createElement("button");
    closeBtn.className = "icon-button provider-modal-close";
    closeBtn.type = "button";
    closeBtn.dataset.providerModalClose = "";
    closeBtn.title = "关闭";
    closeBtn.append(icon("x"));
    head.append(headTitle, closeBtn);

    const body = document.createElement("div");
    body.className = "provider-modal-body scrollbar-thin";

    // ── Kind switch ──
    const kindSwitch = document.createElement("div");
    kindSwitch.className = "provider-modal-kind-switch";
    const builtinTab = document.createElement("button");
    builtinTab.type = "button";
    builtinTab.textContent = "内置供应商";
    builtinTab.dataset.modalKind = "builtin";
    if (draft.kind === "builtin") builtinTab.classList.add("active");
    const customTab = document.createElement("button");
    customTab.type = "button";
    customTab.textContent = "自定义";
    customTab.dataset.modalKind = "custom";
    if (draft.kind === "custom") customTab.classList.add("active");
    kindSwitch.append(builtinTab, customTab);
    body.append(kindSwitch);

    // ── Field grid ──
    const fieldGrid = document.createElement("div");
    fieldGrid.className = "provider-modal-field-grid";
    if (draft.kind === "builtin") {
      const presetLabel = document.createElement("label");
      presetLabel.className = "provider-modal-field";
      const presetSpan = document.createElement("span");
      presetSpan.textContent = "供应商";
      selectOptions["modal-preset"] = BUILTIN_PRESETS.map((p) => ({ value: p.id, label: p.name }));
      state.selectValues["modal-preset"] = draft.presetId;
      const presetSelectWrap = document.createElement("div");
      presetSelectWrap.className = "settings-select provider-modal-preset-select";
      presetSelectWrap.dataset.selectId = "modal-preset";
      const presetTrigger = document.createElement("button");
      presetTrigger.type = "button";
      presetTrigger.className = "settings-select-trigger";
      presetTrigger.setAttribute("aria-haspopup", "listbox");
      presetTrigger.setAttribute("aria-expanded", "false");
      const presetValue = document.createElement("span");
      presetValue.className = "settings-select-value";
      presetValue.textContent = (BUILTIN_PRESETS.find((p) => p.id === draft.presetId) || BUILTIN_PRESETS[0]).name;
      presetTrigger.append(presetValue, icon("chevronDown"));
      presetSelectWrap.append(presetTrigger);
      presetLabel.append(presetSpan, presetSelectWrap);
      fieldGrid.append(presetLabel);
      const routingNote = document.createElement("div");
      routingNote.className = "provider-modal-routing-note";
      const rStrong = document.createElement("strong");
      rStrong.textContent = "运行时自动适配";
      const rSpan = document.createElement("span");
      rSpan.textContent = "地址由 Marloues 内置维护，使用时按 SDK、Binary 或自研运行时自动选择协议。";
      routingNote.append(rStrong, rSpan);
      fieldGrid.append(routingNote);
    } else {
      const nameLabel = document.createElement("label");
      nameLabel.className = "provider-modal-field";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = "供应商名称";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = draft.name;
      nameInput.placeholder = "供应商名称";
      nameInput.dataset.modalProviderName = "";
      nameLabel.append(nameSpan, nameInput);
      fieldGrid.append(nameLabel);
    }
    // API Key (both kinds)
    const keyLabel = document.createElement("label");
    keyLabel.className = "provider-modal-field";
    const keySpan = document.createElement("span");
    keySpan.textContent = "API Key";
    const keyWrap = document.createElement("div");
    keyWrap.className = "provider-modal-apikey-wrap";
    const keyInput = document.createElement("input");
    keyInput.type = draft.apiKeyVisible ? "text" : "password";
    keyInput.value = draft.apiKey;
    keyInput.placeholder = "API Key";
    keyInput.dataset.modalProviderKey = "";
    const keyBtn = document.createElement("button");
    keyBtn.className = "provider-modal-apikey-toggle";
    keyBtn.type = "button";
    keyBtn.dataset.modalKeyToggle = "";
    keyBtn.title = draft.apiKeyVisible ? "隐藏 API 密钥" : "查看 API 密钥";
    keyBtn.append(icon(draft.apiKeyVisible ? "eyeOff" : "eye"));
    keyWrap.append(keyInput, keyBtn);
    keyLabel.append(keySpan, keyWrap);
    fieldGrid.append(keyLabel);
    body.append(fieldGrid);

    // ── Endpoints (custom only) ──
    if (draft.kind === "custom") {
      const epSection = document.createElement("div");
      epSection.className = "provider-modal-endpoint-section";
      const epHead = document.createElement("div");
      epHead.className = "provider-modal-section-head";
      const epHeadSpan = document.createElement("span");
      epHeadSpan.textContent = "模型端点";
      const epHeadActions = document.createElement("div");
      epHeadActions.className = "settings-row-actions";
      const addEpBtn = document.createElement("button");
      addEpBtn.type = "button";
      addEpBtn.className = "btn btn-ghost";
      addEpBtn.dataset.modalAddEndpoint = "";
      addEpBtn.append(icon("plus"), document.createTextNode("添加端点"));
      epHeadActions.append(addEpBtn);
      epHead.append(epHeadSpan, epHeadActions);
      const epList = document.createElement("div");
      epList.className = "provider-modal-endpoint-list";
      draft.endpoints.forEach((endpoint, epIndex) => {
        const epRow = document.createElement("div");
        epRow.className = "provider-modal-endpoint-row";
        const epHeadRow = document.createElement("div");
        epHeadRow.className = "provider-modal-endpoint-head";
        const epCheckLabel = document.createElement("label");
        epCheckLabel.className = "settings-inline-check";
        const epCheckInput = document.createElement("input");
        epCheckInput.type = "checkbox";
        epCheckInput.checked = endpoint.enabled;
        epCheckInput.dataset.modalEndpointToggle = endpoint.id;
        epCheckLabel.append(epCheckInput, document.createTextNode(`端点 ${epIndex + 1}`));
        const epActions = document.createElement("div");
        epActions.className = "settings-row-actions";
        const epTestBtn = document.createElement("button");
        epTestBtn.className = "icon-button";
        epTestBtn.type = "button";
        epTestBtn.dataset.modalEndpointTest = endpoint.id;
        epTestBtn.title = "测试此端点";
        epTestBtn.append(icon("plugZap"));
        const epDelBtn = document.createElement("button");
        epDelBtn.className = "icon-button";
        epDelBtn.type = "button";
        epDelBtn.dataset.modalEndpointRemove = endpoint.id;
        epDelBtn.title = "删除端点";
        epDelBtn.disabled = draft.endpoints.length <= 1;
        epDelBtn.append(icon("trash2"));
        epActions.append(epTestBtn, epDelBtn);
        epHeadRow.append(epCheckLabel, epActions);
        const epFields = document.createElement("div");
        epFields.className = "provider-modal-endpoint-fields";
        const protoLabel = document.createElement("label");
        protoLabel.className = "provider-modal-field";
        const protoSpan = document.createElement("span");
        protoSpan.textContent = "协议";
        const protoSelectId = `modal-ep-proto/${endpoint.id}`;
        selectOptions[protoSelectId] = endpointProtocolOptions.map((o) => ({ value: o.value, label: o.label }));
        state.selectValues[protoSelectId] = endpoint.protocol;
        const protoSelectWrap = document.createElement("div");
        protoSelectWrap.className = "settings-select";
        protoSelectWrap.dataset.selectId = protoSelectId;
        const protoTrigger = document.createElement("button");
        protoTrigger.type = "button";
        protoTrigger.className = "settings-select-trigger";
        protoTrigger.setAttribute("aria-haspopup", "listbox");
        protoTrigger.setAttribute("aria-expanded", "false");
        const protoValue = document.createElement("span");
        protoValue.className = "settings-select-value";
        const protoOpt = endpointProtocolOptions.find((o) => o.value === endpoint.protocol);
        protoValue.textContent = protoOpt ? protoOpt.label : endpoint.protocol;
        protoTrigger.append(protoValue, icon("chevronDown"));
        protoSelectWrap.append(protoTrigger);
        protoLabel.append(protoSpan, protoSelectWrap);
        const prioLabel = document.createElement("label");
        prioLabel.className = "provider-modal-field";
        const prioSpan = document.createElement("span");
        prioSpan.textContent = "优先级";
        const prioInput = document.createElement("input");
        prioInput.type = "number";
        prioInput.value = endpoint.priority;
        prioInput.min = 0;
        prioInput.dataset.modalEndpointPriority = endpoint.id;
        prioLabel.append(prioSpan, prioInput);
        const urlLabel = document.createElement("label");
        urlLabel.className = "provider-modal-field provider-modal-endpoint-url";
        const urlSpan = document.createElement("span");
        urlSpan.textContent = "Base URL";
        const urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.value = endpoint.baseUrl;
        urlInput.placeholder = "https://api.example.com/v1";
        urlInput.dataset.modalEndpointUrl = endpoint.id;
        urlLabel.append(urlSpan, urlInput);
        epFields.append(protoLabel, prioLabel, urlLabel);
        epRow.append(epHeadRow, epFields);
        epList.append(epRow);
      });
      epSection.append(epHead, epList);
      body.append(epSection);
    }

    // ── Model section ──
    const modelSection = document.createElement("div");
    modelSection.className = "provider-modal-model-section";
    const modelHead = document.createElement("div");
    modelHead.className = "provider-modal-section-head";
    const modelHeadSpan = document.createElement("span");
    modelHeadSpan.textContent = "模型";
    const modelHeadActions = document.createElement("div");
    modelHeadActions.className = "settings-row-actions";
    const fetchBtn = document.createElement("button");
    fetchBtn.type = "button";
    fetchBtn.className = "btn btn-ghost";
    fetchBtn.dataset.modalFetch = "";
    fetchBtn.disabled = draft.fetching;
    fetchBtn.append(icon(draft.fetching ? "refreshCcw" : "bot"), document.createTextNode(draft.fetching ? "获取中" : "获取模型"));
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn btn-ghost";
    testBtn.dataset.modalTest = "";
    testBtn.disabled = draft.testing;
    testBtn.append(icon(draft.testing ? "refreshCcw" : "plugZap"), document.createTextNode(draft.testing ? "测试中" : "测试连接"));
    modelHeadActions.append(fetchBtn, testBtn);
    modelHead.append(modelHeadSpan, modelHeadActions);

    const manualRow = document.createElement("div");
    manualRow.className = "provider-model-manual";
    const manualInput = document.createElement("input");
    manualInput.type = "text";
    manualInput.value = draft.manualId;
    manualInput.placeholder = "输入模型 ID，例如 gpt-4o-mini";
    manualInput.dataset.modalManualInput = "";
    const manualBtn = document.createElement("button");
    manualBtn.type = "button";
    manualBtn.className = "btn btn-ghost";
    manualBtn.dataset.modalManualAdd = "";
    manualBtn.title = "添加模型";
    manualBtn.append(icon("plus"), document.createTextNode("添加"));
    manualRow.append(manualInput, manualBtn);

    modelSection.append(modelHead, manualRow);

    // ── Import draft ──
    if (draft.importDraft) {
      const importBlock = document.createElement("div");
      importBlock.className = "provider-modal-import-block";
      const importHead = document.createElement("div");
      importHead.className = "provider-modal-import-head";
      const importHeadInfo = document.createElement("div");
      const importStrong = document.createElement("strong");
      importStrong.textContent = `发现 ${draft.importDraft.models.length} 个新模型`;
      const importSmall = document.createElement("small");
      importSmall.textContent = "勾选只是选择，点确定后才添加并启用。";
      importHeadInfo.append(importStrong, importSmall);
      const importActions = document.createElement("div");
      importActions.className = "settings-row-actions";
      const importCancelBtn = document.createElement("button");
      importCancelBtn.type = "button";
      importCancelBtn.className = "btn btn-ghost";
      importCancelBtn.dataset.modalImportDismiss = "";
      importCancelBtn.textContent = "取消";
      const importConfirmBtn = document.createElement("button");
      importConfirmBtn.type = "button";
      importConfirmBtn.className = "btn btn-primary";
      importConfirmBtn.dataset.modalImportApply = "";
      importConfirmBtn.disabled = draft.importDraft.selectedIds.size === 0;
      importConfirmBtn.textContent = "确定";
      importActions.append(importCancelBtn, importConfirmBtn);
      importHead.append(importHeadInfo, importActions);
      const importList = document.createElement("div");
      importList.className = "provider-modal-import-list scrollbar-thin";
      draft.importDraft.models.forEach((model) => {
        const item = document.createElement("label");
        item.className = "provider-modal-import-item";
        const itemCheck = document.createElement("input");
        itemCheck.type = "checkbox";
        itemCheck.checked = draft.importDraft.selectedIds.has(model.id);
        itemCheck.dataset.modalImportToggle = model.id;
        const itemLabel = document.createElement("span");
        itemLabel.textContent = model.label || model.id;
        item.append(itemCheck, itemLabel);
        importList.append(item);
      });
      importBlock.append(importHead, importList);
      modelSection.append(importBlock);
    }

    // ── Model list ──
    if (draft.models.length > 0) {
      const modelList = document.createElement("div");
      modelList.className = "provider-modal-model-list scrollbar-thin";
      draft.models.forEach((model) => {
        const isDefault = draft.defaultModelId === model.id;
        const row = document.createElement("div");
        row.className = "provider-modal-model-row";
        const rowHead = document.createElement("div");
        rowHead.className = "provider-modal-model-row-head";
        const defaultLabel = document.createElement("label");
        defaultLabel.className = "provider-model-default";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "modal-default-model";
        radio.checked = isDefault;
        radio.dataset.modalModelDefault = model.id;
        const modelStrong = document.createElement("strong");
        modelStrong.textContent = model.label || model.id;
        defaultLabel.append(radio, modelStrong);
        if (isDefault) {
          const badge = document.createElement("span");
          badge.className = "default";
          badge.textContent = "默认";
          defaultLabel.append(badge);
        }
        const rowState = document.createElement("div");
        rowState.className = "provider-modal-model-row-state";
        const toggleLabel = document.createElement("label");
        toggleLabel.className = "settings-inline-check";
        const toggleInput = document.createElement("input");
        toggleInput.type = "checkbox";
        toggleInput.checked = model.enabled;
        toggleInput.dataset.modalModelToggle = model.id;
        toggleLabel.append(toggleInput, document.createTextNode("启用"));
        const testModelBtn = document.createElement("button");
        testModelBtn.className = "icon-button";
        testModelBtn.type = "button";
        testModelBtn.dataset.modalModelTest = model.id;
        testModelBtn.title = "发送探测消息";
        testModelBtn.append(icon("plugZap"));
        const delModelBtn = document.createElement("button");
        delModelBtn.className = "icon-button";
        delModelBtn.type = "button";
        delModelBtn.dataset.modalModelRemove = model.id;
        delModelBtn.title = "移除";
        delModelBtn.append(icon("trash2"));
        rowState.append(toggleLabel, testModelBtn, delModelBtn);
        rowHead.append(defaultLabel, rowState);
        const configGrid = document.createElement("div");
        configGrid.className = "provider-modal-config-grid";
        const ctxLabel = document.createElement("label");
        ctxLabel.className = "provider-modal-config-field";
        const ctxSpan = document.createElement("span");
        ctxSpan.textContent = "上下文窗口";
        const ctxInput = document.createElement("input");
        ctxInput.type = "number";
        ctxInput.value = model.contextWindowTokens ?? "";
        ctxInput.placeholder = "例如 1000000";
        ctxInput.dataset.modalModelContext = model.id;
        ctxLabel.append(ctxSpan, ctxInput);
        const maxLabel = document.createElement("label");
        maxLabel.className = "provider-modal-config-field";
        const maxSpan = document.createElement("span");
        maxSpan.textContent = "最大输出";
        const maxInput = document.createElement("input");
        maxInput.type = "number";
        maxInput.value = model.maxOutputTokens ?? "";
        maxInput.placeholder = "例如 384000";
        maxInput.dataset.modalModelMaxTokens = model.id;
        maxLabel.append(maxSpan, maxInput);
        const visCheck = document.createElement("label");
        visCheck.className = "settings-inline-check";
        const visInput = document.createElement("input");
        visInput.type = "checkbox";
        visInput.checked = model.supportsVision;
        visInput.dataset.modalModelVision = model.id;
        visCheck.append(visInput, document.createTextNode("视觉"));
        const thinkCheck = document.createElement("label");
        thinkCheck.className = "settings-inline-check";
        const thinkInput = document.createElement("input");
        thinkInput.type = "checkbox";
        thinkInput.checked = model.supportsThinking;
        thinkInput.dataset.modalModelThinking = model.id;
        thinkCheck.append(thinkInput, document.createTextNode("思考"));
        configGrid.append(ctxLabel, maxLabel, visCheck, thinkCheck);
        row.append(rowHead, configGrid);
        modelList.append(row);
      });
      modelSection.append(modelList);
    } else {
      const emptyHint = document.createElement("p");
      emptyHint.className = "provider-modal-empty-hint";
      emptyHint.textContent = "还没有模型。获取模型或手动添加一个。";
      modelSection.append(emptyHint);
    }
    body.append(modelSection);

    // ── Footer ──
    const foot = document.createElement("div");
    foot.className = "provider-modal-foot";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.type = "button";
    cancelBtn.dataset.providerModalClose = "";
    cancelBtn.textContent = "取消";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn btn-primary";
    confirmBtn.type = "button";
    confirmBtn.dataset.providerModalConfirm = "";
    confirmBtn.disabled = draft.models.length === 0;
    confirmBtn.title = draft.models.length === 0 ? "先添加至少一个模型" : "确认添加模型";
    confirmBtn.append(icon("check"), document.createTextNode("确定"));
    foot.append(cancelBtn, confirmBtn);

    card.append(head, body, foot);
    overlay.append(card);
  }

  function renderProviderDetailModal() {
    let overlay = document.querySelector(".provider-detail-overlay");
    if (!state.detailProviderId) {
      if (overlay) overlay.remove();
      return;
    }
    const provider = findProvider(state.detailProviderId);
    if (!provider) {
      if (overlay) overlay.remove();
      return;
    }
    const isNew = state.newProviderId === provider.id;
    const isApiKeyVisible = state.visibleApiKeyProviderIds.has(provider.id);
    const isFetchingModels = state.fetchingModelIds.has(provider.id);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "provider-detail-overlay";
      document.body.append(overlay);
    }
    overlay.innerHTML = "";
    const card = document.createElement("div");
    card.className = "provider-detail-card";
    const head = document.createElement("div");
    head.className = "provider-modal-head";
    const headTitle = document.createElement("div");
    headTitle.className = "provider-modal-head-title";
    const title = document.createElement("strong");
    title.textContent = provider.name || "未命名供应商";
    const titleSmall = document.createElement("small");
    if (provider.kind === "builtin") {
      titleSmall.textContent = "内置供应商 · 自动适配运行时协议";
    } else {
      const epCount = provider.endpoints ? provider.endpoints.length : 0;
      titleSmall.textContent = `${epCount} 个端点 · ${provider.models.length} 个模型`;
    }
    headTitle.append(title, titleSmall);
    const closeBtn = document.createElement("button");
    closeBtn.className = "icon-button provider-modal-close";
    closeBtn.type = "button";
    closeBtn.dataset.providerDetailClose = "";
    closeBtn.title = "关闭";
    closeBtn.append(icon("x"));
    head.append(headTitle, closeBtn);
    const body = document.createElement("div");
    body.className = "provider-modal-body scrollbar-thin";
        const fieldsGrid = document.createElement("div");
        fieldsGrid.className = "provider-fields-grid";
        if (provider.kind === "builtin") {
          const summary = document.createElement("div");
          summary.className = "provider-builtin-summary provider-field-wide";
          const sStrong = document.createElement("strong");
          sStrong.textContent = provider.name;
          const sSpan = document.createElement("span");
          sSpan.textContent =
            "内置地址由 Marloues 维护，当前运行时会自动选择可用协议；地址不可查看或修改。";
          summary.append(sStrong, sSpan);
          fieldsGrid.append(summary);
        } else {
          const nameLabel = document.createElement("label");
          nameLabel.className = "provider-field-wide";
          nameLabel.textContent = "供应商名称";
          const nameInput = document.createElement("input");
          nameInput.value = provider.name;
          nameInput.placeholder = "供应商名称";
          nameInput.dataset.providerName = provider.id;
          nameLabel.append(nameInput);
          fieldsGrid.append(nameLabel);
        }
        const keyLabel = document.createElement("label");
        keyLabel.className = "provider-field-wide";
        keyLabel.textContent = "API Key";
        const keyWrap = document.createElement("div");
        keyWrap.className = "api-key-input-wrap";
        const keyInput = document.createElement("input");
        keyInput.type = isApiKeyVisible ? "text" : "password";
        keyInput.value = provider.apiKey || "";
        keyInput.placeholder = "sk-...";
        keyInput.dataset.providerKey = provider.id;
        const keyBtn = document.createElement("button");
        keyBtn.className = "icon-button api-key-visibility-button";
        keyBtn.type = "button";
        keyBtn.dataset.providerKeyToggle = provider.id;
        keyBtn.title = isApiKeyVisible ? "隐藏 API 密钥" : "查看 API 密钥";
        keyBtn.append(icon(isApiKeyVisible ? "eyeOff" : "eye"));
        keyWrap.append(keyInput, keyBtn);
        keyLabel.append(keyWrap);
        fieldsGrid.append(keyLabel);
        body.append(fieldsGrid);
        if (provider.kind === "custom" && provider.endpoints) {
          const epSection = document.createElement("div");
          epSection.className = "provider-endpoint-section";
          const epHead = document.createElement("div");
          epHead.className = "provider-model-section-head";
          const epHeadSpan = document.createElement("span");
          epHeadSpan.textContent = "模型端点";
          const epHeadActions = document.createElement("div");
          epHeadActions.className = "settings-row-actions";
          const addEpBtn = document.createElement("button");
          addEpBtn.type = "button";
          addEpBtn.className = "btn btn-ghost";
          addEpBtn.dataset.providerAddEndpoint = provider.id;
          addEpBtn.append(icon("plus"), document.createTextNode("添加端点"));
          epHeadActions.append(addEpBtn);
          epHead.append(epHeadSpan, epHeadActions);
          const epList = document.createElement("div");
          epList.className = "provider-endpoint-list";
          provider.endpoints.forEach((endpoint, index) => {
            const epCheckId = `${provider.id}:${endpoint.id}`;
            const isEpChecking = state.checkingEndpointIds.has(epCheckId);
            const isEpExpanded = state.expandedEndpointIds.has(epCheckId);
            const epRow = document.createElement("div");
            epRow.className = "provider-endpoint-row";
            if (isEpExpanded) epRow.classList.add("expanded");
            const epHeadRow = document.createElement("div");
            epHeadRow.className = "provider-endpoint-head";
            const epToggleBtn = document.createElement("button");
            epToggleBtn.type = "button";
            epToggleBtn.className = "provider-endpoint-toggle";
            epToggleBtn.dataset.providerEndpointExpand = epCheckId;
            epToggleBtn.title = isEpExpanded ? "收起端点" : "展开端点";
            epToggleBtn.append(icon(isEpExpanded ? "chevronDown" : "chevronRight"));
            const epCheckLabel = document.createElement("label");
            epCheckLabel.className = "settings-inline-check";
            const epCheckInput = document.createElement("input");
            epCheckInput.type = "checkbox";
            epCheckInput.checked = endpoint.enabled;
            epCheckInput.dataset.providerEndpointToggle = epCheckId;
            epCheckLabel.append(epCheckInput, document.createTextNode(`端点 ${index + 1}`));
            const epSummary = document.createElement("span");
            epSummary.className = "provider-endpoint-summary";
            const epProtoOpt = endpointProtocolOptions.find((o) => o.value === endpoint.protocol);
            epSummary.textContent = `${epProtoOpt ? epProtoOpt.label : endpoint.protocol} · ${endpoint.baseUrl}`;
            const epActions = document.createElement("div");
            epActions.className = "settings-row-actions";
            const epTestBtn = document.createElement("button");
            epTestBtn.className = "icon-button";
            epTestBtn.type = "button";
            epTestBtn.dataset.providerEndpointTest = epCheckId;
            epTestBtn.disabled = isEpChecking;
            epTestBtn.title = isEpChecking ? "测试中" : "测试端点";
            epTestBtn.append(icon(isEpChecking ? "refreshCcw" : "plugZap"));
            const epDelBtn = document.createElement("button");
            epDelBtn.className = "icon-button";
            epDelBtn.type = "button";
            epDelBtn.dataset.providerEndpointRemove = epCheckId;
            epDelBtn.title = "删除端点";
            epDelBtn.append(icon("trash2"));
            epActions.append(epTestBtn, epDelBtn);
            const epInfo = document.createElement("div");
            epInfo.className = "provider-endpoint-info";
            epInfo.append(epToggleBtn, epCheckLabel, epSummary);
            epHeadRow.append(epInfo, epActions);
            epRow.append(epHeadRow);
            if (isEpExpanded) {
              const epFields = document.createElement("div");
              epFields.className = "provider-endpoint-fields";
              const protoLabel = document.createElement("label");
              const protoSpan = document.createElement("span");
              protoSpan.textContent = "协议";
              const protoSelectId = `ep-proto/${epCheckId}`;
              selectOptions[protoSelectId] = endpointProtocolOptions.map((o) => ({ value: o.value, label: o.label }));
              state.selectValues[protoSelectId] = endpoint.protocol;
              const protoSelectWrap = document.createElement("div");
              protoSelectWrap.className = "settings-select";
              protoSelectWrap.dataset.selectId = protoSelectId;
              const protoTrigger = document.createElement("button");
              protoTrigger.type = "button";
              protoTrigger.className = "settings-select-trigger";
              protoTrigger.setAttribute("aria-haspopup", "listbox");
              protoTrigger.setAttribute("aria-expanded", "false");
              const protoValue = document.createElement("span");
              protoValue.className = "settings-select-value";
              const protoOpt = endpointProtocolOptions.find((o) => o.value === endpoint.protocol);
              protoValue.textContent = protoOpt ? protoOpt.label : endpoint.protocol;
              protoTrigger.append(protoValue, icon("chevronDown"));
              protoSelectWrap.append(protoTrigger);
              protoLabel.append(protoSpan, protoSelectWrap);
              const prioLabel = document.createElement("label");
              prioLabel.textContent = "优先级";
              const prioInput = document.createElement("input");
              prioInput.type = "number";
              prioInput.value = endpoint.priority;
              prioInput.min = 1;
              prioInput.dataset.providerEndpointPriority = epCheckId;
              prioLabel.append(prioInput);
              const urlLabel = document.createElement("label");
              urlLabel.className = "provider-endpoint-url";
              urlLabel.textContent = "Base URL";
              const urlInput = document.createElement("input");
              urlInput.type = "text";
              urlInput.value = endpoint.baseUrl;
              urlInput.placeholder = "https://api.example.com/v1";
              urlInput.dataset.providerEndpointUrl = epCheckId;
              urlLabel.append(urlInput);
              epFields.append(protoLabel, prioLabel, urlLabel);
              epRow.append(epFields);
            }
            epList.append(epRow);
          });
          epSection.append(epHead, epList);
          body.append(epSection);
        }
        const modelSection = document.createElement("div");
        modelSection.className = "provider-model-section";
        const modelHead = document.createElement("div");
        modelHead.className = "provider-model-section-head";
        const modelHeadSpan = document.createElement("span");
        modelHeadSpan.textContent = `模型（${provider.models.length}）`;
        const modelHeadActions = document.createElement("div");
        modelHeadActions.className = "settings-row-actions";
        const fetchBtn = document.createElement("button");
        fetchBtn.type = "button";
        fetchBtn.className = "btn btn-ghost";
        fetchBtn.dataset.providerFetch = provider.id;
        fetchBtn.disabled = isFetchingModels;
        fetchBtn.append(icon(isFetchingModels ? "refreshCcw" : "bot"), document.createTextNode(isFetchingModels ? "获取中…" : "获取模型"));
        modelHeadActions.append(fetchBtn);
        modelHead.append(modelHeadSpan, modelHeadActions);
        let importBlock = null;
        if (state.modelImportDraft && state.modelImportDraft.providerId === provider.id) {
          importBlock = document.createElement("div");
          importBlock.className = "provider-modal-import-block";
          const importHead = document.createElement("div");
          importHead.className = "provider-modal-import-head";
          const importHeadInfo = document.createElement("div");
          const importStrong = document.createElement("strong");
          importStrong.textContent = `发现 ${state.modelImportDraft.models.length} 个新模型`;
          const importSmall = document.createElement("small");
          importSmall.textContent = "勾选只是选择，点确定后才添加并启用。";
          importHeadInfo.append(importStrong, importSmall);
          const importActions = document.createElement("div");
          importActions.className = "settings-row-actions";
          const importCancelBtn = document.createElement("button");
          importCancelBtn.type = "button";
          importCancelBtn.className = "btn btn-ghost";
          importCancelBtn.dataset.modelImportDismiss = "";
          importCancelBtn.textContent = "取消";
          const importConfirmBtn = document.createElement("button");
          importConfirmBtn.type = "button";
          importConfirmBtn.className = "btn btn-primary";
          importConfirmBtn.dataset.modelImportApply = "";
          importConfirmBtn.disabled = state.modelImportDraft.selectedIds.size === 0;
          importConfirmBtn.textContent = "确定";
          importActions.append(importCancelBtn, importConfirmBtn);
          importHead.append(importHeadInfo, importActions);
          const importList = document.createElement("div");
          importList.className = "provider-modal-import-list scrollbar-thin";
          state.modelImportDraft.models.forEach((model) => {
            const item = document.createElement("label");
            item.className = "provider-modal-import-item";
            const itemCheck = document.createElement("input");
            itemCheck.type = "checkbox";
            itemCheck.checked = state.modelImportDraft.selectedIds.has(model.id);
            itemCheck.dataset.modelImportToggle = model.id;
            const itemLabel = document.createElement("span");
            itemLabel.textContent = model.label || model.id;
            item.append(itemCheck, itemLabel);
            importList.append(item);
          });
          importBlock.append(importHead, importList);
        }
        const modelList = document.createElement("div");
        modelList.className = "provider-model-list";
        provider.models.forEach((model) => {
          const isDefault = state.defaultModel.providerId === provider.id && state.defaultModel.modelId === model.id;
          const isChecking = state.checkingModelIds.has(`${provider.id}:${model.id}`);
          const card = document.createElement("div");
          card.className = "provider-model-card";
          if (!model.enabled) card.classList.add("disabled");
          const main = document.createElement("div");
          main.className = "provider-model-main";
          const titleLine = document.createElement("div");
          titleLine.className = "provider-model-title-line";
          const defaultLabel = document.createElement("label");
          defaultLabel.className = "provider-model-default";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `default-model-${provider.id}`;
          radio.checked = isDefault;
          radio.dataset.providerModelDefault = `${provider.id}:${model.id}`;
          defaultLabel.append(radio);
          const modelStrong = document.createElement("strong");
          modelStrong.textContent = model.label || model.id;
          defaultLabel.append(modelStrong);
          titleLine.append(defaultLabel);
          if (isDefault) {
            const badge = document.createElement("span");
            badge.className = "default";
            badge.textContent = "默认";
            titleLine.append(badge);
          }
          const enBadge = document.createElement("span");
          enBadge.className = model.enabled ? "enabled" : "disabled";
          enBadge.textContent = model.enabled ? "已启用" : "已禁用";
          titleLine.append(enBadge);
          if (model.supportsVision) {
            const visBadge = document.createElement("span");
            visBadge.textContent = "Vision";
            titleLine.append(visBadge);
          }
          if (model.supportsThinking) {
            const thinkBadge = document.createElement("span");
            thinkBadge.textContent = "Thinking";
            titleLine.append(thinkBadge);
          }
          main.append(titleLine);
          const configGrid = document.createElement("div");
          configGrid.className = "provider-model-config-grid";
          const ctxLabel = document.createElement("label");
          const ctxSpan = document.createElement("span");
          ctxSpan.textContent = "上下文窗口";
          const ctxInput = document.createElement("input");
          ctxInput.type = "number";
          ctxInput.value = model.contextWindowTokens || "";
          ctxInput.placeholder = "—";
          ctxInput.dataset.providerModelContext = `${provider.id}:${model.id}`;
          ctxLabel.append(ctxSpan, ctxInput);
          const maxLabel = document.createElement("label");
          const maxSpan = document.createElement("span");
          maxSpan.textContent = "最大输出";
          const maxInput = document.createElement("input");
          maxInput.type = "number";
          maxInput.value = model.maxOutputTokens || "";
          maxInput.placeholder = "—";
          maxInput.dataset.providerModelMaxTokens = `${provider.id}:${model.id}`;
          maxLabel.append(maxSpan, maxInput);
          const visLabel = document.createElement("label");
          visLabel.className = "settings-inline-check";
          const visInput = document.createElement("input");
          visInput.type = "checkbox";
          visInput.checked = model.supportsVision;
          visInput.dataset.providerModelVision = `${provider.id}:${model.id}`;
          visLabel.append(visInput, document.createTextNode("视觉"));
          const thinkLabel = document.createElement("label");
          thinkLabel.className = "settings-inline-check";
          const thinkInput = document.createElement("input");
          thinkInput.type = "checkbox";
          thinkInput.checked = model.supportsThinking;
          thinkInput.dataset.providerModelThinking = `${provider.id}:${model.id}`;
          thinkLabel.append(thinkInput, document.createTextNode("思考中"));
          configGrid.append(ctxLabel, maxLabel, visLabel, thinkLabel);
          main.append(configGrid);
          const actions = document.createElement("div");
          actions.className = "provider-model-actions";
          const toggleLabel = document.createElement("label");
          toggleLabel.className = "settings-inline-check";
          const toggleInput = document.createElement("input");
          toggleInput.type = "checkbox";
          toggleInput.checked = model.enabled;
          toggleInput.dataset.providerModelToggle = `${provider.id}:${model.id}`;
          toggleLabel.append(toggleInput, document.createTextNode("启用"));
          const testModelBtn = document.createElement("button");
          testModelBtn.className = "icon-button";
          testModelBtn.type = "button";
          testModelBtn.dataset.providerModelTest = `${provider.id}:${model.id}`;
          testModelBtn.disabled = isChecking;
          testModelBtn.title = isChecking ? "探测中" : "探测模型";
          testModelBtn.append(icon(isChecking ? "refreshCcw" : "plugZap"));
          const delModelBtn = document.createElement("button");
          delModelBtn.className = "icon-button";
          delModelBtn.type = "button";
          delModelBtn.dataset.providerModelRemove = `${provider.id}:${model.id}`;
          delModelBtn.title = "删除模型";
          delModelBtn.append(icon("trash2"));
          actions.append(toggleLabel, testModelBtn, delModelBtn);
          card.append(main, actions);
          modelList.append(card);
        });
        const manualDiv = document.createElement("div");
        manualDiv.className = "provider-model-manual";
        const manualInput = document.createElement("input");
        manualInput.type = "text";
        manualInput.placeholder = "输入模型 ID，例如 gpt-4o-mini";
        manualInput.dataset.manualModelInput = provider.id;
        const manualAddBtn = document.createElement("button");
        manualAddBtn.className = "btn btn-ghost";
        manualAddBtn.type = "button";
        manualAddBtn.dataset.manualModelConfirm = provider.id;
        manualAddBtn.append(icon("plus"), document.createTextNode("添加"));
        manualDiv.append(manualInput, manualAddBtn);
        if (importBlock) modelSection.append(modelHead, manualDiv, importBlock, modelList);
        else modelSection.append(modelHead, manualDiv, modelList);
        body.append(modelSection);
        if (isNew) {
          const draftPanel = document.createElement("div");
          draftPanel.className = "provider-draft-panel";
          const draftActions = document.createElement("div");
          draftActions.className = "provider-draft-actions";
          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.dataset.providerDraftCancel = provider.id;
          cancelBtn.textContent = "取消";
          const confirmBtn = document.createElement("button");
          confirmBtn.type = "button";
          confirmBtn.className = "primary";
          confirmBtn.dataset.providerDraftConfirm = provider.id;
          confirmBtn.textContent = "确认添加";
          draftActions.append(cancelBtn, confirmBtn);
          draftPanel.append(draftActions);
          body.append(draftPanel);
        }
    card.append(head, body);
    overlay.append(card);
  }

  function renderProviders() {
    const statsEl = document.querySelector("[data-provider-stats]");
    const listEl = document.querySelector("[data-provider-list]");
    if (!listEl) return;
    const providers = state.providers;
    const enabledModels = providers.reduce(
      (c, p) => c + p.models.filter((m) => m.enabled).length,
      0,
    );
    const totalModels = providers.reduce((c, p) => c + p.models.length, 0);
    if (statsEl) {
      statsEl.innerHTML = "";
      const stats = [
        { label: "供应商", value: String(providers.length) },
        { label: "启用模型", value: `${enabledModels}/${totalModels}` },
        { label: "可用模型", value: String(enabledModels) },
      ];
      stats.forEach((s) => {
        const card = document.createElement("div");
        card.className = "settings-stat-card";
        const sm = document.createElement("small");
        sm.textContent = s.label;
        const st = document.createElement("strong");
        st.textContent = s.value;
        card.append(sm, st);
        statsEl.append(card);
      });
    }
    listEl.innerHTML = "";
    if (providers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-empty-state";
      const st = document.createElement("strong");
      st.textContent = "还没有配置任何供应商";
      const p = document.createElement("p");
      p.textContent = "先添加供应商和模型，运行时会自动选择兼容的协议端点。";
      empty.append(st, p);
      listEl.append(empty);
      return;
    }
    providers.forEach((provider) => {
      const isNew = state.newProviderId === provider.id;
      const isApiKeyVisible = state.visibleApiKeyProviderIds.has(provider.id);
      const isCheckingEndpoint = state.checkingEndpointIds.has(provider.id);
      const isFetchingModels = state.fetchingModelIds.has(provider.id);
      const row = document.createElement("div");
      row.className = "provider-row";
      if (isNew) row.classList.add("draft");
      const head = document.createElement("div");
      head.className = "provider-row-head";
      head.dataset.providerDetail = provider.id;
      const titleDiv = document.createElement("div");
      titleDiv.className = "provider-row-title";
      const nameDiv = document.createElement("div");
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = provider.name || "未命名模型";
      nameDiv.append(nameStrong);
      const descSmall = document.createElement("small");
      if (provider.kind === "builtin") {
        descSmall.textContent = `内置供应商 · 自动适配运行时 · ${provider.models.length} 个模型`;
      } else {
        const epCount = provider.endpoints ? provider.endpoints.length : 0;
        descSmall.textContent = `${epCount} 个端点 · ${provider.models.length} 个模型（已启用 ${provider.models.filter((m) => m.enabled).length} 个）`;
      }
      titleDiv.append(nameDiv, descSmall);
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "settings-row-actions provider-actions";
      const enableLabel = document.createElement("label");
      enableLabel.className = "settings-inline-check provider-enable-check";
      enableLabel.title = provider.enabled ? "供应商已启用" : "供应商已禁用";
      const enableInput = document.createElement("input");
      enableInput.type = "checkbox";
      enableInput.checked = provider.enabled;
      enableInput.dataset.providerToggle = provider.id;
      enableLabel.append(enableInput, document.createTextNode("启用"));
      const testBtn = document.createElement("button");
      testBtn.className = "icon-button";
      testBtn.type = "button";
      testBtn.dataset.providerTest = provider.id;
      testBtn.disabled = isCheckingEndpoint;
      testBtn.title = isCheckingEndpoint ? "测试中" : "测试连接";
      testBtn.append(icon(isCheckingEndpoint ? "refreshCcw" : "plugZap"));
      const delBtn = document.createElement("button");
      delBtn.className = "icon-button";
      delBtn.type = "button";
      delBtn.dataset.providerRemove = provider.id;
      delBtn.title = "删除供应商";
      delBtn.append(icon("trash2"));
      actionsDiv.append(enableLabel, testBtn, delBtn);
      head.append(titleDiv, actionsDiv);
      row.append(head);
      listEl.append(row);
    });
  }

  function renderSecurityLists() {
    const secPane = document.querySelector('[data-pane="security"]');
    if (!secPane) return;
    const cards = secPane.querySelectorAll(".settings-card");
    cards.forEach((card) => {
      const fields = card.querySelector(".settings-fields");
      if (!fields) return;
      const titleEl = card.querySelector(".settings-card-title h2");
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      let groupKey = null;
      if (title.includes("文件安全")) {
        groupKey = "auto-allow-paths";
      } else if (title.includes("命令安全")) {
        groupKey = "allow-commands";
      } else if (title.includes("网络安全")) {
        groupKey = "allowed-domains";
      }
    if (!groupKey) return;
    fields.querySelectorAll(".settings-field--textarea, .security-item-group, .security-builtins-field").forEach((el) => el.remove());
    if (groupKey === "auto-allow-paths") {
      fields.append(buildSecurityGroup("auto-allow-paths", "自动放行路径"));
      fields.append(buildSecurityGroup("protected-paths", "强制审批路径"));
      const builtinsField = document.createElement("div");
      builtinsField.className = "settings-field security-builtins-field";
      const builtinsLabel = document.createElement("span");
      builtinsLabel.textContent = "内置保护路径";
      const builtinsDiv = document.createElement("div");
      builtinsDiv.className = "security-builtins";
      ["~/.ssh", "~/.aws", "~/.azure", "~/.kube", "~/.gnupg", ".git", ".marloues"].forEach((p) => {
        const code = document.createElement("code");
        code.textContent = p;
        builtinsDiv.append(code);
      });
      builtinsField.append(builtinsLabel, builtinsDiv);
      fields.append(builtinsField);
    } else if (groupKey === "allow-commands") {
      fields.append(buildSecurityGroup("allow-commands", "放行命令"));
      fields.append(buildSecurityGroup("ask-commands", "询问命令"));
    } else if (groupKey === "allowed-domains") {
      fields.append(buildSecurityGroup("allowed-domains", "允许域名"));
      fields.append(buildSecurityGroup("denied-domains", "拒绝域名"));
    }
  });
}

  function buildSecurityGroup(groupKey, label) {
    const config = securityConfig[groupKey];
    if (!config) return document.createElement("div");
    const isExpanded = state.expandedSecurityGroups.has(groupKey);
    const items = state.securityItems[groupKey] || [];
    const group = document.createElement("div");
    group.className = "security-item-group";
    if (!isExpanded) group.classList.add("collapsed");
    group.dataset.securityGroup = groupKey;
    const head = document.createElement("div");
    head.className = "security-group-head";
    const expandBtn = document.createElement("button");
    expandBtn.className = "security-group-toggle";
    expandBtn.type = "button";
    expandBtn.dataset.securityToggle = groupKey;
    expandBtn.append(icon(isExpanded ? "chevronDown" : "chevronRight"));
    const headLabel = document.createElement("span");
    headLabel.className = "security-group-label";
    headLabel.textContent = label;
    const countBadge = document.createElement("span");
    countBadge.className = "security-group-count";
    countBadge.textContent = String(items.length);
    head.append(expandBtn, headLabel, countBadge);
    if (isExpanded) {
      const inputRow = document.createElement("div");
      inputRow.className = "security-item-input-row";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = config.placeholder;
      input.value = state.securityInputDrafts[groupKey] || "";
      input.dataset.securityInput = groupKey;
      const addBtn = document.createElement("button");
      addBtn.className = "btn btn-ghost";
      addBtn.type = "button";
      addBtn.dataset.securityAdd = groupKey;
      addBtn.append(icon("plus"), document.createTextNode("添加"));
      inputRow.append(input, addBtn);
      const list = document.createElement("div");
      list.className = "security-item-list";
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "security-item-empty";
        empty.textContent = "暂无规则，在上方输入后点击添加";
        list.append(empty);
      } else {
        items.forEach((item, index) => {
          const itemRow = document.createElement("div");
          itemRow.className = "security-item-row";
          const itemCode = document.createElement("code");
          itemCode.title = item;
          const itemIcon = document.createElement("span");
          itemIcon.className = "security-item-icon";
          itemIcon.append(icon(config.icon));
          const itemText = document.createElement("span");
          itemText.className = "security-item-text";
          itemText.textContent = item;
          itemCode.append(itemIcon, itemText);
          const removeBtn = document.createElement("button");
          removeBtn.className = "icon-button security-item-remove";
          removeBtn.type = "button";
          removeBtn.dataset.securityRemove = `${groupKey}:${index}`;
          removeBtn.title = "移除";
          removeBtn.append(icon("x"));
          itemRow.append(itemCode, removeBtn);
          list.append(itemRow);
        });
      }
      group.append(head, inputRow, list);
    } else {
      group.append(head);
    }
    return group;
  }

  function addSecurityItem(groupKey) {
    const value = (state.securityInputDrafts[groupKey] || "").trim();
    if (!value) {
      showToast("请输入内容后再添加");
      return;
    }
    if (!state.securityItems[groupKey]) state.securityItems[groupKey] = [];
    if (state.securityItems[groupKey].includes(value)) {
      showToast("该规则已存在");
      return;
    }
    state.securityItems[groupKey].push(value);
    state.securityInputDrafts[groupKey] = "";
    render();
    const input = document.querySelector(`[data-security-input="${groupKey}"]`);
    if (input) input.focus();
    showToast("已添加规则");
  }

  function removeSecurityItem(groupKey, index) {
    if (!state.securityItems[groupKey]) return;
    state.securityItems[groupKey].splice(index, 1);
    render();
    showToast("已移除规则");
  }

  function toggleSecurityGroup(groupKey) {
    if (state.expandedSecurityGroups.has(groupKey)) state.expandedSecurityGroups.delete(groupKey);
    else state.expandedSecurityGroups.add(groupKey);
    render();
  }

  function renderBots() {
    const botPane = document.querySelector('[data-pane="im-bots"]');
    if (!botPane) return;
    const statGrid = botPane.querySelector(".settings-stat-grid");
    const bots = state.bots;
    const enabledCount = bots.filter((b) => b.enabled).length;
    const inputCount = enabledCount;
    const notifyCount = enabledCount;
    if (statGrid) {
      statGrid.innerHTML = "";
      const stats = [
        { label: "已绑定机器人", value: String(bots.length) },
        { label: "可作为输入", value: String(inputCount) },
        { label: "可接定时通知", value: String(notifyCount) },
      ];
      stats.forEach((s) => {
        const card = document.createElement("div");
        card.className = "settings-stat-card";
        const sm = document.createElement("small");
        sm.textContent = s.label;
        const st = document.createElement("strong");
        st.textContent = s.value;
        card.append(sm, st);
        statGrid.append(card);
      });
    }
    const existingList = botPane.querySelector(".bot-list");
    if (existingList) existingList.remove();
    const existingEmpty = botPane.querySelector(".settings-empty-state");
    if (existingEmpty) existingEmpty.remove();
    if (bots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-empty-state";
      const st = document.createElement("strong");
      st.textContent = "还没有绑定机器人";
      const p = document.createElement("p");
      p.textContent = "在 IM 渠道页选择企微或飞书完成绑定。绑定后，可在这里分别设置工作空间、通知用途和权限策略。";
      empty.append(st, p);
      botPane.append(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "bot-list";
    bots.forEach((bot) => {
      const isExpanded = state.expandedBotIds.has(bot.id);
      const card = document.createElement("div");
      card.className = "bot-card";
      if (!bot.enabled) card.classList.add("disabled");
      const head = document.createElement("div");
      head.className = "bot-card-head";
      const expandBtn = document.createElement("button");
      expandBtn.className = "bot-expand-button";
      expandBtn.type = "button";
      expandBtn.dataset.botExpand = bot.id;
      expandBtn.append(icon(isExpanded ? "chevronDown" : "chevronRight"));
      const info = document.createElement("div");
      info.className = "bot-card-info";
      const nameRow = document.createElement("div");
      nameRow.className = "bot-card-name-row";
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = bot.name;
      const channelBadge = document.createElement("span");
      channelBadge.className = `bot-channel-badge ${bot.channel}`;
      channelBadge.textContent = bot.channelLabel;
      nameRow.append(nameStrong, channelBadge);
      const descSmall = document.createElement("small");
      descSmall.textContent = `${bot.workspace} · ${bot.purpose}`;
      info.append(nameRow, descSmall);
      const actions = document.createElement("div");
      actions.className = "bot-card-actions";
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "settings-inline-check";
      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = bot.enabled;
      toggleInput.dataset.botToggle = bot.id;
      toggleLabel.append(toggleInput, document.createTextNode("启用"));
      const delBtn = document.createElement("button");
      delBtn.className = "icon-button";
      delBtn.type = "button";
      delBtn.dataset.botRemove = bot.id;
      delBtn.title = "删除机器人";
      delBtn.append(icon("trash2"));
      actions.append(toggleLabel, delBtn);
      head.append(expandBtn, info, actions);
      card.append(head);
      if (isExpanded) {
        const detail = document.createElement("div");
        detail.className = "bot-card-detail";
        const rows = [
          { icon: "hash", label: "Chat ID", value: bot.chatId },
          { icon: "user", label: "用户标识", value: bot.userId },
          { icon: "cpu", label: "使用模型", value: bot.model },
          { icon: "clock", label: "最后活跃", value: bot.lastActive },
          { icon: "messageSquare", label: "消息数", value: String(bot.messageCount) },
        ];
        rows.forEach((r) => {
          const row = document.createElement("div");
          row.className = "bot-detail-row";
          const rowIcon = document.createElement("span");
          rowIcon.className = "bot-detail-icon";
          rowIcon.append(icon(r.icon));
          const rowLabel = document.createElement("span");
          rowLabel.className = "bot-detail-label";
          rowLabel.textContent = r.label;
          const rowValue = document.createElement("span");
          rowValue.className = "bot-detail-value";
          rowValue.textContent = r.value;
          row.append(rowIcon, rowLabel, rowValue);
          detail.append(row);
        });
        const permSection = document.createElement("div");
        permSection.className = "bot-permission-section";
        const permLabel = document.createElement("span");
        permLabel.className = "bot-detail-label";
        permLabel.textContent = "工具权限策略";
        const permList = document.createElement("div");
        permList.className = "bot-permission-list";
        bot.permissions.forEach((perm) => {
          const chip = document.createElement("span");
          chip.className = "settings-chip ok";
          chip.append(icon("shieldCheck"));
          chip.append(document.createTextNode(perm));
          permList.append(chip);
        });
        permSection.append(permLabel, permList);
        detail.append(permSection);
        card.append(detail);
      }
      list.append(card);
    });
    botPane.append(list);
  }

  function toggleBotExpanded(id) {
    if (state.expandedBotIds.has(id)) state.expandedBotIds.delete(id);
    else state.expandedBotIds.add(id);
    render();
  }

  function toggleBotEnabled(id, checked) {
    const bot = state.bots.find((b) => b.id === id);
    if (!bot) return;
    bot.enabled = checked;
    render();
    showToast(`${bot.name}已${checked ? "启用" : "禁用"}`);
  }

  function removeBot(id) {
    const bot = state.bots.find((b) => b.id === id);
    if (!bot) return;
    state.bots = state.bots.filter((b) => b.id !== id);
    state.expandedBotIds.delete(id);
    render();
    showToast(`已删除 ${bot.name}`);
  }

 function cssColorToHex(color) {
   const canvas = document.createElement("canvas");
   const ctx = canvas.getContext("2d");
   ctx.fillStyle = color;
   const normalized = ctx.fillStyle;
   if (normalized.startsWith("#")) return normalized;
   const m = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
   if (m) return "#" + [m[1], m[2], m[3]].map((x) => parseInt(x).toString(16).padStart(2, "0")).join("");
   return "#3b9bff";
 }

 function resetAccent() {
   root.style.setProperty("--accent", "");
   root.style.setProperty("--accent-soft", "");
   const colorInput = document.querySelector("[data-accent-color]");
   const customInput = document.querySelector("[data-accent-custom]");
   const swatch = document.querySelector(".appearance-accent-swatch");
   const hexSmall = document.querySelector(".appearance-accent-current small");
   const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#3d9bff";
   const hex = cssColorToHex(accent);
   if (colorInput) colorInput.value = hex;
   if (customInput) customInput.value = "";
   if (swatch) swatch.style.background = accent;
   if (hexSmall) hexSmall.textContent = hex;
   render();
   showToast("已恢复默认强调色");
 }

 function syncAccentDisplay() {
   const colorInput = document.querySelector("[data-accent-color]");
   const swatch = document.querySelector(".appearance-accent-swatch");
   const hexSmall = document.querySelector(".appearance-accent-current small");
   const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#3d9bff";
   const hex = cssColorToHex(accent);
   if (colorInput) colorInput.value = hex;
   if (swatch) swatch.style.background = accent;
   if (hexSmall) hexSmall.textContent = hex;
 }

  function resetAccent() {
    root.style.setProperty("--accent", "");
    root.style.setProperty("--accent-soft", "");
    const customInput = document.querySelector("[data-accent-custom]");
    if (customInput) customInput.value = "";
    syncAccentDisplay();
    render();
    showToast("已恢复默认强调色");
  }

  function applyAccentColor(value) {
    root.style.setProperty("--accent", value);
    root.style.setProperty("--accent-soft", value + "22");
    const swatch = document.querySelector(".appearance-accent-swatch");
    const hexSmall = document.querySelector(".appearance-accent-current small");
    const customInput = document.querySelector("[data-accent-custom]");
    const colorInput = document.querySelector("[data-accent-color]");
    if (swatch) swatch.style.background = value;
    if (hexSmall) hexSmall.textContent = value;
    if (customInput && customInput.value.toLowerCase() !== value.toLowerCase()) customInput.value = value;
    if (colorInput && colorInput.value.toLowerCase() !== value.toLowerCase()) colorInput.value = value;
  }

  function checkUpdate() {
    const panel = document.querySelector("[data-status]");
    if (panel) {
      panel.dataset.status = "checking";
      panel.querySelector("strong").textContent = "正在检查更新…";
      panel.querySelector("small").textContent = "请稍候";
    }
    showToast("正在检查更新…");
    window.setTimeout(() => {
      if (panel) {
        panel.dataset.status = "idle";
        panel.querySelector("strong").textContent = "暂无待处理更新";
        panel.querySelector("small").textContent = "当前没有待处理的更新";
      }
      showToast("当前已是最新版本");
    }, 1500);
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
    state.openSelect = null;
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
    });
    const label = button.querySelector("strong");
    showToast(`已选择「${label ? label.textContent : "选项"}」`);
  }

  function toggleSelect(sid) {
    state.openSelect = state.openSelect === sid ? null : sid;
    render();
  }

  function chooseSelect(sid, value) {
    state.selectValues[sid] = value;
    state.openSelect = null;
    if (sid === "modal-preset" && state.providerModalDraft) {
      state.providerModalDraft.presetId = value;
      state.providerModalDraft.models = [];
      state.providerModalDraft.defaultModelId = null;
      state.providerModalDraft.importDraft = null;
    }
    if (sid.startsWith("modal-ep-proto/")) {
      const epId = sid.slice("modal-ep-proto/".length);
      updateModalEndpoint(epId, { protocol: value });
    }
    if (sid.startsWith("ep-proto/")) {
      const rest = sid.slice("ep-proto/".length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        updateProviderEndpoint(rest.slice(0, colonIdx), rest.slice(colonIdx + 1), { protocol: value });
      }
    }
    render();
    const option = selectOptions[sid] && selectOptions[sid].find((o) => o.value === value);
    showToast(`已选择 ${option ? option.label : value}`);
  }

  function closeSelect() {
    if (!state.openSelect) return;
    state.openSelect = null;
    render();
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

    syncAccentDisplay();

   const reviewing = state.reviewMode === "acceptance";
    if (reviewModeLink) {
      reviewModeLink.classList.toggle("is-active", reviewing);
      reviewModeLink.textContent = reviewing ? "退出验收" : "像素验收";
    }

    renderProviders();
    renderProviderModal();
    renderProviderDetailModal();
    renderSelectMenus();
    renderSecurityLists();
    renderBots();
    syncUrl();
  }

  document.addEventListener("click", (event) => {
    const modalClose = event.target.closest("[data-provider-modal-close]");
    if (modalClose) {
      closeProviderModal();
      return;
    }
    if (state.providerModalOpen) {
      const modalConfirm = event.target.closest("[data-provider-modal-confirm]");
      if (modalConfirm) {
        confirmProviderModal();
        return;
      }
      const overlay = event.target.closest(".provider-modal-overlay");
      if (overlay && event.target === overlay) {
        closeProviderModal();
        return;
      }
      const modalKind = event.target.closest("[data-modal-kind]");
      if (modalKind) {
        setModalKind(modalKind.dataset.modalKind);
        return;
      }
      const modalKeyToggle = event.target.closest("[data-modal-key-toggle]");
      if (modalKeyToggle) {
        toggleModalApiKeyVisible();
        return;
      }
      const modalAddEp = event.target.closest("[data-modal-add-endpoint]");
      if (modalAddEp) {
        addModalEndpoint();
        return;
      }
      const modalEpRemove = event.target.closest("[data-modal-endpoint-remove]");
      if (modalEpRemove) {
        removeModalEndpoint(modalEpRemove.dataset.modalEndpointRemove);
        return;
      }
      const modalEpTest = event.target.closest("[data-modal-endpoint-test]");
      if (modalEpTest) {
        showToast("正在测试端点连接…");
        return;
      }
      const modalFetch = event.target.closest("[data-modal-fetch]");
      if (modalFetch) {
        fetchModalModels();
        return;
      }
      const modalTest = event.target.closest("[data-modal-test]");
      if (modalTest) {
        testModalProvider();
        return;
      }
      const modalManualAdd = event.target.closest("[data-modal-manual-add]");
      if (modalManualAdd) {
        addModalManualModel();
        return;
      }
      const modalModelRemove = event.target.closest("[data-modal-model-remove]");
      if (modalModelRemove) {
        removeModalModel(modalModelRemove.dataset.modalModelRemove);
        return;
      }
      const modalModelTest = event.target.closest("[data-modal-model-test]");
      if (modalModelTest) {
        showToast("正在发送探测消息…");
        return;
      }
      const modalImportToggle = event.target.closest("[data-modal-import-toggle]");
      if (modalImportToggle) {
        toggleModalImportSelection(modalImportToggle.dataset.modalImportToggle);
        return;
      }
      const modalImportApply = event.target.closest("[data-modal-import-apply]");
      if (modalImportApply) {
        applyModalImport();
        return;
      }
      const modalImportDismiss = event.target.closest("[data-modal-import-dismiss]");
      if (modalImportDismiss) {
        dismissModalImport();
        return;
      }
      const modalSelectTrigger = event.target.closest(".settings-select-trigger");
      if (modalSelectTrigger) {
        const sel = modalSelectTrigger.closest("[data-select-id]");
        if (sel) toggleSelect(sel.dataset.selectId);
        return;
      }
      const modalSelectOption = event.target.closest("[data-select-value]");
      if (modalSelectOption) {
        const sel = modalSelectOption.closest("[data-select-id]");
        if (sel) chooseSelect(sel.dataset.selectId, modalSelectOption.dataset.selectValue);
        return;
      }
      if (state.openSelect) closeSelect();
      return;
    }

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

    const themeSegment = event.target.closest("[data-segment-theme]");
    if (themeSegment) {
      selectSegment(themeSegment);
      const value = themeSegment.dataset.themeValue;
      if (value === "system") {
        showToast("跟随系统外观（原型展示）");
      } else if (validThemes.includes(value)) {
        setTheme(value);
      }
      return;
    }

    const selectTrigger = event.target.closest(".settings-select-trigger");
    if (selectTrigger) {
      const sel = selectTrigger.closest("[data-select-id]");
      if (sel) toggleSelect(sel.dataset.selectId);
      return;
    }

    const selectOption = event.target.closest("[data-select-value]");
    if (selectOption) {
      const sel = selectOption.closest("[data-select-id]");
      if (sel) chooseSelect(sel.dataset.selectId, selectOption.dataset.selectValue);
      return;
    }

    const providerDetail = event.target.closest("[data-provider-detail]");
    if (providerDetail && !event.target.closest(".provider-actions")) {
      openProviderDetail(providerDetail.dataset.providerDetail);
      return;
    }
    const providerDetailClose = event.target.closest("[data-provider-detail-close]");
    if (providerDetailClose) {
      closeProviderDetail();
      return;
    }
    if (state.detailProviderId) {
      const detailOverlay = event.target.closest(".provider-detail-overlay");
      if (detailOverlay && event.target === detailOverlay) {
        closeProviderDetail();
        return;
      }
    }

    const providerTest = event.target.closest("[data-provider-test]");
    if (providerTest) {
      testProvider(providerTest.dataset.providerTest);
      return;
    }

    const providerRemove = event.target.closest("[data-provider-remove]");
    if (providerRemove) {
      removeProvider(providerRemove.dataset.providerRemove);
      return;
    }

    const providerAdd = event.target.closest("[data-provider-add]");
    if (providerAdd) {
      openProviderModal();
      return;
    }

    const providerKeyToggle = event.target.closest("[data-provider-key-toggle]");
    if (providerKeyToggle) {
      toggleProviderKeyVisibility(providerKeyToggle.dataset.providerKeyToggle);
      return;
    }

    const providerFetch = event.target.closest("[data-provider-fetch]");
    if (providerFetch) {
      fetchProviderModels(providerFetch.dataset.providerFetch);
      return;
    }
    const modelImportToggle = event.target.closest("[data-model-import-toggle]");
    if (modelImportToggle) {
      toggleModelImportSelection(modelImportToggle.dataset.modelImportToggle);
      return;
    }
    const modelImportApply = event.target.closest("[data-model-import-apply]");
    if (modelImportApply) {
      applyModelImport();
      return;
    }
    const modelImportDismiss = event.target.closest("[data-model-import-dismiss]");
    if (modelImportDismiss) {
      dismissModelImport();
      return;
    }
    const endpointExpand = event.target.closest("[data-provider-endpoint-expand]");
    if (endpointExpand) {
      toggleEndpointExpanded(endpointExpand.dataset.providerEndpointExpand);
      return;
    }

    const providerAddModel = event.target.closest("[data-provider-add-model]");
    if (providerAddModel) {
      addProviderModel(providerAddModel.dataset.providerAddModel);
      return;
    }

    const providerAddEndpoint = event.target.closest("[data-provider-add-endpoint]");
    if (providerAddEndpoint) {
      addProviderEndpoint(providerAddEndpoint.dataset.providerAddEndpoint);
      return;
    }

    const providerEndpointTest = event.target.closest("[data-provider-endpoint-test]");
    if (providerEndpointTest) {
      const [pid, eid] = providerEndpointTest.dataset.providerEndpointTest.split(":");
      testProviderEndpoint(pid, eid);
      return;
    }

    const providerEndpointRemove = event.target.closest("[data-provider-endpoint-remove]");
    if (providerEndpointRemove) {
      const [pid, eid] = providerEndpointRemove.dataset.providerEndpointRemove.split(":");
      removeProviderEndpoint(pid, eid);
      return;
    }

    const providerModelTest = event.target.closest("[data-provider-model-test]");
    if (providerModelTest) {
      const [pid, mid] = providerModelTest.dataset.providerModelTest.split(":");
      testProviderModel(pid, mid);
      return;
    }

    const providerModelRemove = event.target.closest("[data-provider-model-remove]");
    if (providerModelRemove) {
      const [pid, mid] = providerModelRemove.dataset.providerModelRemove.split(":");
      removeProviderModel(pid, mid);
      return;
    }

    const manualModelConfirm = event.target.closest("[data-manual-model-confirm]");
    if (manualModelConfirm) {
      applyManualModel(manualModelConfirm.dataset.manualModelConfirm);
      return;
    }

    const providerDraftCancel = event.target.closest("[data-provider-draft-cancel]");
    if (providerDraftCancel) {
      discardNewProviderDraft(providerDraftCancel.dataset.providerDraftCancel);
      return;
    }

    const providerDraftConfirm = event.target.closest("[data-provider-draft-confirm]");
    if (providerDraftConfirm) {
      confirmNewProviderDraft(providerDraftConfirm.dataset.providerDraftConfirm);
      return;
    }

    const securityAdd = event.target.closest("[data-security-add]");
    if (securityAdd) {
      addSecurityItem(securityAdd.dataset.securityAdd);
      return;
    }

    const securityRemove = event.target.closest("[data-security-remove]");
    if (securityRemove) {
      const [gk, idx] = securityRemove.dataset.securityRemove.split(":");
      removeSecurityItem(gk, Number(idx));
      return;
    }

    const securityToggle = event.target.closest("[data-security-toggle]");
    if (securityToggle) {
      toggleSecurityGroup(securityToggle.dataset.securityToggle);
      return;
    }

    const botExpand = event.target.closest("[data-bot-expand]");
    if (botExpand) {
      toggleBotExpanded(botExpand.dataset.botExpand);
      return;
    }

    const botRemove = event.target.closest("[data-bot-remove]");
    if (botRemove) {
      removeBot(botRemove.dataset.botRemove);
      return;
    }

    const accentReset = event.target.closest("[data-accent-reset]");
    if (accentReset) {
      resetAccent();
      return;
    }

    const auditRefresh = event.target.closest("[data-audit-refresh]");
    if (auditRefresh) {
      showToast("正在刷新审计记录…");
      return;
    }

    const auditExport = event.target.closest("[data-audit-export]");
    if (auditExport) {
      showToast("正在导出审计日志…");
      return;
    }

    const auditDiag = event.target.closest("[data-audit-diagnostics]");
    if (auditDiag) {
      showToast("正在导出诊断包…");
      return;
    }

    const imBind = event.target.closest("[data-im-bind]");
    if (imBind) {
      const name = imBind.dataset.imBind === "wecom" ? "企业微信" : "飞书";
      showToast(`正在绑定${name}…`);
      return;
    }

    const versionCheck = event.target.closest("[data-version-check]");
    if (versionCheck) {
      checkUpdate();
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

    if (state.openSelect && !event.target.closest(".settings-select")) {
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

  document.addEventListener("input", (event) => {
    const accentColor = event.target.closest("[data-accent-color]");
    if (accentColor) {
      applyAccentColor(accentColor.value);
      return;
    }
    const accentCustom = event.target.closest("[data-accent-custom]");
    if (accentCustom) {
      const v = accentCustom.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) applyAccentColor(v);
      return;
    }
    const runtimeTurns = event.target.closest("[data-runtime-turns]");
    if (runtimeTurns) {
      showToast(`最大轮次已设为 ${runtimeTurns.value}`);
      return;
    }
    const thinkingTokens = event.target.closest("[data-runtime-thinking-tokens]");
    if (thinkingTokens) {
      showToast(`思考 Token 上限已设为 ${thinkingTokens.value}`);
      return;
    }
    const secTimeout = event.target.closest("[data-sec-timeout]");
    if (secTimeout) {
      const v = Math.max(10, Math.min(3600, Number(secTimeout.value) || 120));
      showToast(`审批超时已设为 ${v} 秒`);
      return;
    }
    const providerName = event.target.closest("[data-provider-name]");
    if (providerName) {
      updateProviderName(providerName.dataset.providerName, providerName.value);
      return;
    }
    const providerKey = event.target.closest("[data-provider-key]");
    if (providerKey) {
      updateProviderKey(providerKey.dataset.providerKey, providerKey.value);
      return;
    }
    const endpointUrl = event.target.closest("[data-provider-endpoint-url]");
    if (endpointUrl) {
      const [pid, eid] = endpointUrl.dataset.providerEndpointUrl.split(":");
      const p = findProvider(pid);
      if (p && p.endpoints) {
        const ep = p.endpoints.find((x) => x.id === eid);
        if (ep) ep.baseUrl = endpointUrl.value;
      }
      return;
    }
    const endpointPrio = event.target.closest("[data-provider-endpoint-priority]");
    if (endpointPrio) {
      const [pid, eid] = endpointPrio.dataset.providerEndpointPriority.split(":");
      const p = findProvider(pid);
      if (p && p.endpoints) {
        const ep = p.endpoints.find((x) => x.id === eid);
        if (ep) ep.priority = Number(endpointPrio.value) || 0;
      }
      return;
    }
    const modelContext = event.target.closest("[data-provider-model-context]");
    if (modelContext) {
      const [pid, mid] = modelContext.dataset.providerModelContext.split(":");
      const p = findProvider(pid);
      if (p) {
        const m = p.models.find((x) => x.id === mid);
        if (m) m.contextWindowTokens = modelContext.value ? Number(modelContext.value) : undefined;
      }
      return;
    }
    const modelMaxTokens = event.target.closest("[data-provider-model-max-tokens]");
    if (modelMaxTokens) {
      const [pid, mid] = modelMaxTokens.dataset.providerModelMaxTokens.split(":");
      const p = findProvider(pid);
      if (p) {
        const m = p.models.find((x) => x.id === mid);
        if (m) m.maxOutputTokens = modelMaxTokens.value ? Number(modelMaxTokens.value) : undefined;
      }
      return;
    }
    const manualInput = event.target.closest("[data-manual-model-input]");
    if (manualInput) {
      return;
    }
    const modalName = event.target.closest("[data-modal-provider-name]");
    if (modalName) {
      setModalName(modalName.value);
      return;
    }
    const modalKey = event.target.closest("[data-modal-provider-key]");
    if (modalKey) {
      setModalApiKeyValue(modalKey.value);
      return;
    }
    const modalEpUrl = event.target.closest("[data-modal-endpoint-url]");
    if (modalEpUrl) {
      updateModalEndpoint(modalEpUrl.dataset.modalEndpointUrl, { baseUrl: modalEpUrl.value });
      return;
    }
    const modalEpPrio = event.target.closest("[data-modal-endpoint-priority]");
    if (modalEpPrio) {
      updateModalEndpoint(modalEpPrio.dataset.modalEndpointPriority, { priority: Number(modalEpPrio.value) || 0 });
      return;
    }
    const modalManualInput = event.target.closest("[data-modal-manual-input]");
    if (modalManualInput) {
      setModalManualId(modalManualInput.value);
      return;
    }
    const modalModelContext = event.target.closest("[data-modal-model-context]");
    if (modalModelContext) {
      updateModalModel(modalModelContext.dataset.modalModelContext, { contextWindowTokens: modalModelContext.value ? Number(modalModelContext.value) : undefined });
      return;
    }
    const modalModelMaxTokens = event.target.closest("[data-modal-model-max-tokens]");
    if (modalModelMaxTokens) {
      updateModalModel(modalModelMaxTokens.dataset.modalModelMaxTokens, { maxOutputTokens: modalModelMaxTokens.value ? Number(modalModelMaxTokens.value) : undefined });
      return;
    }
    const securityInput = event.target.closest("[data-security-input]");
    if (securityInput) {
      state.securityInputDrafts[securityInput.dataset.securityInput] = securityInput.value;
      return;
    }
  });

  document.addEventListener("change", (event) => {
    const runtimeThinking = event.target.closest("[data-runtime-thinking]");
    if (runtimeThinking) {
      showToast(`思考模式已${runtimeThinking.checked ? "开启" : "关闭"}`);
      return;
    }
    const providerToggle = event.target.closest("[data-provider-toggle]");
    if (providerToggle) {
      toggleProviderEnabled(
        providerToggle.dataset.providerToggle,
        providerToggle.checked,
      );
      return;
    }
    const modelToggle = event.target.closest("[data-provider-model-toggle]");
    if (modelToggle) {
      const [pid, mid] = modelToggle.dataset.providerModelToggle.split(":");
      toggleProviderModel(pid, mid, modelToggle.checked);
      return;
    }
    const endpointToggle = event.target.closest("[data-provider-endpoint-toggle]");
    if (endpointToggle) {
      const [pid, eid] = endpointToggle.dataset.providerEndpointToggle.split(":");
      updateProviderEndpoint(pid, eid, { enabled: endpointToggle.checked });
      return;
    }
    const endpointProtocol = event.target.closest("[data-provider-endpoint-protocol]");
    if (endpointProtocol) {
      const [pid, eid] = endpointProtocol.dataset.providerEndpointProtocol.split(":");
      updateProviderEndpoint(pid, eid, { protocol: endpointProtocol.value });
      return;
    }
    const modelDefault = event.target.closest("[data-provider-model-default]");
    if (modelDefault) {
      const [pid, mid] = modelDefault.dataset.providerModelDefault.split(":");
      setDefaultModel(pid, mid);
      return;
    }
    const modelVision = event.target.closest("[data-provider-model-vision]");
    if (modelVision) {
      const [pid, mid] = modelVision.dataset.providerModelVision.split(":");
      updateProviderModel(pid, mid, { supportsVision: modelVision.checked });
      return;
    }
    const modelThinking = event.target.closest("[data-provider-model-thinking]");
    if (modelThinking) {
      const [pid, mid] = modelThinking.dataset.providerModelThinking.split(":");
      updateProviderModel(pid, mid, { supportsThinking: modelThinking.checked });
      return;
    }
    const modalEpProtocol = event.target.closest("[data-modal-endpoint-protocol]");
    if (modalEpProtocol) {
      updateModalEndpoint(modalEpProtocol.dataset.modalEndpointProtocol, { protocol: modalEpProtocol.value });
      return;
    }
    const modalEpToggle = event.target.closest("[data-modal-endpoint-toggle]");
    if (modalEpToggle) {
      updateModalEndpoint(modalEpToggle.dataset.modalEndpointToggle, { enabled: modalEpToggle.checked });
      return;
    }
    const modalModelDefault = event.target.closest("[data-modal-model-default]");
    if (modalModelDefault) {
      setModalDefaultModel(modalModelDefault.dataset.modalModelDefault);
      return;
    }
    const modalModelToggle = event.target.closest("[data-modal-model-toggle]");
    if (modalModelToggle) {
      updateModalModel(modalModelToggle.dataset.modalModelToggle, { enabled: modalModelToggle.checked });
      return;
    }
    const modalModelVision = event.target.closest("[data-modal-model-vision]");
    if (modalModelVision) {
      updateModalModel(modalModelVision.dataset.modalModelVision, { supportsVision: modalModelVision.checked });
      return;
    }
    const modalModelThinking = event.target.closest("[data-modal-model-thinking]");
    if (modalModelThinking) {
      updateModalModel(modalModelThinking.dataset.modalModelThinking, { supportsThinking: modalModelThinking.checked });
      return;
    }
    const botToggle = event.target.closest("[data-bot-toggle]");
    if (botToggle) {
      toggleBotEnabled(botToggle.dataset.botToggle, botToggle.checked);
      return;
    }
  });

  window.addEventListener("keydown", (event) => {
    if (state.providerModalOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProviderModal();
        return;
      }
      if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
        const manualIn = event.target.closest("[data-modal-manual-input]");
        if (manualIn) {
          event.preventDefault();
          addModalManualModel();
          return;
        }
      }
      return;
    }
    const manualInput = event.target.closest("[data-manual-model-input]");
    if (manualInput) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyManualModel(manualInput.dataset.manualModelInput);
      }
      return;
    }
    const securityInput = event.target.closest("[data-security-input]");
    if (securityInput && event.key === "Enter") {
      event.preventDefault();
      addSecurityItem(securityInput.dataset.securityInput);
      return;
    }
    if (event.key === "Escape") {
      if (state.openSelect) {
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
