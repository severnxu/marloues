import type {
  EndpointModelsResult,
  EndpointTestResult,
  ModelOption,
  ModelProviderConfig,
} from "@shared/types";
import { diagnoseEndpointModel } from "../core/sdk/endpoint-diagnostics";

const DEFAULT_TIMEOUT_MS = 10_000;

export async function listEndpointModels(
  profile: ModelProviderConfig,
): Promise<EndpointModelsResult> {
  const startedAt = Date.now();
  const validation = validateProfile(profile);
  if (validation)
    return {
      ok: false,
      message: validation,
      models: [],
      latencyMs: Date.now() - startedAt,
    };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl(profile, "/models"), {
      method: "GET",
      headers: endpointHeaders(profile),
      signal: controller.signal,
    });
    const body = await readJson(response);
    const models = extractModels(body);

    if (!response.ok) {
      if (shouldTryRootModelsFallback(profile, response.status)) {
        const fallback = await listRootEndpointModels(
          profile,
          startedAt,
          controller.signal,
        );
        if (fallback.ok) return fallback;
      }
      return {
        ok: false,
        status: response.status,
        message: endpointErrorMessage(response.status, body),
        latencyMs: Date.now() - startedAt,
        models: [],
      };
    }

    return {
      ok: true,
      status: response.status,
      message: models.length
        ? `Discovered ${models.length} model(s).`
        : "Endpoint is reachable, but returned no models.",
      latencyMs: Date.now() - startedAt,
      models,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Model list request timed out."
          : errorMessage(error),
      latencyMs: Date.now() - startedAt,
      models: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testEndpointModel(
  profile: ModelProviderConfig,
  modelId: string,
): Promise<EndpointTestResult> {
  const startedAt = Date.now();
  const validation = validateProfile(profile);
  if (validation)
    return {
      ok: false,
      message: validation,
      latencyMs: Date.now() - startedAt,
    };
  const model = modelId.trim();
  if (!model)
    return {
      ok: false,
      message: "Model ID cannot be empty.",
      latencyMs: Date.now() - startedAt,
    };

  const result = await diagnoseEndpointModel({
    baseUrl: profile.baseUrl,
    apiKey: resolveApiKey(profile),
    model,
    protocol: diagnosticProtocol(profile.type),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  return {
    ok: result.ok,
    status: result.status,
    latencyMs: Date.now() - startedAt,
    message: result.ok
      ? `Model is available: ${model}`
      : `${model}: ${result.message}`,
  };
}

export async function testEndpointProfile(
  profile: ModelProviderConfig,
): Promise<EndpointTestResult> {
  const result = await listEndpointModels(profile);
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    latencyMs: result.latencyMs,
  };
}

function validateProfile(profile: ModelProviderConfig): string | null {
  if (
    profile.type !== "openai-compatible" &&
    profile.type !== "openai-chat" &&
    profile.type !== "openai-responses" &&
    profile.type !== "anthropic"
  ) {
    return `Unsupported endpoint type: ${profile.type}`;
  }
  if (!profile.baseUrl?.trim()) return "Base URL cannot be empty.";
  try {
    new URL(profile.baseUrl.trim());
  } catch {
    return "Base URL must be a valid URL.";
  }
  if (!resolveApiKey(profile)) return "API Key cannot be empty.";
  return null;
}

function endpointUrl(profile: ModelProviderConfig, path: string): string {
  const url = new URL(profile.baseUrl?.trim() ?? "");
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath.endsWith("/v1") ? basePath : `${basePath}/v1`}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function listRootEndpointModels(
  profile: ModelProviderConfig,
  startedAt: number,
  signal: AbortSignal,
): Promise<EndpointModelsResult> {
  const response = await fetch(rootEndpointUrl(profile, "/models"), {
    method: "GET",
    headers: endpointHeaders(profile),
    signal,
  });
  const body = await readJson(response);
  const models = extractModels(body);
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: `Fallback /models request failed: ${endpointErrorMessage(response.status, body)}`,
      latencyMs,
      models: [],
    };
  }

  return {
    ok: models.length > 0,
    status: response.status,
    message: models.length
      ? `Discovered ${models.length} model(s) from fallback /models.`
      : "Fallback /models is reachable, but returned no models.",
    latencyMs,
    models,
  };
}

