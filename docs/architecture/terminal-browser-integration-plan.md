# Marloues 终端与浏览器集成方案 (v6)
> v6 修订：修复 v5 复核遗留的实现级陷阱——framenavigated 拦截代码中
> securityRules 来源未定义（改为注入 getter 获取实时 AgentSettings）；
> EMPTY_SECURITY_RULES 未导出（注明需从 security-host.ts 导出或在
> BrowserService 内重定义）；permit authorize 侧补充完整链路说明；
> 工厂函数内 this 指向修正（approvalTracker 用参数而非 this）。
>
> v5 修订：修复示例代码与声明的偏差——approvalTracker 创建位置从 per-turn 改为
> ClaudeRuntime 实例字段（per-thread）；canUseTool 短路移到 storm check 之后；
> defaultPageId 替换为 BrowserService.getActivePageId；isAllowedDomain 替换为
> matchesDomainList 并定义空/非空语义；exec handler 补 permit 消费；auditLog
> 来源明确化；navigate handler 的 newPage/navigate 二义性消除；tracker clear
> 触发点指明；self-built 审批路径写明。

> 目标：将 Codex 的终端 (PTY) 和浏览器 (Playwright) 能力集成到 marloues 多 Runtime 架构中。
> 核心原则：**后端共享 (Electron 主进程单例)，工具暴露层按 Runtime 差异化，UI 层统一。**
>
> v4 修订：在 v3 基础上修复审批风暴（SessionApprovalTracker 短路机制）；补修
> click/fill 绕过域名白名单（Playwright framenavigated 拦截）；解决 Step 3a
> 与"审计不阻断"的矛盾；显式标注 canonical 映射后各工具的 sensitive 判定结果。
>
> v3 修订（保留）：补修 browser.navigate 安全面缺口（operation-factory 类别推断 + security-host
> 分支检查）；统一跨 Runtime 工具名（canonical 名映射）；分离 permit 队列与
> TerminalService 生命周期；terminal.read 增量语义；browser 生命周期兜底；
> preload 层与 IPC 缺口补全；空闲超时定义修正；方案 B 最小同步；落地顺序修正。

## 架构总览

```
                    ┌──────────────────────────────────┐
                    │   TerminalService (PTY)          │  ← 主进程单例 (跨 turn 存活)
                    │   BrowserService (Playwright)     │  ← 主进程单例 (跨 turn 存活)
                    └──────────┬───────────────────────┘
                               │
                    ┌──────────┴───────────────────────┐
                    │   三种暴露方式，不是统一入口        │
                    └──┬──────────┬──────────┬─────────┘
                       │          │          │
              ┌────────┴──┐ ┌─────┴────┐ ┌───┴──────────┐
              │ Binary    │ │ Claude   │ │ Self-built   │
              │ Runtime   │ │ Runtime  │ │ Runtime      │
              │           │ │          │ │              │
              │ Codex内置 │ │ in-proc  │ │ registerTool │
              │ Bash工具   │ │ SDK MCP  │ │ +executePlan │
              │ +事件拦截  │ │ sdkMcpSrv│ │ 路由扩展     │
              └───────────┘ └──────────┘ └──────────────┘
                       │          │          │
                    ┌──┴──────────┴──────────┴─────────┐
                    │  preload → IPC → Renderer          │  ← UI 层共享
                    │  (xterm + webview)                │
                    └───────────────────────────────────┘
```

## 各 Runtime 工具暴露现状

| Runtime | listTools() 来源 | registerTool | 内置终端/浏览器 |
|---------|-----------------|-------------|----------------|
| Binary (Codex) | configuredMcpTools() | false | Codex 自带 Bash 工具 (command_execution) |
| Claude SDK | configuredMcpTools() + sdkMcpServers | false (throw) | 有 marloues_sandbox.bash (in-process MCP) |
| Self-built | configuredMcpTools() + 自注册 | true | 有 memory.echo / self-built.fs.* (executePlan 内联) |

## 跨 Runtime 工具名统一

> **v3 新增**：Claude Runtime 下模型看到的工具名是 `mcp__marloues_terminal__exec`，
> Self-built Runtime 下是 `terminal.exec`，Binary Runtime 不提供。
> 用户在 `toolPermissionPolicy.disallowedTools` 里配 `terminal.exec` 拦不住 Claude 侧。

参照 `sdk-command-sandbox.ts:111` 的 `canonicalSdkSecurityToolName` 模式
（把 `mcp__marloues_sandbox__bash` 映射回 `"Bash"`），设计 canonical 名映射：

| 实际全名 (Claude Runtime) | Canonical 名 (统一) | Self-built 名 |
|--------------------------|---------------------|---------------|
| mcp__marloues_terminal__exec | terminal.exec | terminal.exec |
| mcp__marloues_terminal__write | terminal.write | terminal.write |
| mcp__marloues_terminal__read | terminal.read | terminal.read |
| mcp__marloues_terminal__resize | terminal.resize | terminal.resize |
| mcp__marloues_browser__navigate | browser.navigate | browser.navigate |
| mcp__marloues_browser__screenshot | browser.screenshot | browser.screenshot |
| mcp__marloues_browser__click | browser.click | browser.click |
| mcp__marloues_browser__fill | browser.fill | browser.fill |
| mcp__marloues_browser__get_text | browser.get_text | browser.get_text |

新增 `canonicalTerminalToolName` / `canonicalBrowserToolName` 函数，
SecurityHost / 审批 UI 用 canonical 短名匹配。

> **v3 补充 — disallowedTools 两层处理**：
> Claude SDK 有两条独立的工具拦截路径，canonical 名映射需分别适配：
>
> 1. **SDK 层 `disallowedTools`**（`options-builder.ts:152` 直接透传给 SDK）：
>    SDK 在 `canUseTool` 回调之前用**全名**匹配。用户配 `terminal.exec` 拦不住
>    `mcp__marloues_terminal__exec`。解决方案：在 `options-builder.ts` 里把
>    canonical 短名展开为全名后再传入（如 `"terminal.exec"` →
>    `"mcp__marloues_terminal__exec"`），参照 `canonicalSdkSecurityToolName`
>    的逆映射模式。
> 2. **SecurityHost 层**（`canUseTool` 回调，`claude-runtime.ts:1281`）：
>    `canonicalSdkSecurityToolName(toolName)` 把全名映射回短名后传入
>    SecurityHost 评估。terminal/browser 工具走同一模式：
>    `canonicalTerminalToolName` / `canonicalBrowserToolName` 做全名→短名映射。
>
> 实现优先级：两层都要做。如果 v1 只做一层，先做 SecurityHost 层（canUseTool），
> 因为它覆盖 allow/ask/deny 全决策链；SDK 层 disallowedTools 只做硬性屏蔽，
> 不做细粒度审批。但两层不做的话，用户配 `disallowedTools: ["terminal.exec"]`
> 会完全失效。

## 审批模型设计（v4 核心新增）

> **审批风暴问题**：第三轮复核发现，所有新工具在现有审批机制下**每次调用都弹框**，
> 产品不可用。完整失效链（每步已对照代码验证）：
>
> 1. `isSensitiveTool`（tool-permission-engine.ts:179-183）：`mcp__` 前缀 →
>    sensitive；`SENSITIVE_TOOL_NAME_PATTERN`（:43-44）含 `exec|write|browser`
>    等 → canonical 映射后 terminal.exec/write 和 browser.* 仍 sensitive → 默认 ask
> 2. `allowSession`（security-host.ts:182-183/240-241/264-265）：
>    `Boolean(commandFingerprint) || Boolean(resolvedPath)` —— write/read 的
>    input 是 `{sessionId, data}`，两者皆空 → 审批 UI 不显示"本次会话允许"选项
> 3. `grantStore.addGrant`（grant-store.ts:58-64）：无 fingerprint/paths/domains
>    → 返回 null → grant 存不进去
> 4. `grantStore.match`（grant-store.ts:72）：精确 toolName 匹配 → exec 的
>    grant 永远匹配不到 write 的 operation
>
> 后果：交互式 REPL 一次任务几十次 write、浏览网页几十次 click/fill/screenshot
> ——每个都弹框。

