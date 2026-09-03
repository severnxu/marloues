import type {
  EndpointTestResult,
  McpMarketplaceDetail,
  McpMarketplaceEndpoint,
  McpMarketplaceListRequest,
  McpMarketplaceListResponse,
  McpMarketplacePackage,
  McpMarketplaceRemote,
} from "@shared/types";
import { getAgentSettings } from "../config-service";
import {
  MarketplaceHttpError,
  normalizeMarketplaceBaseUrl,
  requestMarketplaceJson,
} from "../marketplace-http-client";

const OFFICIAL_LIST_PATH = "/v0/servers";
const SMITHERY_LIST_PATH = "/servers";
const STANDARD_LIST_PATH = "/api/v1/servers/search";
const STANDARD_DETAIL_PATH = "/api/v1/servers";
const MAX_PAGE_SIZE = 50;

type MarketplaceKind = "official" | "smithery" | "standard";

interface OfficialServerRecord {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string };
  packages?: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    transport?: unknown;
  }>;
  remotes?: Array<{
    type?: string;
    url?: string;
  }>;
}

interface OfficialServerItem {
  server?: OfficialServerRecord;
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      isLatest?: boolean;
    };
  };
}

interface OfficialServersResponse {
  servers?: OfficialServerItem[];
  metadata?: { nextCursor?: string; count?: number };
}

interface SmitheryServerRecord {
  id?: string;
  qualifiedName?: string;
  displayName?: string;
  description?: string;
  iconUrl?: string;
  verified?: boolean;
  useCount?: number;
  remote?: boolean;
  homepage?: string;
  owner?: string;
  deploymentUrl?: string;
  connections?: Array<{
    type?: string;
    deploymentUrl?: string;
  }>;
}

interface SmitheryServersResponse {
  servers?: SmitheryServerRecord[];
  pagination?: {
    currentPage?: number;
    pageSize?: number;
    totalPages?: number;
    totalCount?: number;
  };
}

interface StandardServerRecord {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  iconUrl?: string;
  tags?: unknown;
  verified?: boolean;
  packages?: McpMarketplacePackage[];
  remotes?: McpMarketplaceRemote[];
}

interface StandardServersResponse {
  success?: boolean;
  data?: {
    items?: StandardServerRecord[];
    pagination?: { total?: number; hasMore?: boolean; nextCursor?: string };
  };
  items?: StandardServerRecord[];
  pagination?: { total?: number; hasMore?: boolean; nextCursor?: string };
}

const remoteServerCache = new Map<string, StandardServerRecord>();

export function getEnabledMcpMarketplaceEndpoint(): McpMarketplaceEndpoint {
  const endpoint = getAgentSettings().mcpMarketplaceEndpoint;
  if (!endpoint?.enabled) {
    throw new MarketplaceHttpError("MCP 市场端点未启用。");
  }
  return endpoint;
}

export async function listRemoteMcpServers(
  request: McpMarketplaceListRequest = {},
  endpoint = getEnabledMcpMarketplaceEndpoint(),
): Promise<McpMarketplaceListResponse> {
  if (!isConfiguredEndpoint(endpoint)) {
    return { items: [], total: 0, hasMore: false };
  }
  const baseUrl = normalizeMarketplaceBaseUrl(endpoint.baseUrl);
  const kind = resolveMarketplaceKind(baseUrl);
  if (kind === "official") {
    return listOfficialServers(baseUrl, request);
  }
  if (kind === "smithery") {
    return listSmitheryServers(baseUrl, request);
  }
  return listStandardServers(baseUrl, request);
}

function isConfiguredEndpoint(endpoint: McpMarketplaceEndpoint): boolean {
  const baseUrl = endpoint.baseUrl.trim();
  return Boolean(
    baseUrl &&
      baseUrl !== "https://" &&
      baseUrl !== "http://" &&
      baseUrl !== "https:" &&
      baseUrl !== "http:",
  );
}

