# Skill 与 MCP 市场接入方案

## 目标

Marloues 将 Skill 与 MCP 市场视为两类不同的供应链：

- Skill 是写入本地运行时目录的指令与资源文件。
- MCP 是远程服务地址或可启动的本地第三方进程配置。

市场只负责发现和元数据展示。下载、校验、安装与配置写入全部由 Electron 主进程完成，渲染器不直接请求第三方市场。

## 市场选择

### Skill

| 市场 | 接入方式 | 当前能力 | 打包态安装策略 |
| --- | --- | --- | --- |
| SkillsMP | `/api/v1/skills/search` | 搜索、GitHub 来源解析 | 因没有版本文件清单，默认只允许浏览；开发态可安装 |
| ClawHub（默认） | `/api/v1/search`、详情、版本、下载 API | 搜索、分页、详情、安全状态、ZIP 安装 | 仅允许安装状态为 clean 且文件清单完整的固定版本 |

`skills.sh` 已评估，但其 API 需要 Vercel OIDC token，不适合作为桌面客户端匿名直连的内置源，因此本阶段不接入。

### MCP

| 市场 | 接入方式 | 当前能力 | 安装策略 |
| --- | --- | --- | --- |
| Official MCP Registry | `/v0.1/servers` | 搜索、游标分页、最新版本详情、包与远程传输解析 | 默认源；安装前展示最终配置 |
| Smithery | `/servers` | 搜索、分页、详情、托管连接解析 | 可选预设；安装前展示远程地址 |

除内置适配器外，原有标准 Skill/MCP 市场协议继续保留，供私有市场使用。

## 架构

```text
Renderer marketplace UI
        |
        | typed preload IPC
        v
Main process marketplace service
        |
        +-- source adapter (SkillsMP / ClawHub / Official / Smithery)
        |
        +-- bounded HTTP client
        |
        +-- Skill installer / MCP config installer
        v
runtime-config/skills or encrypted settings
```

适配器将第三方字段转换为 `SkillMarketplaceDetail` 或 `McpMarketplaceDetail`。安装服务只消费内部类型，不包含某个市场的响应格式判断。

## Skill 安装信任链

ClawHub 的可安装版本必须同时满足：

1. 详情指向固定版本，下载 URL 显式携带版本号。
2. 内部标识使用 `owner/slug`；ClawHub 列表偶尔只返回裸 slug 时，通过 exact search 补全 owner，避免同名 Skill 的 409 歧义。
3. 版本安全状态为 `clean`。
4. 版本 API 为每个运行时文件提供合法 SHA-256。
5. 解压前校验声明文件数、单文件大小和总大小，避免 ZIP bomb。
6. 解压后拒绝路径穿越、清单外文件、缺失文件、大小不符和摘要不符。
7. ClawHub 下载时动态生成的 `_meta.json` 与版本清单字节不同；该文件不参与运行，因此直接丢弃，不写入 Skill 目录。
8. 全部校验通过后，才以目录重命名方式完成安装。

这里实现的是“受信任 Registry + HTTPS + 固定版本文件摘要”的完整性校验，不等同于作者私钥签名。后续可在内部类型上增加 publisher signature，再将其纳入同一安装策略。

SkillsMP 返回 GitHub 来源，但没有可用于打包态信任决策的固定版本文件清单。因此生产策略不会把“能下载”误当成“已验证”；用户仍可浏览详情，开发态可用于调试安装。

ClawHub 搜索还会混入来自 skills.sh 的镜像结果，这些结果不属于原生 ClawHub 详情协议，适配器会过滤掉，避免路由误判。原生 GitHub-backed Skill 可能返回 `public-github` handoff JSON 而非 ZIP；当前会给出明确的“没有可验证托管包”错误，不会把 JSON 当 ZIP 解压或在打包态绕过完整性策略。

## MCP 安装安全策略

- 市场卡片的安装按钮先拉取详情，再显示最终远程 URL 或本地命令。
- 用户确认之前不写配置、不下载 npm/Python 包，也不启动 MCP。
- Official Registry 的 `runtimeHint`、`runtimeArguments`、默认环境变量和必填环境变量会被保留。
- 缺少必填环境变量的服务以 `enabled: false` 写入，并记录需要补充的变量名。
- 本地命令明确提示首次运行会下载并执行第三方代码。
- 远程 MCP 明确展示传输类型和目标 URL。

## 网络边界

市场 HTTP 客户端统一执行：

- 仅接受 HTTP/HTTPS，拒绝 URL 内嵌用户名或密码。
- 禁止自动跟随重定向，避免已审阅主机被替换。
- 请求超时。
- 先检查 `Content-Length`，再在流式读取过程中执行硬字节上限。
- JSON 解析失败、协议不兼容和非 2xx 响应均转为可展示的市场错误。

桌面应用允许用户配置私有 HTTP 市场，这是本地用户的显式配置能力；内置公共市场全部使用 HTTPS。

## 测试矩阵

| 层级 | 覆盖内容 |
| --- | --- |
| 单元测试 | SkillsMP 标准协议隔离、ClawHub 映射与校验清单、Official Registry 最新版本与必填环境变量、Smithery 连接映射、流式响应上限 |
| 在线冒烟 | 对四个真实公共端点执行搜索和详情请求，验证当前线上协议 |
| Electron E2E | 从插件页搜索 ClawHub Playwright Skill，打开详情、确认安装、检查真实文件落盘；再搜索 Official Registry filesystem MCP，确认安装并检查缺少环境变量时保持禁用 |
| 构建检查 | 主进程、preload 与 renderer 的生产构建 |

在线冒烟和 E2E 会访问第三方服务，不应放进完全离线的默认单元测试流程；需要时分别运行：

```bash
npm run test:smoke:marketplace-live
cd client
npx playwright test ../tests/e2e/marketplace-live.critical.spec.ts \
  --config playwright.config.ts --project=critical
```

## 后续阶段

1. 增加作者签名、密钥轮换和撤销列表，使信任不只依赖 Registry。
2. 保存已安装 Skill 的版本清单，在每次运行前执行完整性复核。
3. 为 MCP 增加权限声明、OAuth 状态和首次启动隔离。
4. 增加市场健康度、速率限制和缓存状态展示。
5. 为私有市场定义版本化 OpenAPI/JSON Schema，替代宽松兼容解析。