### 解决方案：SessionApprovalTracker（canUseTool 短路）

采用复核建议的方案 B（canUseTool 短路），不修改 SecurityHost / grant-store：

```
  模型调 terminal.exec          模型调 browser.navigate
       │                              │
       ▼                              ▼
  canUseTool → SecurityHost       canUseTool → SecurityHost
       │ → ask → 用户批准              │ → ask → 用户批准
       ▼                              ▼
  tool handler 执行               tool handler 执行
  terminalService.spawn()         browserService.newPage()
       │                              │
       ▼                              ▼
  tracker.markSessionApproved()   tracker.markPageApproved()
       │                              │
       ▼                              ▼
  模型调 terminal.write/read      模型调 browser.click/fill/screenshot
       │                              │
       ▼                              ▼
  canUseTool → 短路检查            canUseTool → 短路检查
  tracker.isSessionApproved()?    tracker.isPageApproved()?
       │ yes → allow + audit           │ yes → allow
       │ no  → fall through SecurityHost  │ no → fall through SecurityHost
```

**文件**: `client/main/core/security/session-approval-tracker.ts` (新建) +
`client/main/core/runtime/claude-runtime.ts` (修改 canUseTool)

> **v5 关键修正 — approvalTracker 创建位置**：
> tracker 必须是 ClaudeRuntime 的**实例字段**（构造时 `this.approvalTracker
> = new SessionApprovalTracker()`），**不是**在 `startTurn` / `buildClaudeRuntimeOptions`
> 内部创建的局部变量。`startTurn` 内每 turn 新建 `SdkCommandSandbox`（:1265）
> 和 `TurnPermitManager`（per-turn 正确），但 tracker 跨 turn 存活——放在
> per-turn 位置会导致 turn 1 exec 批准的会话在 turn 2 `isSessionApproved()
> === false`，审批风暴在跨 turn 场景满血复活。
> 同理 `this.auditTrail`（审计日志写入器）也是实例字段，接入 AUDIT_LIST IPC。

```typescript
// session-approval-tracker.ts
export class SessionApprovalTracker {
  private sessions = new Map<string, number>();  // sessionId → timestamp
  private pages = new Map<string, number>();     // pageId → timestamp
  private readonly TTL_MS = 30 * 60 * 1000;      // 30 分钟

  markSessionApproved(sessionId: string): void {
    this.sessions.set(sessionId, Date.now());
  }
  markPageApproved(pageId: string): void {
    this.pages.set(pageId, Date.now());
  }
  isSessionApproved(sessionId: string): boolean {
    const ts = this.sessions.get(sessionId);
    if (!ts) return false;
    if (Date.now() - ts > this.TTL_MS) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }
  isPageApproved(pageId: string): boolean {
    const ts = this.pages.get(pageId);
    if (!ts) return false;
    if (Date.now() - ts > this.TTL_MS) {
      this.pages.delete(pageId);
      return false;
    }
    return true;
  }
  clear(): void {
    this.sessions.clear();
    this.pages.clear();
  }
}
```

在 `canUseTool` 里（`claude-runtime.ts:1281` 区域）插入短路逻辑：

```typescript
canUseTool: async (toolName, input, context) => {
  // v5: canonical 映射先行——terminal/browser 全名 → 短名
  const canonical = canonicalTerminalToolName(
    canonicalBrowserToolName(canonicalSdkSecurityToolName(toolName))
  );
  const toolUseId =
    typeof context.toolUseID === "string" ? context.toolUseID : genId();

  // ── 1. Storm check 先行（不能跳过） ──
  // RISKY_TOOL_PATTERN 命中 write/browser/exec → riskyDenyAt: 3
  // 短路必须在 storm 之后，否则模型卡死循环反复 write/click 同内容时
  // 失去风暴兜底。terminal.read/resize 不命中 risky → 走 default 阈值。
  // 注意：storm fingerprint 含 input，不同 data 的 write 不会累积。
  // 若担心合法重复 write（如多次按 Enter）被误伤，可给 terminal.write
  // 配独立宽松阈值（类比 readDenyAt），而非绕过 storm。
  const storm = this.toolStormBreaker.check(turnId, canonical, input);
  if (storm.action === "deny") {
    return {
      behavior: "deny",
      message: storm.message ?? "Repeated tool call blocked.",
      interrupt: false,
      toolUseID: toolUseId,
    };
  }

  // ── 2. 短路：已批准会话上的 write/read/resize → allow + audit ──
  // storm 已过，SecurityHost 之前。this.approvalTracker 是实例字段（per-thread）。
  if (["terminal.write", "terminal.read", "terminal.resize"]
      .includes(canonical)) {
    const sessionId = input.sessionId as string;
    if (this.approvalTracker.isSessionApproved(sessionId)) {
      if (canonical === "terminal.write") {
        // this.auditTrail 是实例字段，底层接 AUDIT_LIST IPC 系统
        this.auditTrail.write(opts.threadId, sessionId, input.data);
      }
      return { behavior: "allow", toolUseID: toolUseId, updatedInput: input };
    }
    // 未批准 → fall through SecurityHost → ask
  }

  // ── 3. 短路：已批准页面上的 click/fill/screenshot/get_text → allow ──
  // pageId 来源：input.pageId（可选）或 BrowserService 维护的 activePageId
  if (canonical.startsWith("browser.") && canonical !== "browser.navigate") {
    const pageId = (input.pageId as string)
      ?? this.browserService.getActivePageId(opts.threadId);
    if (pageId && this.approvalTracker.isPageApproved(pageId)) {
      return { behavior: "allow", toolUseID: toolUseId, updatedInput: input };
    }
    // 未批准 → fall through SecurityHost → ask
  }

  // ── 4. 正常 SecurityHost 评估 ──
  // （exec、navigate、或未批准的 write/read/click 等）
  const securityToolName = canonical;
  // ... 现有 SecurityHost.evaluate 逻辑 ...
}
```

在 terminal.exec 和 browser.navigate 的 tool handler 里标记批准：

```typescript
// terminal.exec handler
tool("exec", ..., async (input) => {
  // v5: 消费 permit（参照 sdk-command-sandbox.ts:43-48 同步签名）
  const permit = permitManager.consumePermit(input.command);
  if (!permit) {
    return toolError("Missing one-time SecurityHost permit; terminal exec was denied.");
  }
  const sessionId = terminalService.spawn(input.cwd ?? process.cwd(), {});
  approvalTracker.markSessionApproved(sessionId);  // ← 关键（用参数，不是 this）
  terminalService.write(sessionId, input.command + "\n");
  ...
})

// browser.navigate handler
tool("navigate", ..., async (input) => {
  // v5: 懒启动 browser（首次 navigate 时若无该 thread 的实例则 launch）
  let browserId = browserService.getBrowserId(threadId);
  if (!browserId) {
    browserId = browserService.launch({ headless: true });
    browserService.setBrowserId(threadId, browserId);
  }
  let pageId = browserService.getActivePageId(threadId);
  if (!pageId) {
    pageId = browserService.newPage(browserId, input.url);
  } else {
    browserService.navigate(pageId, input.url);
  }
  browserService.setActivePageId(threadId, pageId);
  approvalTracker.markPageApproved(pageId);  // ← 关键（用参数，不是 this）
  ...
})
```

**生命周期**：SessionApprovalTracker 是 per-thread（跨 turn 存活，与 PTY 会话
对齐），TTL 30 分钟。与 TurnPermitManager（per-turn、
管 exec/navigate 自身的一次性 permit）是两套独立结构：

> **v5 补充 — clear() 触发点**：tracker 在以下事件触发 `clear()`：
> 1. 对话删除（`claude-runtime.ts:1067 deleteThread()` 方法——实际挂钩点，
>   内部调 `workflowThreadStore.deleteThread()` :1084）
> 2. 用户手动 "清除审批" 操作（Settings → Security → Approved Sessions → Clear）
> 3. TTL 自然过期（30 分钟无活动，条目逐条淘汰）
> 注意：thread 切换（switchThread）**不**触发 clear()——切回去时已批准的
> 会话仍应有效。

