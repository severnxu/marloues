const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class MarketplaceHttpError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MarketplaceHttpError";
    this.status = status;
  }
}

export async function requestMarketplaceJson<T>(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Marloues-Marketplace/1.0",
        ...options.headers,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (_error) {
    throw new MarketplaceHttpError("无法连接市场端点。");
  }

  if (!response.ok) {
    throw new MarketplaceHttpError(
      `市场端点返回 HTTP ${response.status}。`,
      response.status,
    );
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new MarketplaceHttpError("市场端点响应数据过大。", response.status);
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    throw new MarketplaceHttpError("市场端点响应数据过大。", response.status);
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as T;
  } catch (_error) {
    throw new MarketplaceHttpError(
      "市场端点返回的数据不是有效 JSON。",
      response.status,
    );
  }
}

export async function requestMarketplaceBinary(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    maxBytes?: number;
  } = {},
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/octet-stream, application/zip",
        "User-Agent": "Marloues-Marketplace/1.0",
        ...options.headers,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (_error) {
    throw new MarketplaceHttpError("无法下载市场资源。");
  }

  if (!response.ok) {
    throw new MarketplaceHttpError(
      `市场资源返回 HTTP ${response.status}。`,
      response.status,
    );
  }

  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new MarketplaceHttpError("市场资源超过安全限制。", response.status);
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new MarketplaceHttpError("市场资源超过安全限制。", response.status);
  }
  return Buffer.from(body);
}

export function normalizeMarketplaceBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) throw new MarketplaceHttpError("市场端点未配置。");
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new MarketplaceHttpError("市场端点地址无效。");
  }
  return normalized;
}
