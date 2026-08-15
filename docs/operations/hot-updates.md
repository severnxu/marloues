# Marloues 更新与 UI 热更新

Marloues 使用三种彼此独立的更新机制：

- 开发模式由 electron-vite/Vite 提供 HMR。
- 完整客户端通过 `electron-updater` 更新，适用于主进程、preload、原生依赖和 Electron 版本变化。
- UI 热更新只替换已构建的 renderer 包，不修改主进程和 preload。

UI 热更新不是完整客户端更新的替代品。任何 IPC、权限边界、Node 依赖或原生代码变化，都必须发布新的完整客户端。

## 安全模型

每个 UI feed 包含：

```text
stable/
  manifest.json
  manifest.sig
  packages/
    marloues-ui-1.2.3.zip
```

`manifest.json` 携带 `keyId`、通道、构建环境、最低客户端版本、协议版本、包大小和 SHA-512。客户端先使用内置公钥验证清单的 Ed25519 签名，再下载同源 HTTPS 包并校验大小和 SHA-512。

安装时会执行以下保护：

1. 拒绝绝对路径、`..`、UNC、盘符路径和 NUL 路径。
2. 限制压缩条目数量、单文件大小和总解压大小。
3. 在同一磁盘的 staging 目录完成校验，再通过 rename 激活版本目录。
4. 新版本先进入 `pending`，加载时进入 `booting`。
5. renderer 必须在 15 秒内提交版本、协议和能力握手。
6. 加载失败、握手超时或启动中断会隔离失败版本并回滚到 last-good 或内置 UI。

运行时可以使用 `--disable-hot-update` 强制启动内置 UI。

## 首次配置签名密钥

生成密钥时必须明确指定长期稳定的 `keyId`：

```powershell
npm run key:hot -- --key-id official-2026-01
```

命令会：

- 将私钥写到被 Git 忽略的 `client/keys/`。
- 将公钥加入 `client/resources/hot-update-public-keys.json`。

私钥不能提交到仓库。生成后应立即制作加密离线备份，并把 PEM 内容存入 CI Secret `MARLOUES_HOT_UPDATE_PRIVATE_KEY`。公钥不是秘密，应随客户端源码发布。

GitHub Actions 的热更新工作流还需要配置：

- Repository variable `MARLOUES_HOT_UPDATE_KEY_ID`，例如 `official-2026-01`
- Repository variable `MARLOUES_HOT_UPDATE_URL`，本仓库应为 `https://marloues.github.io/marloues/ui`
- Repository secret `MARLOUES_HOT_UPDATE_PRIVATE_KEY`

首次使用前，在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中将 Source 设为 **GitHub Actions**。UI feed 是公开更新文件；私钥只保存在 Actions Secret 中，不会进入 Pages artifact。

## 公钥轮换

正常轮换必须按以下顺序执行：

1. 生成下一把私钥和公钥。
2. 在 `hot-update-public-keys.json` 同时保留旧公钥和新公钥。
3. 发布并推动用户安装包含两把公钥的完整客户端版本。
4. 等待该客户端版本成为最低支持版本。
5. 将 UI 清单改用新 `keyId` 签名。
6. 后续完整客户端版本可以移除旧公钥。

如果私钥疑似泄漏，应停止用该密钥发布并发布新的完整客户端撤销旧公钥。仅靠 UI 热更新无法安全修改主进程内置的信任根。

## 构建配置

这些值在 electron-vite 构建阶段注入客户端：

| 变量                                   | 用途                                       |
| -------------------------------------- | ------------------------------------------ |
| `MARLOUES_BUILD_ENV`                   | 构建环境，正式包建议为 `production`        |
| `MARLOUES_CLIENT_UPDATE_PROVIDER`      | `github` 或 `generic`                      |
| `MARLOUES_CLIENT_UPDATE_URL`           | generic 完整客户端 feed 的 HTTPS 地址      |
| `MARLOUES_HOT_UPDATE_URL`              | UI feed 根 HTTPS 地址，不包含通道名        |
| `MARLOUES_HOT_UPDATE_PUBLIC_KEYS_FILE` | 公钥 JSON；默认读取仓库内的 resources 文件 |
| `MARLOUES_REQUIRE_HOT_UPDATE=1`        | 发布构建缺少 URL 或公钥时直接失败          |

客户端最终请求 `${MARLOUES_HOT_UPDATE_URL}/stable/manifest.json`，测试版和每夜版分别使用 `beta`、`nightly`。

## 发布 UI 包

1. 按 SemVer 提升 `client/ui-version.json`。
2. 用正式构建环境和正式 feed URL 构建 renderer。
3. 使用对应私钥签名。
4. 本地验证签名、哈希和 UI 身份。
5. 将整个通道目录原样部署到 HTTPS 静态源。

```powershell
$env:MARLOUES_BUILD_ENV="production"
$env:MARLOUES_HOT_UPDATE_URL="https://updates.example.com/marloues/ui"
$env:MARLOUES_REQUIRE_HOT_UPDATE="1"
npm run build
npm run publish:hot -- --channel stable --key-id official-2026-01 --notes "更新说明"
npm run verify:hot -- --channel stable
```

`publish-hot-update.mjs` 会拒绝覆盖相同或更低的 UI 版本。正式部署需要保证 `manifest.json`、`manifest.sig` 和 `packages/` 同时可用；推荐先上传包，再原子替换清单和签名。

### 通过 GitHub 发布

仓库的 **Build signed UI hot-update feed** 工作流支持手动选择 `stable`、`beta` 或 `nightly`，构建并验证签名后发布到 GitHub Pages。公开地址结构为：

```text
https://marloues.github.io/marloues/ui/
  stable/manifest.json
  beta/manifest.json
  nightly/manifest.json
```

Pages 每次部署会替换整个站点，因此工作流会先从当前 Pages 站点读取另外两个通道，再和本次生成的通道一起验证和部署。首次发布时尚不存在的通道会按 404 跳过；已有通道下载失败、路径不安全或验证失败时会终止部署，不会静默删除线上通道。

完整客户端仍由 `Release` 工作流发布到 GitHub Releases；UI 热更新由这个工作流发布到 GitHub Pages。二者职责独立。

`Release` 工作流会把仓库变量 `MARLOUES_HOT_UPDATE_URL` 和已提交的公钥一起嵌入正式客户端；缺少 URL 或可信公钥时，正式打包会直接失败，避免发布无法使用 UI 热更新的安装包。

## 用户控制

设置页的“更新”区域提供：

- 稳定版、测试版、每夜版通道选择。
- 自动检查、自动下载、自动应用 UI 更新三个独立开关。
- 手动检查、下载、应用和忽略当前版本。
- 客户端版本、UI 版本、下载进度、错误和可信 `keyId` 展示。

完整客户端即使自动下载，也不会自动安装；安装和重启始终由用户触发。UI 自动应用只刷新 renderer，不安装完整客户端。

## 验证清单

合并前至少执行：

```powershell
npm run typecheck
npm run test:unit
npm run lint
npm run build
```

首次配置正式密钥后，还应在打包应用中覆盖：下载成功、签名篡改、包哈希错误、renderer 加载失败、15 秒握手超时、进程在 booting 状态退出以及自动回滚。