| 结构 | 作用域 | 管什么 | 何时清理 |
|------|--------|--------|----------|
| TurnPermitManager | per-turn | exec/navigate 调用本身的 permit 队列 | turn 结束 |
| SessionApprovalTracker | per-thread | 已批准会话/页面上的后续操作短路 | thread 删除 / 手动清除 / TTL |

> **v6 补充 — 工厂函数内的 this 指向**：`createSdkTerminalServer` /
> `createSdkBrowserServer` 是独立导出的工厂函数，handler 内 `this` 是
> `undefined`。handler 必须用传入的参数 `approvalTracker`，不是
> `this.approvalTracker`。`this.approvalTracker` 仅在 ClaudeRuntime 方法
> （如 `canUseTool`）内有效，那里 `this` 指向 ClaudeRuntime 实例。

> **v6 补充 — permit 链条完整路径**：
> - **authorize**（canUseTool allow 分支）：参照 Bash 先例
>   （claude-runtime.ts:1326 `sdkCommandSandbox.authorize(command, permit)`），
>   在 allow 分支扩展 `terminal.exec` / `browser.navigate` 的 authorize 调用，
>   把 `decision.permit` 存入 `permitManager` 供 handler 消费。
> - **consume**（handler 内）：`permitManager.consumePermit(command)` 同步取值，
>   空则报错（sdk-command-sandbox.ts:43-48 先例）。签名是同步返回 permit 或
> null，不是回调。
>
> 链路：SecurityHost.evaluate → allow → permitManager.authorize(permit)
>   → handler → permitManager.consumePermit() → 执行

### canonical 映射后各工具的 sensitive 判定

> **v4 补充**：canonical 映射发生在 `canUseTool` 内、SecurityHost.evaluate
> 之前（`claude-runtime.ts:1281` 先例）。映射后 `evaluateToolPermission` 看到
> 短名——`terminal.read` 不命中 `SENSITIVE_TOOL_NAME_PATTERN`（read 不在词表里）
> 也不以 `mcp__` 开头 → 不是 sensitive → 默认 allow。而全名本会因 `mcp__`
> 前缀走 ask。这是映射顺序的意外行为，需显式确认。

| Canonical 名 | SENSITIVE 模式命中？ | Sensitive？ | 默认动作 | 短路？ | 最终行为 |
|---|---|---|---|---|---|
| terminal.exec | "exec" ✓ | yes | ask | 否（入口点） | 每次审批 |
| terminal.write | "write" ✓ | yes | ask | 是（会话已批准→allow+审计） | 首次审批，后续放行 |
| terminal.read | 无 | no | allow | 冗余（已 allow） | 始终放行 ✅ |
| terminal.resize | 无 | no | allow | 冗余（已 allow） | 始终放行 ✅ |
| browser.navigate | "browser" ✓ | yes | ask | 否（入口点） | 每次审批 |
| browser.click | "browser" ✓ | yes | ask | 是（页面已批准→allow） | 首次审批，后续放行 |
| browser.fill | "browser" ✓ | yes | ask | 是 | 同上 |
| browser.screenshot | "browser" ✓ | yes | ask | 是 | 同上 |
| browser.get_text | "browser" ✓ | yes | ask | 是 | 同上 |

> `terminal.read` 和 `terminal.resize` 放行是**设计意图**：读取 PTY 输出和
> 调整尺寸无副作用，与 `Read`/`LS` 等 builtin 工具同列。

## terminal.exec 与 marloues_sandbox.bash 的分工

Claude Runtime 已有一条完整的一次性命令执行链路：

```
SDK 内置 Bash → toolAliases: { Bash: SDK_SANDBOX_TOOL_NAME }
  → in-process MCP server (createSdkMcpServer)
  → SecurityHost permit 一次性授权
  → CodexProcessSandboxRunner 进程沙箱 + 环境变量过滤
```

新增 terminal.exec 定位为**交互式 PTY 长驻会话**（增量能力），不替代 marloues_sandbox.bash：

| 维度 | marloues_sandbox.bash | terminal.exec (新增) |
|------|----------------------|---------------------|
| 执行方式 | spawn + pipe，一次性 | PTY，长驻会话 |
| 交互能力 | 无 stdin 写入 | 支持 terminal.write |
| 生命周期 | 命令退出即结束 | 会话持续到显式 kill |
| 沙箱 | CodexProcessSandboxRunner 全程 | 会话启动时锁定沙箱 profile |
| 审批模型 | 一次性 permit 队列 (per-turn) | 会话级 permit (per-turn) + write 输入全程审计 |
| 典型场景 | npm install, git status | python REPL, ssh, watch, dev server |

## 实施步骤

### 第零阶段：依赖安装 (Step 0)

#### Step 0: 依赖安装与原生模块编译

> **v3 新增**：原 Step 13 前移到最前——写 node-pty 代码之前必须先装依赖 + rebuild。

**文件**: `package.json` + `client/package.json` + electron-builder 配置

新增依赖：
- `node-pty` (终端 PTY)
- `@xterm/xterm` + `@xterm/addon-fit` (终端 UI)
- `playwright` (浏览器自动化，运行时依赖)

构建配置：
- `electron-rebuild` 确保 node-pty 在 Mac/Windows 正确编译
  （项目已有 `better-sqlite3` + `rebuild:native` 脚本，经验可复用）
- Playwright Chromium 二进制通过 `electron-builder` 的 `extraResources` 打入包
  （约 +150MB，需明确取舍）
- `@playwright/test` (devDependencies, E2E 用) 与 `playwright` (运行时依赖)
  分开管理

> **打包说明**：走 in-process 路线后不需要外部 `node` 命令（SDK MCP 在主进程
> 内运行）。但若 Binary Runtime 未来需要 stdio MCP server，必须用
> `process.execPath + ELECTRON_RUN_AS_NODE` 或参考 `options-builder.ts:64`
> 已有的 Windows npx 包装先例。

### 第一阶段：后端服务 + 安全前置 (Step 1-3)

#### Step 1: TerminalService

**文件**: `client/main/services/terminal-service.ts`

基于 `node-pty` 的 PTY 会话管理单例：

- `spawn(cwd, opts)`: 分配 PTY，启动 shell，返回 sessionId
- `write(sessionId, data)`: 向 PTY 写入 stdin
- `read(sessionId)`: 读取自上次读取以来的**增量输出**，附带 stable 标记和 exitCode
- `readUntilStable(sessionId, silenceWindowMs, totalTimeoutMs)`: 阻塞等待输出稳定后返回（用于 exec 首次返回）。`silenceWindowMs` 指静默窗口（无新输出即认为稳定，建议 300-500ms），`totalTimeoutMs` 指总上限（到达即返回，建议 5000ms）
- `resize(sessionId, cols, rows)`: 调整 PTY 尺寸
- `kill(sessionId)`: 终止会话
- `listSessions(threadId?)`: 列出活跃会话（供 renderer reload 后恢复）
- `getHistory(sessionId)`: 获取全量缓存输出（renderer reload 后 xterm buffer 丢失时回放）
- 按 `threadId` 隔离会话空间
- 输出通过 EventEmitter 推送（供 IPC 转发到 renderer）

**会话泄漏兜底**：
- thread 结束时自动 kill 关联的所有 PTY 会话
- 最大并发会话数限制（建议 8）
- 空闲超时（建议 30 分钟）—— **定义修正**：idle = 无新输出 **且** 无 renderer
  attach。避免误杀 dev server（编译完静默待命时无输出，但有 renderer attach）

**write 输入审计**：
- 所有 `write(sessionId, data)` 调用记录到审计日志
- 接入项目现有 AUDIT_LIST IPC 系统
- 审计回放 UI 在 Settings → Security → Audit Trail 下展示

#### Step 2: BrowserService

**文件**: `client/main/services/browser-service.ts`

基于 Playwright 的浏览器管理单例：