export async function getRemoteMcpServerDetail(
  id: string,
  endpoint = getEnabledMcpMarketplaceEndpoint(),
): Promise<McpMarketplaceDetail> {
  const baseUrl = normalizeMarketplaceBaseUrl(endpoint.baseUrl);
  const kind = resolveMarketplaceKind(baseUrl);
  if (kind === "official") {
    const cached = remoteServerCache.get(cacheKey(baseUrl, id));
    if (cached) return toMcpDetail(cached, false);
    const response = await listOfficialServers(baseUrl, {
      pageSize: MAX_PAGE_SIZE,
    });
    const item = response.items.find((entry) => entry.id === id);
    if (!item) throw new MarketplaceHttpError("未找到该 MCP 服务。");
    return item;
  }

  if (kind === "smithery") {
    const payload = await requestMarketplaceJson<SmitheryServerRecord>(
      `${baseUrl}${SMITHERY_LIST_PATH}/${encodeURIComponent(id)}`,
    );
    const record = {
      ...payload,
      id: payload.qualifiedName ?? id,
    };
    remoteServerCache.set(cacheKey(baseUrl, id), record);
    return toMcpDetail(record, false);
  }

  const payload = await requestMarketplaceJson<
    StandardServersResponse & StandardServerRecord
  >(`${baseUrl}${STANDARD_DETAIL_PATH}/${encodeURIComponent(id)}`);
  const record =
    payload.data && !Array.isArray(payload.data)
      ? (payload.data as StandardServerRecord)
      : payload;
  if (!record || typeof record !== "object" || !record.id) {
    throw new MarketplaceHttpError("未找到该 MCP 服务。");
  }
  remoteServerCache.set(cacheKey(baseUrl, record.id), record);
  return toMcpDetail(record, false);
}

export async function testMcpMarketplaceEndpoint(
  endpoint: McpMarketplaceEndpoint,
): Promise<EndpointTestResult> {
  const startedAt = Date.now();
  try {
    await listRemoteMcpServers({ pageSize: 1, page: 1 }, endpoint);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: "MCP 市场端点连接正常。",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message:
        error instanceof MarketplaceHttpError
          ? error.message
          : "MCP 市场端点连接失败。",
    };
  }
}

async function listOfficialServers(
  baseUrl: string,
  request: McpMarketplaceListRequest,
): Promise<McpMarketplaceListResponse> {
  const pageSize = normalizePageSize(request.pageSize);
  const url = new URL(`${baseUrl}${OFFICIAL_LIST_PATH}`);
  if (request.query?.trim()) {
    url.searchParams.set("q", request.query.trim());
  }
  url.searchParams.set("limit", String(pageSize));
  const cursor = request.cursor?.trim();
  if (cursor) url.searchParams.set("cursor", cursor);

  const payload = await requestMarketplaceJson<OfficialServersResponse>(
    url.toString(),
  );
  const items = dedupeOfficialServers(payload.servers ?? [])
    .map((item) => officialItemToRecord(item))
    .filter((record): record is StandardServerRecord & { id: string } =>
      Boolean(record.id),
    );
  for (const record of items) {
    remoteServerCache.set(cacheKey(baseUrl, record.id), record);
  }
  const nextCursor = payload.metadata?.nextCursor;
  return {
    items: items.map((record) => toMcpDetail(record, false)),
    total: payload.metadata?.count,
    nextCursor,
    hasMore: Boolean(nextCursor),
  };
}

async function listSmitheryServers(
  baseUrl: string,
  request: McpMarketplaceListRequest,
): Promise<McpMarketplaceListResponse> {
  const pageNo = Math.max(1, Number(request.cursor) || request.page || 1);
  const pageSize = normalizePageSize(request.pageSize);
  const url = new URL(`${baseUrl}${SMITHERY_LIST_PATH}`);
  if (request.query?.trim()) {
    url.searchParams.set("q", request.query.trim());
  }
  url.searchParams.set("page", String(pageNo));
  url.searchParams.set("pageSize", String(pageSize));

  const payload = await requestMarketplaceJson<SmitheryServersResponse>(
    url.toString(),
  );
  const records = (payload.servers ?? []).map((server) => ({
    ...server,
    id: server.qualifiedName ?? server.id,
  }));
  for (const record of records) {
    if (record.id) remoteServerCache.set(cacheKey(baseUrl, record.id), record);
  }
  const totalPages = payload.pagination?.totalPages ?? 1;
  const hasMore = pageNo < totalPages;
  return {
    items: records.map((record) => toMcpDetail(record, false)),
    total: payload.pagination?.totalCount,
    nextCursor: hasMore ? String(pageNo + 1) : undefined,
    hasMore,
  };
}

async function listStandardServers(
  baseUrl: string,
  request: McpMarketplaceListRequest,
): Promise<McpMarketplaceListResponse> {
  const pageNo = Math.max(1, Number(request.cursor) || request.page || 1);
  const pageSize = normalizePageSize(request.pageSize);
  const url = new URL(`${baseUrl}${STANDARD_LIST_PATH}`);
  if (request.query?.trim()) {
    url.searchParams.set("q", request.query.trim());
  }
  url.searchParams.set("page", String(pageNo));
  url.searchParams.set("pageSize", String(pageSize));

  const payload = await requestMarketplaceJson<StandardServersResponse>(
    url.toString(),
  );
  const records = payload.data?.items ?? payload.items ?? [];
  if (!Array.isArray(records)) {
    throw new MarketplaceHttpError("MCP 市场端点协议不兼容。");
  }
  for (const record of records) {
    if (record.id) remoteServerCache.set(cacheKey(baseUrl, record.id), record);
  }
  const pagination = payload.data?.pagination ?? payload.pagination;
  const total = pagination?.total;
  const hasMore =
    pagination?.hasMore ?? (total !== undefined && pageNo * pageSize < total);
  return {
    items: records.map((record) => toMcpDetail(record, false)),
    total,
    nextCursor:
      pagination?.nextCursor ?? (hasMore ? String(pageNo + 1) : undefined),
    hasMore,
  };
}

