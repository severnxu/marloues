const DEFAULT_TIMEOUT_MS = 30_000;
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
  normalizeMarketplaceUrl(url);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Marloues-Marketplace/1.0",
        ...options.headers,
      },
      redirect: "error",
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

  const body = await readLimitedResponse(
    response,
    MAX_RESPONSE_BYTES,
    "市场端点响应数据过大。",
  );

  try {
    return JSON.parse(body.toString("utf8")) as T;
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
  normalizeMarketplaceUrl(url);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/octet-stream, application/zip",
        "User-Agent": "Marloues-Marketplace/1.0",
        ...options.headers,
      },
      redirect: "error",
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
  return readLimitedResponse(response, maxBytes, "市场资源超过安全限制。");
}

export function normalizeMarketplaceBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) throw new MarketplaceHttpError("市场端点未配置。");
  normalizeMarketplaceUrl(normalized);
  return normalized;
}

function normalizeMarketplaceUrl(value: string): URL {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }
    if (parsed.username || parsed.password) throw new Error();
    return parsed;
  } catch {
    throw new MarketplaceHttpError("市场端点地址无效。");
  }
}

async function readLimitedResponse(
  response: Response,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Buffer> {
  const rawContentLength = response.headers.get("content-length");
  const contentLength = rawContentLength ? Number(rawContentLength) : 0;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new MarketplaceHttpError(tooLargeMessage, response.status);
  }

  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > maxBytes) {
      throw new MarketplaceHttpError(tooLargeMessage, response.status);
    }
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new MarketplaceHttpError(tooLargeMessage, response.status);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}