- `launch(opts)`: 启动 Chromium，返回 browserId
- `newPage(browserId, url)`: 创建新页面，返回 pageId
- `navigate(pageId, url)`: 导航
- `screenshot(pageId, opts)`: 截图
- `click(pageId, selector)`: 点击元素
- `fill(pageId, selector, value)`: 填写表单
- `getContent(pageId)`: 获取页面文本内容
- `close(browserId)`: 关闭浏览器
- `getActivePageId(threadId)`: 获取当前活跃页面 ID
- `setActivePageId(threadId, pageId)`: 设置活跃页面（navigate handler 调用）
- `getBrowserId(threadId)`: 获取该 thread 的 browser 实例 ID（懒启动用）
- `setBrowserId(threadId, browserId)`: 缓存 browser 实例 ID
- 按 `threadId` 隔离浏览器实例

> **v5 补充 — activePageId / browserId 状态**：BrowserService 维护
> per-thread 的 `activePageId` 和 `browserId`。navigate handler 首次调用
> 时若无 browser 实例则懒 `launch()` 并缓存 `browserId`，然后 `newPage()`
> 并设为 `activePageId`。后续 navigate 在当前 page 上导航。
> click/fill/screenshot/get_text 的 `pageId` 参数可选，缺省时读
> `getActivePageId(threadId)`。canUseTool 短路检查也读此方法获取 pageId。

**浏览器生命周期兜底（与 terminal 对称）**：
- thread 结束时自动 close 关联的所有浏览器实例
- 最大并发浏览器实例数限制（建议 4，每个 Chromium ~200-400MB）
- 空闲超时（建议 30 分钟，定义同 terminal：无操作 **且** 无 renderer attach）

#### Step 3: 安全层适配（与 Step 1/2 同步）

**文件**: `client/main/core/security/operation-factory.ts` (修改) +
`client/main/core/security/security-host.ts` (修改) +
`client/main/core/permissions/shell-command-parser.ts` (复用) +
`client/main/core/security/navigation-policy.ts` (复用) +
`client/main/core/security/sandbox-broker.ts` (扩展) +
`client/main/core/security/session-approval-tracker.ts` (新建)

> **路径修正**：`shell-command-parser.ts` 实际在 `core/permissions/` 目录，
> 不在 `core/security/`。

**3a. terminal.exec 审批（已验证可行）**：

`operation-factory.ts:116` 已有正则 `/(bash|shell|exec|terminal)/i` →
`command_execution` 类别推断。`mcp__marloues_terminal__exec` 命中此正则
（含 "terminal" 和 "exec"），自动走审批链路。

> **类别归类（v3→v4 修正）**：
> 同一正则也匹配 `mcp__marloues_terminal__read` 和 `mcp__marloues_terminal__write`
> （都含 "terminal"）→ 三者均为 `command_execution`。
> - `terminal.exec` → `command_execution` ✅（正确，入口点需审批）
> - `terminal.write` → `command_execution` ✅（合理——向 PTY 写入等效命令执行）
> - `terminal.read` → `command_execution` ⚠️（偏保守，但见下方 v4 修正）
>
> 如需更精确分类，可在 `inferCategory` 里特判 `terminal__read` → `file_read`，
> 但 v1 不做——保守归类不会引入安全漏洞。
>
> **v4 修正 — 解决"审计不阻断"矛盾**：
> v3 写"write → command_execution → sensitive → 默认 ask"（阻断），但 PTY
> 审批困难节又说"方案 2 = 审计 + 回放，不阻断"。两句矛盾。
> v4 用 SessionApprovalTracker 统一：exec 审批后标记 session，后续 write 在
> canUseTool 短路放行 + 审计（不阻断）。write 的 `command_execution` 类别
> 归类在短路后不再进入 SecurityHost，因此分类结果无关紧要。
> 未被 exec 批准的 session 上的 write → 走正常 ask（安全兜底）。

- SecurityHost 新增 terminal.exec 权限审批：复用 SdkCommandSandbox 的
  一次性 permit 队列模式（authorize/consumePermit）
- **permit 队列生命周期（v3 关键修正）**：TerminalService 是模块级单例，
  跨 turn 存活（PTY 会话跨 turn 正是设计核心）。但 permit 队列**不能**
  放在单例 server 里——SdkCommandSandbox 是每 turn 新建
  （claude-runtime.ts:1265），turn 结束 clear()（:1493/:1504/:1758）。
  解决方案：permit 队列绑定 turnId，turn 结束时清理；TerminalService
  的 PTY 会话不受 turn 生命周期影响。

**3b. browser.navigate 审批（v3 关键补修）**：

> **复核发现的安全洞**：`mcp__marloues_browser__navigate` 不命中
> `inferCategory` 任何规则——`browser`/`navigate` 都不在正则里
> （operation-factory.ts:108-129），input 的 url 字段也不被识别为
> command/path → category 落入 `"other"`。后果：
> - `security-host.ts:358` 的 `allowedDomains` 只对 `category === "network_access"` 生效 → 域名白名单拦不住 browser.navigate
> - `security-host.ts:503` 的 workspace-write-network 提权同样只认 network_access → 不触发
>
> 虽然 `inferNetworkHosts` 能从 input.url 提取主机（deny 策略可生效），
> 但 allow 策略（域名白名单）完全失效。

修改 `operation-factory.ts` 的 `inferCategory`：

```typescript
// 新增：browser/navigate → network_access 类别
if (/(\b|[._-])(browse|navigate|web_?fetch|web_?search)(\b|[._-])/i.test(toolName)) {
  return "network_access";
}
```

同步检查 `security-host.ts` 各 `category === "network_access"` 分支：
- `:305` deny 策略（hosts 检查）——已覆盖
- `:358` allowedDomains 白名单——修改后生效
- `:503` workspace-write-network 提权——修改后生效

> **v4 补充 — 正则插入位置与边界验证**：
> 插入位置：command_execution 检查之后，WebFetch/WebSearch 检查之前（实测无冲突）。
> `(\b|[._-])` 前后界确保 "browse" 在 "browser" 里不命中（后跟 "r" 是 word
> char，`\b` 和 `[._-]` 都不匹配）→ 只有含 "navigate" 的工具名命中。
> `browser.screenshot`/`browser.click` 等不含 "navigate" → 仍落 "other"。

> **v4 补充 — click/fill 绕过域名白名单（安全洞 #2）**：
> Step 3b 只堵了 navigate 工具入口，但导航不止这一条路：
> `browser.click("a[href='https://evil.com']")` → click 不含 navigate/browse
> → category "other"，input 只有 selector（无 url 字段）→ networkHosts 为空
> → deniedDomains/allowedDomains 全部不检查 → 放行 → 页面导航到 evil.com。
> fill + 表单提交同理。
>
> **正确的执行点不在工具调用层，而在 BrowserService 内部**：
> Playwright 的 `page.on('framenavigated')` 对每次实际发生的导航做
> allowedDomains 检查。工具层 category 推断只是第一道门。

BrowserService 内部新增导航拦截（Step 2 的补充）：

```typescript
// browser-service.ts — 创建 page 后立即注册拦截
page.on('framenavigated', async (frame) => {
  if (frame !== page.mainFrame()) return;
  const url = frame.url();
  if (!url || url === 'about:blank') return;
  const host = safeHostname(url);
  if (!host) return;
  // v6: securityRules 来自可变的 AgentSettings，BrowserService 是单例——
  // 不能在构造时捕获快照。注入 getter 回调获取实时值。
  // EMPTY_SECURITY_RULES 是 security-host.ts:10 的私有常量，需导出
  // （export const EMPTY_SECURITY_RULES）或在此处重定义。
  const rules = getSecurityRules() ?? EMPTY_SECURITY_RULES;
  // v5: 复用 security-host.ts:561 的 matchesDomainList，不是虚构的 isAllowedDomain
  // 语义：deniedDomains 总是生效；allowedDomains 空 = 非白名单模式（放行），
  // 非空 = 白名单模式（必须命中才放行）。参照 security-host.ts:296-310 的
  // checkConfiguredDeny 逻辑。
  // 全局 networkAccess === "deny" 时任何导航都拦（含所有域名）
  const denied = matchesDomainList(host, rules.deniedDomains);
  const whitelisted = rules.allowedDomains.length > 0
    && !matchesDomainList(host, rules.allowedDomains);
  const globalDeny = rules.networkAccess === "deny";
  if (denied || whitelisted || globalDeny) {
    log.warn('browser.navigation.blocked', { url, host });
    await page.goBack().catch(() => {});
    emitNavigationBlocked(pageId, url, host);
  }
});
```

