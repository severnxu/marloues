/**
 * Marloues 编译时注入的环境变量
 *
 * 通过 electron.vite.config.ts �?define 块，�?.env.{BUILD_ENV} 读取
 * 并在编译时替换为字面量。运行时不再读取 process.env，打包产物中已是定值�? *
 * 使用方式：import { MARLOUES_ENV } from "@shared/env";
 *
 * 新增变量时需同步�? * 1. �?.env.dev / .env.prod 添加键�? * 2. 在此�?declare const 并加�?MARLOUES_ENV
 * 3. �?electron.vite.config.ts �?loadEnv 自动拾取（MARLOUES_ 前缀�? */

declare const __MARLOUES_SSO_BASE_URL__: string | undefined;
declare const __MARLOUES_SSO_LOGIN_URL__: string | undefined;
declare const __MARLOUES_DEV_BYPASS_SSO__: string | undefined;
declare const __MARLOUES_ANALYTICS_ENABLED__: string | undefined;
declare const __MARLOUES_ANALYTICS_APP_ID__: string | undefined;
declare const __MARLOUES_ANALYTICS_SUB_APP_ID__: string | undefined;
declare const __MARLOUES_ANALYTICS_ENV__: string | undefined;
declare const __MARLOUES_ANALYTICS_DEBUG__: string | undefined;
declare const __MARLOUES_ANALYTICS_PROTOCOL__: string | undefined;
declare const __MARLOUES_PERMISSION_CHECK_ENABLED__: string | undefined;
declare const __MARLOUES_RUNTIME_BASE_URL__: string | undefined;
declare const __MARLOUES_UPDATE_PROVIDER__: string | undefined;
declare const __MARLOUES_UPDATE_URL__: string | undefined;
declare const __MARLOUES_UPDATE_GITHUB_REPO__: string | undefined;
declare const __MARLOUES_BUILD_ENV__: string | undefined;
declare const __MARLOUES_HOT_UPDATE_PUBLIC_KEY__: string | undefined;

function readStr(value: string | undefined, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBool(value: string | undefined, fallback = false): boolean {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value === "true" || value === "1";
}

/** 编译时拾取的环境变量集合（只读） */
export const MARLOUES_ENV = {
  buildEnv: readStr(
    typeof __MARLOUES_BUILD_ENV__ !== "undefined"
      ? __MARLOUES_BUILD_ENV__
      : undefined,
    "dev",
  ),
  /** SSO(CAS) 后端 API 基地址 */
  ssoBaseUrl: readStr(
    typeof __MARLOUES_SSO_BASE_URL__ !== "undefined"
      ? __MARLOUES_SSO_BASE_URL__
      : undefined,
  ),
  /** SSO 登录页地址 */
  ssoLoginUrl: readStr(
    typeof __MARLOUES_SSO_LOGIN_URL__ !== "undefined"
      ? __MARLOUES_SSO_LOGIN_URL__
      : undefined,
  ),
  /** 开发模式跳�?SSO（用模拟用户�?*/
  devBypassSso: readBool(
    typeof __MARLOUES_DEV_BYPASS_SSO__ !== "undefined"
      ? __MARLOUES_DEV_BYPASS_SSO__
      : undefined,
  ),
  /** 行为埋点是否启用 */
  analyticsEnabled: readBool(
    typeof __MARLOUES_ANALYTICS_ENABLED__ !== "undefined"
      ? __MARLOUES_ANALYTICS_ENABLED__
      : undefined,
  ),
  /** 行为埋点 App ID */
  analyticsAppId: readStr(
    typeof __MARLOUES_ANALYTICS_APP_ID__ !== "undefined"
      ? __MARLOUES_ANALYTICS_APP_ID__
      : undefined,
  ),
  /** 行为埋点子应�?ID（默认同 analyticsAppId�?*/
  analyticsSubAppId: readStr(
    typeof __MARLOUES_ANALYTICS_SUB_APP_ID__ !== "undefined"
      ? __MARLOUES_ANALYTICS_SUB_APP_ID__
      : undefined,
  ),
  /** 行为埋点上报环境：release（生产）| test（测试） */
  analyticsEnv: readStr(
    typeof __MARLOUES_ANALYTICS_ENV__ !== "undefined"
      ? __MARLOUES_ANALYTICS_ENV__
      : undefined,
  ),
  /** 行为埋点 debug 模式（输�?WA SDK 内部日志�?*/
  analyticsDebug: readBool(
    typeof __MARLOUES_ANALYTICS_DEBUG__ !== "undefined"
      ? __MARLOUES_ANALYTICS_DEBUG__
      : undefined,
  ),
  /** 行为埋点上报协议：ipv4 | ipv6 */
  analyticsProtocol: readStr(
    typeof __MARLOUES_ANALYTICS_PROTOCOL__ !== "undefined"
      ? __MARLOUES_ANALYTICS_PROTOCOL__
      : undefined,
    "ipv4",
  ),
  /** SSO 权限检查是否启用（默认 true�?*/
  permissionCheckEnabled: readBool(
    typeof __MARLOUES_PERMISSION_CHECK_ENABLED__ !== "undefined"
      ? __MARLOUES_PERMISSION_CHECK_ENABLED__
      : undefined,
    true,
  ),
  /** 按需语言运行时下载源根地址（manifest + runtime 包） */
  runtimeBaseUrl: readStr(
    typeof __MARLOUES_RUNTIME_BASE_URL__ !== "undefined"
      ? __MARLOUES_RUNTIME_BASE_URL__
      : undefined,
  ),
  /** 业务更新�?provider：generic（自建静态站）| github（默�?generic�?*/
  updateProvider: readStr(
    typeof __MARLOUES_UPDATE_PROVIDER__ !== "undefined"
      ? __MARLOUES_UPDATE_PROVIDER__
      : undefined,
    "generic",
  ),
  /** 业务更新�?feed URL（generic 模式：托�?latest-mac.yml + 安装包） */
  updateUrl: readStr(
    typeof __MARLOUES_UPDATE_URL__ !== "undefined"
      ? __MARLOUES_UPDATE_URL__
      : undefined,
  ),

  /** ҵ�����Դ GitHub repo��github ģʽ������ʽ owner/repo */
  updateGithubRepo: readStr(
    typeof __MARLOUES_UPDATE_GITHUB_REPO__ !== "undefined"
      ? __MARLOUES_UPDATE_GITHUB_REPO__
      : undefined,
  ),
  hotUpdatePublicKey: readStr(
    typeof __MARLOUES_HOT_UPDATE_PUBLIC_KEY__ !== "undefined"
      ? __MARLOUES_HOT_UPDATE_PUBLIC_KEY__
      : undefined,
  ),
} as const;