function shouldTryRootModelsFallback(
  profile: ModelProviderConfig,
  status: number,
): boolean {
  if (status !== 404 && status !== 405) return false;
  try {
    const url = new URL(profile.baseUrl ?? "");
    const path = url.pathname.replace(/\/+$/, "");
    return path !== "" && path !== "/";
  } catch {
    return false;
  }
}

function rootEndpointUrl(profile: ModelProviderConfig, path: string): string {
  const url = new URL(profile.baseUrl ?? "");
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function endpointHeaders(profile: ModelProviderConfig): Record<string, string> {
  const apiKey = resolveApiKey(profile);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (profile.type === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function diagnosticProtocol(
  type: ModelProviderConfig["type"],
): "anthropic" | "openai-chat" | "openai-responses" {
  if (type === "anthropic") return "anthropic";
  if (type === "openai-responses") return "openai-responses";
  return "openai-chat";
}

function resolveApiKey(profile: ModelProviderConfig): string {
  const envKey = profile.apiKeyEnv?.trim();
  if (envKey && process.env[envKey]) return process.env[envKey] ?? "";
  return profile.apiKey?.trim() ?? "";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractModels(body: unknown): ModelOption[] {
  const records = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : [];

  const byId = new Map<string, ModelOption>();
  for (const item of records) {
    const id = modelIdFromItem(item);
    if (!id || byId.has(id)) continue;
    byId.set(id, modelOptionFromItem(item, id));
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function modelOptionFromItem(item: unknown, id: string): ModelOption {
  const record = isRecord(item) ? item : {};
  return stripUndefined({
    id,
    label: modelLabelFromItem(item) ?? id,
    enabled: true,
    contextWindowTokens: readPositiveInteger(
      record.context_window_tokens ??
        record.contextWindowTokens ??
        record.context_length ??
        record.contextLength,
    ),
    maxOutputTokens: readPositiveInteger(
      record.max_output_tokens ??
        record.maxOutputTokens ??
        record.output_tokens ??
        record.outputTokens,
    ),
    supportsVision: readBoolean(
      record.supports_vision ?? record.supportsVision ?? record.vision,
    ),
    supportsThinking: readBoolean(
      record.supports_thinking ?? record.supportsThinking ?? record.thinking,
    ),
  });
}

function modelIdFromItem(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (!isRecord(item)) return null;
  const id = item.id ?? item.name ?? item.model;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function modelLabelFromItem(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const label =
    item.display_name ?? item.displayName ?? item.label ?? item.name;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

function readPositiveInteger(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(number)) return undefined;
  const normalized = Math.trunc(number);
  return normalized > 0 ? normalized : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function endpointErrorMessage(status: number, body: unknown): string {
  const detail = endpointErrorDetail(body);
  if (/2056|usage limit exceeded/i.test(detail)) {
    return "Endpoint returned usage limit exceeded (2056). Check token plan quota or try another model.";
  }
  if (/1008|insufficient balance/i.test(detail)) {
    return "Endpoint returned insufficient balance (1008). Check account balance or token plan resources.";
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|not authorized|unauthorized|forbidden/i.test(detail)
  ) {
    return `Endpoint authorization failed (HTTP ${status}). Check API key and model permissions.`;
  }
  if (status === 404) {
    return "Model list endpoint was not found. This provider may not support /v1/models; enter the model ID manually.";
  }
  if (status === 429 || /rate_limit/i.test(detail)) {
    return `Endpoint is rate limited or quota is exhausted (HTTP ${status}). Try again later or check quota.`;
  }
  if (status >= 500) {
    return `Endpoint is reachable, but the service returned an error (HTTP ${status}).`;
  }
  return `Model list request failed: HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

function endpointErrorDetail(body: unknown): string {
  if (typeof body === "string") return body.trim().slice(0, 500);
  if (!isRecord(body)) return "";
  const error = body.error;
  if (typeof error === "string") return error.trim().slice(0, 500);
  if (isRecord(error) && typeof error.message === "string")
    return error.message.trim().slice(0, 500);
  if (typeof body.message === "string")
    return body.message.trim().slice(0, 500);
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