> **v6 补充 — securityRules 来源与 EMPTY_SECURITY_RULES 导出**：
> BrowserService 是主进程单例，但 `securityRules` 存在于可变的
> `AgentSettings`（用户可在 Settings UI 实时修改）。因此：
> 1. **不能在构造时捕获快照**——必须注入 getter 回调 `getSecurityRules:
>    () => AgentSettings["securityRules"]`，framenavigated 触发时实时读取。
>    参照项目现有的 `getAgentSettings()`（`config-service.ts:1029`）模式，
>    可直接 `() => getAgentSettings().securityRules`。
> 2. **EMPTY_SECURITY_RULES 需导出**——该常量定义在
>    `security-host.ts:10`，当前无 `export` 关键字。实现时需添加
>    `export` 前缀，或在 BrowserService 内部重定义等价常量。
> 3. **matchesDomainList 也需导出**——该函数定义在
>    `security-host.ts:561`，当前是模块私有。BrowserService 需引用它。
>    建议导出，或在 navigation-policy.ts 中提供等价实现（该文件已复用
>    isAllowedExternalUrl 逻辑）。

> **v5 补充 — matchesDomainList 空列表语义**：
> `matchesDomainList(host, [])` 调用 `configured.some(...)` → 空数组返回
> `false`。如果不区分空/非空语义，直接写
> `!matchesDomainList(host, rules.allowedDomains)` 会导致空配置时
> `!false === true` → 所有导航被 goBack() → 浏览器工具完全不可用。
> 正确语义：
> - `allowedDomains` 为空 → 非白名单模式 → 放行（仅 deniedDomains 生效）
> - `allowedDomains` 非空 → 白名单模式 → 必须命中才放行
> - `networkAccess === "deny"` → 全局禁网 → 任何导航都拦
> 默认配置 `allowedDomains: []` + `networkAccess: "ask"` → 放行 + 仅拦 deniedDomains。

> 这层检查对**所有导航来源**生效：navigate 工具、click 触发的跳转、
> JS `window.location` 重定向、表单 submit。只针对 Playwright 管理的
> 模型浏览器实例，不影响用户的 WebContentsView。

- `navigation-policy.ts` 的 `isAllowedExternalUrl` 复用到 browser.navigate 审批
- `sandbox-broker.ts` 扩展浏览器沙箱配置

> **用户浏览器边界（v3 补充）**：WebContentsView 里用户的自由导航（手动输入
> URL、点击链接）**不应受** `isAllowedExternalUrl` 限制——那是给模型工具调用的
> 安全策略。用户浏览器是用户自主行为，不受模型安全策略约束。实现时区分
> "模型发起的 navigate"（过审批）和"用户发起的 navigate"（不过审批）。

**PTY 审批困难（风险标注，v4 更新）**：

逐条审批对交互式会话基本失效——模型可以先 `terminal.exec python`，
再 `terminal.write "import os; os.system('rm -rf ~')"`——write 的输入不是
shell 命令，无法静态审批。

> **v4 修正 — 解决"审计不阻断"矛盾**：v3 在这里写"方案 2 = 审计 + 回放，
> 不阻断"，但上文 3a 把 write 归为 `command_execution` → sensitive → 默认
> ask（阻断），两句矛盾。v4 用 SessionApprovalTracker 统一：exec 审批后
> session 被标记，后续 write 在 canUseTool 短路放行 + 审计（不阻断）。
> write 不走 SecurityHost，所以 `command_execution` 分类在短路后无实际影响。
> 未被 exec 批准的 session 上的 write → 走正常 ask（安全兜底）。

可选方案：

1. 会话启动时锁定为受限 shell / 受限 PATH
2. write 输入全程审计 + 回放（事后追责，不阻断）
3. 交互式会话要求更高的 sandbox profile（danger-full-access 需用户显式授权）

第一版采用方案 2（审计 + 回放，接入 AUDIT_LIST，通过 SessionApprovalTracker
实现不阻断）+ 方案 1（受限 PATH）。

### 第二阶段：工具暴露 (Step 4-7)

#### Step 4: Claude Runtime 接入 — in-process SDK MCP

**文件**: `client/main/core/runtime/sdk-terminal-mcp.ts` (新建) +
`client/main/core/runtime/sdk-browser-mcp.ts` (新建) +
`client/main/core/runtime/claude-runtime.ts` (修改)

> 照抄 `sdk-command-sandbox.ts` 的 `createSdkMcpServer` + `tool()` 模式，
> 不走 settings 预置 mcpServers 配置。

```typescript
// sdk-terminal-mcp.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { terminalService } from "../services/terminal-service";

export const SDK_TERMINAL_SERVER_NAME = "marloues_terminal";
export const SDK_TERMINAL_TOOL_EXEC = `mcp__${SDK_TERMINAL_SERVER_NAME}__exec`;
export const SDK_TERMINAL_TOOL_WRITE = `mcp__${SDK_TERMINAL_SERVER_NAME}__write`;
export const SDK_TERMINAL_TOOL_READ = `mcp__${SDK_TERMINAL_SERVER_NAME}__read`;
export const SDK_TERMINAL_TOOL_RESIZE = `mcp__${SDK_TERMINAL_SERVER_NAME}__resize`;

// Canonical 名映射（供 SecurityHost / disallowedTools 使用）
export function canonicalTerminalToolName(toolName: string): string {
  const map: Record<string, string> = {
    [SDK_TERMINAL_TOOL_EXEC]: "terminal.exec",
    [SDK_TERMINAL_TOOL_WRITE]: "terminal.write",
    [SDK_TERMINAL_TOOL_READ]: "terminal.read",
    [SDK_TERMINAL_TOOL_RESIZE]: "terminal.resize",
  };
  return map[toolName] ?? toolName;
}

export function createSdkTerminalServer(
  permitManager: TurnPermitManager,
  approvalTracker: SessionApprovalTracker,
) {
  return createSdkMcpServer({
    name: SDK_TERMINAL_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool("exec", "Start an interactive PTY session.", {
        command: z.string(),
        cwd: z.string().optional(),
      }, async (input) => {
        // v4: canUseTool 已审批 exec，标记 session 供后续 write/read 短路
        const sessionId = terminalService.spawn(input.cwd ?? process.cwd(), {});
        approvalTracker.markSessionApproved(sessionId);
        terminalService.write(sessionId, input.command + "\n");
        // readUntilStable: 300ms 静默窗口 + 5000ms 总上限
        const output = await terminalService.readUntilStable(sessionId, 300, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify({ sessionId, output }) }] };
      }),
      tool("write", "Write to an active PTY session.", {
        sessionId: z.string(),
        data: z.string(),
      }, async (input) => {
        // v4: canUseTool 短路时已审计，这里只执行
        terminalService.write(input.sessionId, input.data);
        return { content: [{ type: "text" as const, text: "ok" }] };
      }),
      tool("read", "Read incremental output from an active PTY session.", {
        sessionId: z.string(),
      }, async (input) => {
        const result = terminalService.read(input.sessionId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }),
      tool("resize", "Resize an active PTY session.", {
        sessionId: z.string(),
        cols: z.number(),
        rows: z.number(),
      }, async (input) => {
        terminalService.resize(input.sessionId, input.cols, input.rows);
        return { content: [{ type: "text" as const, text: "ok" }] };
      }),
    ],
  });
}
```

> **permit 队列生命周期（v3 关键修正）**：`createSdkTerminalServer` 接收一个
> `TurnPermitManager` 参数（per-turn 创建），而非在模块级单例里持有 permit 队列。
> `claude-runtime.ts:1265` 每 turn new 一个 `TurnPermitManager`，传给 terminal
> server 和 browser server。turn 结束时 `permitManager.clear()` 清理队列，
> TerminalService 的 PTY 会话不受影响。

在 `claude-runtime.ts:1272` 的 `sdkMcpServers` 参数里注入：