function resolveMarketplaceKind(baseUrl: string): MarketplaceKind {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host === "registry.modelcontextprotocol.io") return "official";
  if (host === "registry.smithery.ai") return "smithery";
  return "standard";
}

function dedupeOfficialServers(
  items: OfficialServerItem[],
): OfficialServerItem[] {
  const latest = items.filter(
    (item) =>
      item._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest,
  );
  const source = latest.length ? latest : items;
  const byName = new Map<string, OfficialServerItem>();
  for (const item of source) {
    const name = item.server?.name;
    if (!name) continue;
    const existing = byName.get(name);
    if (
      !existing ||
      compareVersions(item.server?.version, existing.server?.version) > 0
    ) {
      byName.set(name, item);
    }
  }
  return [...byName.values()];
}

function officialItemToRecord(item: OfficialServerItem): StandardServerRecord {
  const server = item.server ?? {};
  return {
    id: server.name,
    name: server.title ?? server.name,
    description: server.description,
    version: server.version,
    homepageUrl: server.websiteUrl,
    repositoryUrl: server.repository?.url,
    packages: normalizePackages(server.packages ?? []),
    remotes: normalizeOfficialRemotes(server.remotes ?? []),
  };
}

function normalizePackages(
  packages: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    transport?: unknown;
  }>,
): McpMarketplacePackage[] {
  return packages.flatMap((pkg) => {
    const registryType = normalizeRegistryType(pkg.registryType);
    if (!registryType || !pkg.identifier) return [];
    return [
      {
        registryType,
        identifier: pkg.identifier,
        version: pkg.version,
      },
    ];
  });
}

function normalizeRegistryType(
  value: string | undefined,
): McpMarketplacePackage["registryType"] | undefined {
  if (value === "npm") return "npm";
  if (value === "pypi" || value === "pip" || value === "uv") return "pypi";
  if (value === "cargo") return "cargo";
  if (value === "mcpb") return "mcpb";
  if (value === "oci" || value === "docker") return "oci";
  return undefined;
}

function normalizeOfficialRemotes(
  remotes: Array<{ type?: string; url?: string }>,
): McpMarketplaceRemote[] {
  return remotes.flatMap((remote) => {
    if (!remote.url) return [];
    const transport =
      remote.type === "sse" || remote.type === "sse-http" ? "sse" : "http";
    return [{ transport, url: remote.url }];
  });
}

function toMcpDetail(
  record: StandardServerRecord,
  installed: boolean,
): McpMarketplaceDetail {
  const smithery = record as StandardServerRecord & SmitheryServerRecord;
  const id = record.id;
  const name = record.name ?? smithery.displayName ?? smithery.qualifiedName;
  if (!id || !name) {
    throw new MarketplaceHttpError("MCP 市场端点返回数据异常。");
  }
  return {
    id,
    name,
    description: record.description,
    version: record.version,
    author: record.author ?? smithery.owner,
    homepageUrl: record.homepageUrl ?? smithery.homepage,
    repositoryUrl: record.repositoryUrl,
    iconUrl: record.iconUrl,
    tags: normalizeTags(record.tags),
    verified: record.verified,
    installed,
    packages: record.packages ?? [],
    remotes:
      record.remotes ??
      (smithery.connections ?? []).flatMap((connection) =>
        connection.deploymentUrl
          ? [
              {
                transport: connection.type === "sse" ? "sse" : "http",
                url: connection.deploymentUrl,
              },
            ]
          : [],
      ),
  };
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (tag): tag is string => typeof tag === "string" && Boolean(tag.trim()),
  );
}

function normalizePageSize(value: number | undefined): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, value ?? 20));
}

function cacheKey(baseUrl: string, id: string): string {
  return `${normalizeMarketplaceBaseUrl(baseUrl)}:${id}`;
}

function compareVersions(left?: string, right?: string): number {
  const leftParts = (left ?? "0").split(".").map((part) => Number(part) || 0);
  const rightParts = (right ?? "0").split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}
