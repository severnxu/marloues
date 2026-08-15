/**
 * 用户可见文案集中字典(简体中文)。
 *
 * 原则:
 * - 不上 i18n 框架,纯常量字典,build 体积零成本。
 * - 静态文案直接是字符串;动态文案用函数返回(参数名标注语义,避免字符串模板散落)。
 * - 任意调用点 `import { STRINGS } from "@shared/strings.zh"`,key 由 IDE 自动补全。
 * - 真正需要多语言时,把本文件改成 `strings/{zh,en}.ts` + `strings/index.ts` 即可,
 *   调用点改动只在 import 行。
 */

// ────────────────────────────────────────────────────────────────────────
// Chat: 发送 / 引导 / 会话 / 压缩 / 审批
// ────────────────────────────────────────────────────────────────────────
const chat = {
  send: {
    failedTitle: "发送失败",
    failedDescription: "消息发送时出错，请检查工作区和模型端点配置后重试。",
  },
  append: {
    failedTitle: "追加失败",
    failedNoReceipt: "追加消息未被主进程接收，请重试。",
    failedGeneric: "追加消息发送失败，请重试。",
  },
  steerRejected: {
    title: "当前任务已结束",
    description: "已转为新对话发送。",
  },
  steer: {
    cancelFailedTitle: "撤回失败",
    cancelFailedQueue: "队列状态未能确认，请重试。",
    cannotApplyTitle: "无法引导",
    cannotApplyDescription:
      "这条消息已经进入当前回合，或当前回合无法接收引导。",
    applyFailedTitle: "引导失败",
    resumeFailedTitle: "恢复发送失败",
    resumeFailedQueue: "队首消息仍保留在待发送列表中。",
  },
  session: {
    deleteFailedTitle: "删除会话失败",
  },
  compact: {
    cannotTitle: "无法压缩",
    cannotDescription: "没有活动的会话可压缩。",
    failedTitle: "压缩失败",
  },
  approval: {
    timedOut: "审批超时",
    canceled: "已取消",
    denied: "已拒绝",
  },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Provider / Model 设置
// ────────────────────────────────────────────────────────────────────────
const model = {
  removeProvider: (providerName: string) =>
    `${providerName || "模型"} 已删除。`,
  addProvider: (providerName: string) => `${providerName || "新模型"} 已添加。`,
  toggleProvider: (providerName: string, enabled: boolean) =>
    `${providerName}: ${enabled ? "已启用" : "已停用"}。`,
  testingProvider: (providerName: string) => `正在测试 ${providerName}...`,
  endpointResult: (providerName: string, message: string, latencyMs?: number) =>
    `${providerName}: ${message}${
      latencyMs !== undefined ? ` (${latencyMs}ms)` : ""
    }`,
  missingEndpointFields: "先填写 Base URL 和 API Key，再确认添加。",
  missingModel: "先添加至少一个模型，再确认添加模型。",
  selectModelToAdd: "先选择要添加的模型。",
  modelIdRequired: "模型 ID 不能为空。",
  modelAlreadyExists: (providerName: string, modelId: string) =>
    `${providerName}: 模型已存在:${modelId}`,
  manualModelAdded: (providerName: string, modelId: string) =>
    `${providerName}: 已手动添加并启用 ${modelId}。`,
  fetchingModels: (providerName: string) =>
    `正在获取 ${providerName} 的模型列表...`,
  preloadNotInjectedList:
    "当前窗口的 preload 还没刷新，新增的获取模型接口尚未注入。请重启应用窗口后再试。",
  preloadNotInjectedProbe:
    "当前窗口的 preload 还没刷新，新增的模型探测接口尚未注入。请重启应用窗口后再试。",
  noNewModels: (providerName: string, latencyMs?: number) =>
    `${providerName}: 没有发现新的模型。${
      latencyMs !== undefined ? ` (${latencyMs}ms)` : ""
    }`,
  modelsDiscovered: (providerName: string, count: number, latencyMs?: number) =>
    `${providerName}: 发现 ${count} 个新模型，勾选后点确定添加并启用。${
      latencyMs !== undefined ? ` (${latencyMs}ms)` : ""
    }`,
  modelsImported: (providerName: string, count: number) =>
    `${providerName}: 已添加并启用 ${count} 个模型。`,
  modelRemoved: (providerName: string, modelId: string) =>
    `${providerName}: 已删除模型 ${modelId}。`,
  probingModel: (modelId: string) => `正在探测 ${modelId}...`,
  setAsDefault: (modelTitle: string) => `${modelTitle} 已设为默认模型。`,
  toggleModel: (modelTitle: string, enabled: boolean) =>
    `${modelTitle}: ${enabled ? "已禁用" : "已启用"}。`,
  // ProviderRow / ProviderModelCard 上的 title 属性
  providerEnabledTitle: "模型已启用",
  providerDisabledTitle: "模型已停用",
  setDefaultButtonTitle: "设为默认模型",
  alreadyDefaultButtonTitle: "已是默认模型",
} as const;

// ────────────────────────────────────────────────────────────────────────
// Skills
// ────────────────────────────────────────────────────────────────────────
const skill = {
  detailFetchFailed: "无法获取 Skill 详情,请稍后重试。",
  marketplaceLoadFailed: "加载 ClawHub 市场失败",
  installSuccessTitle: "Skill 已安装",
  installFailedTitle: "安装 Skill 失败",
  removeSuccessTitle: "Skill 已删除",
  removeFailedTitle: "删除 Skill 失败",
} as const;

// ────────────────────────────────────────────────────────────────────────
// MCP(SettingsWorkbench.utils)
// ────────────────────────────────────────────────────────────────────────
const mcp = {
  status: {
    ok: "正常",
    running: "检查中",
    disconnected: "已断开",
    error: "异常",
    uncheck: "未检查",
    checkFailed: "检查失败",
  },
  transport: {
    stdio: "本地进程",
    http: "HTTP 服务",
    sse: "SSE 服务",
    json: "自定义 JSON",
  },
  addModeHint: {
    stdio: "启动本地 MCP 进程，适合 npx、node、uvx、python。",
    http: "连接远程 Streamable HTTP MCP 服务。",
    sse: "连接远程 SSE MCP 服务。",
    json: "粘贴完整 MCP 配置，适合 headers、tools、alwaysLoad 等高级项。",
  },
  serverSummary: (transport: string, toolCount: number) =>
    `${transport} · ${toolCount} 个工具`,
  serverSummaryRunning: (transport: string) => `${transport} · 检查中`,
  serverSummaryDisconnected: (transport: string) => `${transport} · 已断开`,
  serverSummaryCheckFailed: (transport: string) => `${transport} · 检查失败`,
  serverSummaryUncheck: (transport: string) => `${transport} · 未检查`,
  errorUnknown: "未知错误",
  errorHint: {
    notFound: "请检查 command 或 args 中的本地路径是否已下发。",
    timeout: "请确认 MCP Server 能在 5 秒内完成 initialize 和 tools/list。",
    parse:
      "请确认 MCP Server 的 stdout 只输出 JSON-RPC 协议消息，普通日志写入 stderr。",
  },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Status toast helpers(SettingsWorkbench.statusToastTitle 替换)
// ────────────────────────────────────────────────────────────────────────
const status = {
  operationOk: "操作成功",
  operationFailed: "操作失败",
  operationFailedWithPrefix: (prefix: string) =>
    prefix.length <= 24 ? prefix : "操作失败",
  testing: "正在测试",
  updated: "状态更新",
} as const;

// ────────────────────────────────────────────────────────────────────────
// Skill audit / scope
// ────────────────────────────────────────────────────────────────────────
const skillAudit = {
  scope: {
    marketplace: "市场",
    enterprise: "企业",
    project: "项目",
    user: "用户",
  },
  integrity: {
    verified: "已校验",
    failed: "校验失败",
    uncheck: "未校验",
  },
  security: {
    clean: "安全",
    warning: "有警告",
    suspicious: "可疑",
    unscanned: "未扫描",
  },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Auth / SSO
// ────────────────────────────────────────────────────────────────────────
const auth = {
  loginFailed: "登录失败。",
  registerOpenFailed: "注册入口打开失败。",
  ssoCanceled: "已取消 SSO 登录。",
  ssoGenericFailed: "SSO 登录失败，请重试。",
} as const;

// ────────────────────────────────────────────────────────────────────────
// 系统 / 托盘 / 运行时 / 更新 / 版本 / 审计
// ────────────────────────────────────────────────────────────────────────
const system = {
  tray: {
    minimizedTitle: "Marloues",
    minimizedContent: "应用已最小化到托盘，点击托盘图标可恢复窗口。",
  },
  runtimes: {
    operationFailedTitle: "运行时操作失败",
  },
  update: {
    errorDetailsCopied: "错误详情已复制",
    copyFailed: "复制失败",
    alreadyLatest: "当前已是最新版本",
    branchCreated: "对话分支已创建",
    branchCreateFailed: "创建对话分支失败",
    contextActionFailed: "上下文操作失败",
    autoRestartPausedTitle: "已暂停自动重启",
    autoRestartPausedDescription: "可稍后从侧边栏手动触发更新。",
  },
  version: {
    loadFailed: "读取失败",
  },
  audit: {
    failed: "失败",
    success: "成功",
  },
  workflow: {
    compactBranchCreated: "已创建精简分支",
    forkCreatedTitle: "对话分支已创建",
    forkCreatedDescription: "已切换到新的对话分支。",
  },
  session: {
    confirmRemoveTitle: "删除会话？",
    confirmRemoveMessage: (title: string) => `删除「${title}」后不可恢复。`,
    confirmRemoveConfirmLabel: "删除",
    forkedSuccessTitle: "已分叉会话",
    forkFailedTitle: "分叉失败",
    exportFailedTitle: "导出失败",
  },
  workspace: {
    confirmRemoveTitle: "移除工作空间？",
    confirmRemoveMessage: (name: string) =>
      `将「${name}」从工作空间列表中移除。本地磁盘文件不会被删除。`,
    confirmRemoveConfirmLabel: "移除",
    removeSuccessTitle: "已移除工作空间",
    removeFailedTitle: "移除失败",
  },
  updateBadge: {
    cannotStopTaskTitle: "无法停止任务",
    cannotStopTaskDescription: "请先手动停止运行中的任务，再应用更新。",
    updateFailedTitle: "更新失败",
    updateReadyTitle: "更新已准备好",
  },
  permission: {
    fileWriteDescription: "这个操作会创建或覆盖文件，请先确认目标和内容。",
  },
  secretEncryption: {
    unavailableTitle: "无法加密保存密钥",
    unavailableDescription:
      "当前系统的密钥存储不可用，密钥不会被保存。请安装并解锁系统密钥环（Linux 需 gnome-keyring 或 kwallet）后重试。",
  },
} as const;

export const STRINGS = {
  chat,
  model,
  skill,
  skillAudit,
  mcp,
  status,
  auth,
  system,
} as const;

export type Strings = typeof STRINGS;