```typescript
const permitManager = new TurnPermitManager();
// v5: approvalTracker 是 ClaudeRuntime 实例字段（构造时创建），不是 per-turn 局部变量
// this.approvalTracker 在构造函数初始化，通过闭包传给 server 工厂

sdkMcpServers: {
  [SDK_SANDBOX_SERVER_NAME]: sdkCommandSandbox.server,
  [SDK_TERMINAL_SERVER_NAME]: createSdkTerminalServer(permitManager, this.approvalTracker),
  [SDK_BROWSER_SERVER_NAME]: createSdkBrowserServer(permitManager, this.approvalTracker),
},
```

#### Step 5: Self-built Runtime 接入 — registerTool + executePlan 扩展

**文件**: `client/main/core/runtime/self-built-runtime.ts` (修改)

> 不是"零摩擦"。registerTool 机制存在，但 self-built runtime 的执行循环是
> intent-based（`planTurn` 解析 `/list` `/read` `/patch` 命令，
> `self-built-runtime.ts:484`），没有模型驱动的 tool-calling 通路。

需要做两件事：

1. 在 `registerBuiltinTools()` 里追加 terminal.* 和 browser.* 工具注册
   （目前 `registerBuiltinTools` 只注册了 `memory.echo` 一个；
   `self-built.fs.list` 是 `executePlan` 内联的，不是注册工具）

2. 扩展 `planTurn` / `executePlan` 路由，新增 intent：
   - `/term <command>` → intent: "terminal" → 调 terminalService.spawn
   - `/browse <url>` → intent: "browser" → 调 browserService.navigate

> **v5 补充 — self-built 审批路径**：self-built runtime 走自己的
> `evaluateSecurity` 链路（`self-built-runtime.ts` 内），不经过 Claude
> Runtime 的 `canUseTool` / `SessionApprovalTracker`。`/term` 构造的
> toolName 应与 canonical 短名一致（`"terminal.exec"`），以便复用
> SecurityHost 的 `command_execution` 类别推断和审批 UI。但 self-built
> 是一次性路由（无后续 write/read 交互），不需要 tracker 短路——
> 每次调用都走正常审批。`/browse` 同理（toolName = `"browser.navigate"`）。

#### Step 6: Binary Runtime 接入 — 策略 1 (事件拦截)

**文件**: `client/main/core/runtime/binary-runtime.ts` (修改)

第一版采用策略 1（Codex 用内置工具 + 事件拦截）。Codex 只支持 stdio 子进程
MCP，子进程里没有 TerminalService 单例，且需要额外的"子进程→主进程"IPC 桥，
工作量大且收益低。Binary Runtime 不额外注册终端工具。

#### Step 7: Binary Runtime 事件拦截

**文件**: `client/main/core/runtime/binary-runtime.ts` (修改)

> **事件名修正**：事件名不是 `exec_command`，实际是 `command_execution`。
> `binary-runtime.ts:589` 检查 `event.item.type === "command_execution"`，
> `:597` 映射为 `toolName: "Bash"` 的 tool-start/tool-complete 事件。
> `exec_command` 这个名字在代码里不存在。

这个映射已经实现了，Step 7 只需在已有的 `command_execution` → `Bash`
事件处理分支里，把输出额外转发到 renderer 的 xterm 面板。

### 第三阶段：工具定义完善 (Step 8-9)

#### Step 8: Terminal 工具定义

**文件**: `client/main/core/runtime/sdk-terminal-mcp.ts` (Step 4 已建)

| 工具名 (canonical) | 实际全名 (Claude Runtime) | 输入 | 返回 |
|-------------------|--------------------------|------|------|
| terminal.exec | mcp__marloues_terminal__exec | command, cwd | sessionId + 首批输出 + stable标记 |
| terminal.write | mcp__marloues_terminal__write | sessionId, data | "ok" (fire-and-forget) |
| terminal.read | mcp__marloues_terminal__read | sessionId | 增量输出 + stable标记 + exitCode? |
| terminal.resize | mcp__marloues_terminal__resize | sessionId, cols, rows | "ok" |

> **terminal.read 增量语义（v3 补充）**：sessionId 内维护 read 游标，
> read 默认返回自上次读取以来的增量（非全量缓存）。避免长会话重复 read
> 导致 token 爆炸。`readUntilStable` 是 exec 内部调用的阻塞版本，
> 等待输出在指定窗口内无新增后返回全量首屏。

#### Step 9: Browser 工具定义

**文件**: `client/main/core/runtime/sdk-browser-mcp.ts` (Step 4 已建)

| 工具名 (canonical) | 实际全名 (Claude Runtime) | 输入 | 行为 |
|-------------------|--------------------------|------|------|
| browser.navigate | mcp__marloues_browser__navigate | url | 打开/导航页面 |
| browser.screenshot | mcp__marloues_browser__screenshot | pageId?, fullPage? | 截图 |
| browser.click | mcp__marloues_browser__click | pageId?, selector | 点击元素 |
| browser.fill | mcp__marloues_browser__fill | pageId?, selector, value | 填写输入框 |
| browser.get_text | mcp__marloues_browser__get_text | pageId?, selector? | 获取页面文本 |

> **v5 补充**：click/fill/screenshot/get_text 的 `pageId` 参数可选，
> 缺省时读 `BrowserService.getActivePageId(threadId)`。

### 第四阶段：UI 与通信 (Step 10-12)

#### Step 10: IPC 通道扩展 + preload 层

**文件**: `client/shared/types.ts` (IPC 枚举 + MarlouesAPI 类型) +
`client/preload/index.ts` (修改) +
`client/main/ipc/handlers.ts` (修改)

> **v3 补充 preload 层**：项目所有 renderer→main 通道都经 preload
> （`contextBridge.exposeInMainWorld` + `MarlouesAPI` 类型）暴露。
> Step 10 必须把 preload 层列入文件清单。

新增 IPC 通道：
- `terminal:spawn` (renderer→main, 用户手动开终端 tab)
- `terminal:data` (main→renderer, PTY 输出推送)
- `terminal:write` (renderer→main, 键盘输入)
- `terminal:resize` (renderer→main, 尺寸调整)
- `terminal:kill` (renderer→main, 终止会话)
- `terminal:list` (renderer→main, 列出活跃会话，renderer reload 后恢复)
- `terminal:history` (renderer→main, 获取全量输出回放)
- `browser:navigate` (renderer→main)
- `browser:new_page` (renderer→main, 用户手动开浏览器 tab)
- `browser:close_page` (renderer→main, 关闭 page)
- `browser:list_pages` (renderer→main, 列出活跃 page, renderer reload 后恢复)
- `browser:screenshot` (main→renderer)
- `browser:url-changed` (main→renderer, 模型 navigate 后推送 URL 到 UI)

`preload/index.ts` 新增 `terminal` 和 `browser` API 命名空间：

```typescript
const api: MarlouesAPI = {
  // ... 现有 ...
  terminal: {
    spawn: (cwd) => ipcRenderer.invoke(IPC.TERMINAL_SPAWN, cwd),
    write: (sessionId, data) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, sessionId, data),
    onData: (callback) => { /* ipcRenderer.on(IPC.TERMINAL_DATA, ...) */ },
    list: () => ipcRenderer.invoke(IPC.TERMINAL_LIST),
    history: (sessionId) => ipcRenderer.invoke(IPC.TERMINAL_HISTORY, sessionId),
    kill: (sessionId) => ipcRenderer.invoke(IPC.TERMINAL_KILL, sessionId),
  },
  browser: {
    navigate: (url) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, url),
    newPage: (url) => ipcRenderer.invoke(IPC.BROWSER_NEW_PAGE, url),
    closePage: (pageId) => ipcRenderer.invoke(IPC.BROWSER_CLOSE_PAGE, pageId),
    listPages: () => ipcRenderer.invoke(IPC.BROWSER_LIST_PAGES),
    onUrlChanged: (callback) => { /* ipcRenderer.on(IPC.BROWSER_URL_CHANGED, ...) */ },
    screenshot: () => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT),
  },
};
```

#### Step 11: TerminalPanel 组件

**文件**: `client/renderer/src/components/workbench/auxiliary-sidebar/panels/TerminalPanel.tsx` +
`client/renderer/src/components/workbench/auxiliary-sidebar/types.ts` (修改) +
`client/renderer/src/components/workbench/auxiliary-sidebar/catalog.ts` (修改) +
`client/renderer/src/components/workbench/auxiliary-sidebar/panels/index.ts` (修改) +
`client/renderer/src/components/workbench/auxiliary-sidebar/AuxiliarySidebar.tsx` (修改) +
`client/shared/types.ts` (修改, MarlouesAPI.terminal 新增 spawn 返回值类型)

> **v6 补充 — 面板注册**：TerminalPanel 不是独立组件，需接入辅助侧边栏的
> 面板注册体系（参照现有 OutputsPanel / FileExplorer / MemoryPanel / ReviewPanel）：
> 1. `types.ts`：`AuxiliaryStaticViewType` 联合类型追加 `"terminal"`
> 2. `catalog.ts`：`AUXILIARY_VIEW_OPTIONS` 追加
>    `{ type: "terminal", label: "终端", icon: TerminalSquare }`（lucide 图标）
> 3. `panels/index.ts`：barrel export 追加 `export { TerminalPanel } from "./TerminalPanel"`
> 4. `AuxiliarySidebar.tsx`：import TerminalPanel，渲染分支追加
>    `tab.type === "terminal" ? <TerminalPanel sessionId={tab.sessionId} /> :`
>    （现有 if/else 链在 `tabs.map` 内，参照 files/outputs/memory/review 分支写法）
>
> **v6 补充 — 多 tab 走辅助侧边栏 tab 体系**：
> 终端支持开多个 tab（多个 PTY 会话），复用辅助侧边栏已有的 tab 管理
> （打开/关闭/切换/拖拽排序/scroll-into-view），不在面板内部另建 tab 系统。
> 需要改 4 处（均在 `AuxiliarySidebar.tsx`）：
> 1. **`TabState`** 追加 `sessionId?: string` 字段——每个终端 tab 关联一个
>    PTY session。参照现有 `subagentId` / `reviewTarget` 的模式
> 2. **`addTab`** 去掉同类型只允许一个的限制：当前逻辑
>    `const existing = tabs.find((tab) => tab.type === type)` 找到已有同类型
>    tab 就只切过去不新建。改为：terminal/browser 类型每次都新建 tab
>    （`if (type === "terminal" || type === "browser") { 每次新建 }`），
>    其余类型保持单例行为不变
> 3. **`availableViews`** 过滤逻辑调整：当前
>    `AUXILIARY_VIEW_OPTIONS.filter(option => !tabs.some(tab => tab.type === option.type))`
>    会把已有 tab 的类型从"添加"菜单里隐藏。改为 terminal/browser 类型
>    不受此过滤——始终出现在添加菜单里（用户可开任意数量）
> 4. **`tabLabel`** 终端 tab 显示会话标识：默认 "终端"，模型 spawn 的
>    会话用命令名做后缀（如 "终端 · python"），用户手动开的用序号
>    （"终端 1"、"终端 2"）。参照 subagent tab 的动态 label 逻辑
>
> TerminalPanel 本身只管单个 session 的 xterm 渲染，不涉及 tab 切换逻辑。
> `terminal:spawn` IPC 返回 sessionId 后，renderer 调 `addTab("terminal")`
> 并在新 tab 的 `sessionId` 上绑定该 session。

基于 `@xterm/xterm` + `@xterm/addon-fit`：
- 通过 IPC 双向绑定 TerminalService
- 支持多 tab 切换会话（`terminal:spawn` 创建新 tab）
- xterm.onData -> IPC terminal:write
- IPC terminal:data -> term.write
- renderer reload 后通过 `terminal:list` + `terminal:history` 恢复 xterm buffer
- 兼容 Binary Runtime 的 Codex Bash 事件输出

#### Step 12: BrowserPanel 组件

**文件**: `client/renderer/src/components/workbench/auxiliary-sidebar/panels/BrowserPanel.tsx` +
`client/renderer/src/components/workbench/auxiliary-sidebar/types.ts` (修改) +
`client/renderer/src/components/workbench/auxiliary-sidebar/catalog.ts` (修改) +
`client/renderer/src/components/workbench/auxiliary-sidebar/panels/index.ts` (修改) +
`client/renderer/src/components/workbench/auxiliary-sidebar/AuxiliarySidebar.tsx` (修改) +
`client/main/services/browser-view-manager.ts` (新建, 方案 B 的 WebContentsView 管理)

> **v6 补充 — 面板注册**：与 TerminalPanel 同理，接入辅助侧边栏注册体系：
> 1. `types.ts`：`AuxiliaryStaticViewType` 追加 `"browser"`
> 2. `catalog.ts`：`AUXILIARY_VIEW_OPTIONS` 追加
>    `{ type: "browser", label: "浏览器", icon: Globe }`（lucide 图标）
> 3. `panels/index.ts`：barrel export 追加 `export { BrowserPanel } from "./BrowserPanel"`
> 4. `AuxiliarySidebar.tsx`：import BrowserPanel，渲染分支追加
>    `tab.type === "browser" ? <BrowserPanel pageId={tab.pageId} /> :`
>
> **v6 补充 — 多 tab 走辅助侧边栏 tab 体系**：
> 与终端同理，浏览器面板支持开多个 tab（多个 page），复用辅助侧边栏
> tab 管理。需要改 4 处（与终端共用，不重复列）：
> 1. **`TabState`** 追加 `pageId?: string` 字段——每个浏览器 tab 关联一个 page
> 2. **`addTab`** browser 类型每次新建（同 terminal）
> 3. **`availableViews`** browser 类型不受过滤（同 terminal）
> 4. **`tabLabel`** 浏览器 tab 显示页面 hostname 或标题：
>    模型 navigate 后 `browser:url-changed` 推送 URL，提取 hostname
>    做标签（如 "example.com"），默认 "浏览器"。参照 Chrome tab 标签逻辑
>
> BrowserPanel 本身只管单个 page 的 WebContentsView 渲染和 URL 同步，
> 不涉及 tab 切换逻辑。`browser:navigate` IPC 返回 pageId 后，renderer
> 调 `addTab("browser")` 并在新 tab 的 `pageId` 上绑定该 page。
>
> Step 10 的 IPC 通道需对应补齐：新增 `browser:new_page`（renderer→main,
> 用户手动开浏览器 tab）和 `browser:close_page`（renderer→main, 关闭 page），
> 返回/传入 pageId。`browser:list_pages`（renderer→main, 列出活跃 page，
> renderer reload 后恢复）。preload 的 `browser` 命名空间对应追加
> `newPage` / `closePage` / `listPages` 方法。

> **v6 补充 — WebContentsView 管理**：方案 B 的用户浏览器视图
> （Electron `WebContentsView`）是主进程组件，不在 renderer 里。
> 新建 `browser-view-manager.ts` 管理其生命周期（创建、attach 到
> BaseWindow、URL 同步、销毁），与 BrowserService（Playwright 管模型浏览器）
> 分工明确：BrowserService 管模型的工作浏览器，BrowserViewManager 管用户
> 看的浏览器面板。

> **决策分叉点**：Playwright 启动的 Chromium（模型操作）和
> Electron WebContentsView（用户看）是两个独立浏览器内核实例，状态会分叉。

两个方案：

- **方案 A（CDP 共享视图）**：Playwright 通过 CDP 连接到 Electron 自身的
  webContents，模型和用户真正同一页面。复杂但体验统一。
- **方案 B（双浏览器，推荐第一版）**：明确"模型的工作浏览器"（Playwright
  headless，截图给模型）与"用户的浏览器"（独立 WebContentsView）是两个东西。

> **v3 补充 — 方案 B 最小同步**：模型调 `browser.navigate` 时，它去了哪个 URL
> 至少要推到 UI——新增 `browser:url-changed` IPC 推送，或消息流内展示。
> 否则用户面对静止的浏览器面板，完全不知道模型在浏览器里做什么。

第一版建议方案 B + 最小同步，后续按需升级到方案 A。

### 第五阶段：跨平台适配 (Step 13-14)

#### Step 13: 跨平台终端适配

| 方面 | macOS | Windows |
|------|-------|---------|
| PTY 底层 | openpty() / posix_openpt | ConPTY (CreatePseudoConsole) |
| 默认 Shell | /bin/zsh -l | pwsh.exe 或 powershell.exe |
| PATH 分隔符 | `:` | `;` |
| 环境变量大小写 | 严格区分 | 不区分 |
| 信号机制 | SIGHUP/SIGTERM/SIGKILL | 只有 SIGTERM (TerminateProcess) |
| IPC 传输 | Unix domain socket | 命名管道 (如需) |
| node-pty 编译 | node-gyp + Xcode CLT | node-gyp + MSVC Build Tools |
| ANSI 支持 | 原生 256色 + truecolor | ConPTY 支持，旧版有限 |

> **v3 修正**：resolveShell() 不再硬编码路径，改用 `where`/`which` 探测。

```typescript
private resolveShell() {
  if (process.platform === "win32") {
    // 优先探测 pwsh.exe (PowerShell 7+)，其次 powershell.exe (5.1)
    const pwsh = which("pwsh.exe") ?? which("powershell.exe");
    return {
      executable: pwsh ?? "powershell.exe",
      args: ["-NoLogo", "-NoProfile"],
    };
  }
  return {
    executable: process.env.SHELL || "/bin/zsh",
    args: ["-l"],
  };
}
```

#### Step 14: 跨平台浏览器适配

| 方面 | macOS | Windows |
|------|-------|---------|
| Chromium 路径 | Playwright 自带或 /Applications/Google Chrome.app | Playwright 自带或 C:\Program Files\Google\Chrome\ |
| Chrome 扩展 manifest | ~/Library/.../NativeMessagingHosts/ | 注册表 HKCU\Software\...\NativeMessagingHosts\ |
| Computer Use | AppleScript + Accessibility API (AXUIElement) | Windows UI Automation API |
| 截图 | screen.capturePage() 或 CGWindowListCreateImage | screen.capturePage() 或 BitBlt/DXGI |
| 沙箱 | App Sandbox / TCC 权限 | job object 限制 |

### 第六阶段：测试 (Step 15-17)

#### Step 15: 单元测试

**目录**: `tests/unit/`

- TerminalService 和 BrowserService 核心方法测试（mock PTY/Playwright）
- SDK MCP server 工具 schema 校验测试
- canonical 名映射函数测试
- SecurityHost 权限审批测试（含 browser.navigate 走 network_access 类别）
- PTY write 输入审计回放测试
- SessionApprovalTracker 短路逻辑测试（exec 审批后 write/read/resize 自动放行 + 审计；未批准 session 上的 write 走 ask）
- BrowserService `framenavigated` 拦截测试（click/fill 触发的跳转被 allowedDomains 拦截；JS `window.location` 重定向被拦截）
- TTL 过期后 session/page 不再短路放行的测试
- approvalTracker 跨 turn 存活测试（turn 1 exec 批准 → turn 2 write 仍短路放行）
- storm check 在短路之前执行测试（模型反复 write 相同内容 → 第 3 次 storm deny）
- matchesDomainList 空列表语义测试（allowedDomains: [] → 非白名单模式 → 放行）
- matchesDomainList 非空列表语义测试（allowedDomains: ["example.com"] → 白名单模式 → 非匹配域名被拦）
- networkAccess: "deny" 全局禁网测试（framenavigated 拦截所有导航）
- activePageId 状态测试（首次 navigate 创建 page → 后续 navigate 在当前 page 导航 → click/fill 缺省读 activePageId）
- exec handler permit 消费测试（consumePermit 失败时抛异常）
- 工厂函数 this vs 参数测试（createSdkTerminalServer/createSdkBrowserServer 内 handler 用 approvalTracker 参数，不是 this.approvalTracker——this 在工厂函数内为 undefined）
- consumePermit 同步签名测试（返回 permit 或 null，非回调模式；参照 sdk-command-sandbox.ts:43-48）
- 浏览器懒启动测试（首次 navigate 无 browserId → 调 launch() 并缓存 → 二次 navigate 不再 launch）
- framenavigated securityRules getter 测试（注入的 getter 返回实时 AgentSettings.securityRules；运行时修改 allowedDomains 后新导航立即受新规则约束）
- permit authorize→consume 完整链路测试（canUseTool allow 分支调 permitManager.authorize → handler 内 consumePermit 成功取值）
- 辅助侧边栏多 tab 测试（addTab 同类型可多次创建；availableViews 对 terminal/browser 不隐藏；tabLabel 显示会话标识/页面 hostname）

#### Step 16: 暴露矩阵验证

> **v3 修正标题**：不叫"一致性测试"——Binary Runtime 不提供 terminal.exec，
> 三个 Runtime 的能力矩阵本就不一致。

**目录**: `tests/contract/`

| 能力 | Binary | Claude | Self-built |
|------|--------|--------|------------|
| 一次性命令 (Bash) | Codex 内置 | marloues_sandbox.bash | executePlan /list |
| 交互式 PTY (terminal.exec) | 不提供 | mcp__marloues_terminal__exec | registerTool |
| 浏览器 (browser.navigate) | 不提供 | mcp__marloues_browser__navigate | /browse 路由 |
| 事件拦截到 xterm | command_execution → Bash | 不需要 | 不需要 |

验证点：
- Claude Runtime: `sdkMcpServers` 注入后 `listTools()` 包含 mcp__marloues_terminal__* / mcp__marloues_browser__*
- Self-built Runtime: `registerBuiltinTools` + `executePlan` 路由后工具可用
- Binary Runtime: 不提供 terminal.exec，Codex Bash 事件拦截输出到达 xterm
- canonical 名映射：disallowedTools 配 `terminal.exec` 能拦住 Claude 的 `mcp__marloues_terminal__exec`

#### Step 17: E2E 冒烟测试

**目录**: `tests/e2e/` + `tests/smoke/`

扩展 Playwright Electron 冒烟用例：
- 终端面板能执行命令并显示输出（Claude Runtime 下 terminal.exec）
- 终端面板能显示 Codex Bash 输出（Binary Runtime 下事件拦截）
- 终端面板 renderer reload 后能恢复（terminal:list + terminal:history）
- 终端多 tab：用户开两个终端 tab，各自独立执行命令，切换不丢输出
- 浏览器多 tab：用户开两个浏览器 tab，各自导航不同 URL，切换不丢页面
- 浏览器面板能加载页面并截图
- browser.navigate 后 UI 收到 url-changed 推送
- Runtime 切换后终端/浏览器面板仍正常工作

## 决策分叉点

1. **Step 6 (Binary Runtime 策略)**: 第一版走策略 1（事件拦截），后续是否投入 stdio MCP + IPC 桥
2. **Step 12 (浏览器同视图)**: 方案 A（CDP 共享视图）vs 方案 B（双浏览器 + 最小同步），第一版建议 B
3. **Step 3 (PTY 审批粒度)**: ~~交互式 write 输入无法静态审批，选择审计回放还是受限 shell~~ v4 已解决：SessionApprovalTracker 实现 exec 审批后 write/read 短路放行 + 审计（不阻断），未被 exec 批准的 session 上的 write 仍走 ask 兜底
4. **Step 0 (包体积)**: Playwright Chromium +150MB 是否接受，或用系统 Chrome

## 落地顺序

```
Step 0     依赖安装与原生模块编译 (最先，暴露 Windows MSVC 问题)
Step 1-3   后端服务 + 安全层 (Mac 先跑通，安全同步做)
Step 4     Claude Runtime 接入 (in-process SDK MCP + permit 生命周期)
Step 8-9   工具定义完善
Step 10-11 IPC + preload + xterm UI (闭环验证)
Step 5     Self-built Runtime 接入 (registerTool + executePlan 扩展)
Step 6-7   Binary Runtime 事件拦截
Step 12    BrowserPanel UI (含浏览器同视图决策 + 最小同步)
Step 13-14 跨平台适配
Step 15-17 测试
```
