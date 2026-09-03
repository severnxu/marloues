import type {
  EndpointTestResult,
  SkillInstallSource,
  SkillMarketplaceDetail,
  SkillMarketplaceEndpoint,
  SkillMarketplaceItem,
  SkillMarketplaceListRequest,
  SkillMarketplaceListResponse,
} from "@shared/types";
import { getAgentSettings } from "../config-service";
import {
  MarketplaceHttpError,
  normalizeMarketplaceBaseUrl,
  requestMarketplaceJson,
} from "../marketplace-http-client";

const SKILLSMP_SEARCH_PATH = "/api/v1/skills/search";
const STANDARD_DETAIL_PATH = "/api/v1/skills";
const MAX_PAGE_SIZE = 50;

interface RemoteSkillRecord {
  id?: string;
  slug?: string;
  name?: string;
  cnName?: string;
  description?: string;
  descriptionZh?: string;
  author?: string;
  ownerHandle?: string;
  ownerName?: string;
  version?: string;
  githubUrl?: string;
  sourceUrl?: string;
  homepageUrl?: string;
  homepage?: string;
  iconUrl?: string;
  tags?: unknown;
  stars?: number;
  updatedAt?: string | number;
  install?: SkillInstallSource;
  content?: string;
}

interface RemotePagination {
  page?: number;
  total?: number;
  hasMore?: boolean;
  nextCursor?: string;
}

interface SkillsMpSearchResponse {
  success?: boolean;
  data?: {
    skills?: RemoteSkillRecord[];
    pagination?: RemotePagination;
  };
  error?: { message?: string };
}

interface StandardSkillListResponse {
  success?: boolean;
  data?: {
    items?: RemoteSkillRecord[];
    pagination?: RemotePagination;
  };
  items?: RemoteSkillRecord[];
  pagination?: RemotePagination;
}

interface StandardSkillDetailResponse {
  success?: boolean;
  data?: RemoteSkillRecord;
}

const remoteSkillCache = new Map<string, RemoteSkillRecord>();

export function getEnabledSkillMarketplaceEndpoint(): SkillMarketplaceEndpoint {
  const endpoint = getAgentSettings().skillMarketplaceEndpoint;
  if (!endpoint?.enabled) {
    throw new MarketplaceHttpError("Skill 市场端点未启用。");
  }
  return endpoint;
}

export async function listRemoteSkills(
  request: SkillMarketplaceListRequest = {},
  endpoint = getEnabledSkillMarketplaceEndpoint(),
): Promise<SkillMarketplaceListResponse> {
  if (!isConfiguredEndpoint(endpoint)) {
    return { items: [], total: 0, hasMore: false };
  }
  const baseUrl = normalizeMarketplaceBaseUrl(endpoint.baseUrl);
  const pageNo = Math.max(1, Number(request.cursor) || request.pageNo || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, request.pageSize ?? 20));
  const query = request.query?.trim();

  const url = new URL(`${baseUrl}${SKILLSMP_SEARCH_PATH}`);
  url.searchParams.set(
    "q",
    query || (isSkillsmpEndpoint(baseUrl) ? "skill" : ""),
  );
  url.searchParams.set("page", String(pageNo));
  url.searchParams.set(
    isSkillsmpEndpoint(baseUrl) ? "limit" : "pageSize",
    String(pageSize),
  );
  if (isSkillsmpEndpoint(baseUrl)) url.searchParams.set("sortBy", "stars");
  if (request.tagId && !isSkillsmpEndpoint(baseUrl)) {
    url.searchParams.set("tag", request.tagId);
  } else if (request.tagId) {
    url.searchParams.set("category", request.tagId);
  }

  const payload = await requestMarketplaceJson<SkillsMpSearchResponse>(
    url.toString(),
  );
  if (isSkillsmpPayload(payload)) {
    if (payload.success === false) {
      throw new MarketplaceHttpError("Skill 市场端点返回数据异常。");
    }
    const records = payload.data?.skills ?? [];
    cacheRemoteSkills(baseUrl, records);
    const pagination = payload.data?.pagination;
    const total = pagination?.total;
    const hasMore =
      pagination?.hasMore ?? (total !== undefined && pageNo * pageSize < total);
    return {
      items: records.map((record) => toSkillItem(record, baseUrl)),
      total,
      nextCursor: hasMore ? String(pageNo + 1) : pagination?.nextCursor,
      hasMore,
    };
  }

  const standard = payload as StandardSkillListResponse;
  const records = standard.data?.items ?? standard.items ?? [];
  if (!Array.isArray(records)) {
    throw new MarketplaceHttpError("Skill 市场端点协议不兼容。");
  }
  cacheRemoteSkills(baseUrl, records);
  const pagination = standard.data?.pagination ?? standard.pagination;
  const total = pagination?.total;
  const hasMore =
    pagination?.hasMore ?? (total !== undefined && pageNo * pageSize < total);
  return {
    items: records.map((record) => toSkillItem(record, baseUrl)),
    total,
    nextCursor:
      pagination?.nextCursor ?? (hasMore ? String(pageNo + 1) : undefined),
    hasMore,
  };
}

function isConfiguredEndpoint(endpoint: SkillMarketplaceEndpoint): boolean {
  const baseUrl = endpoint.baseUrl.trim();
  return Boolean(
    baseUrl &&
      baseUrl !== "https://" &&
      baseUrl !== "http://" &&
      baseUrl !== "https:" &&
      baseUrl !== "http:",
  );
}

export async function getRemoteSkillDetail(
  slug: string,
  endpoint = getEnabledSkillMarketplaceEndpoint(),
): Promise<SkillMarketplaceDetail> {
  const baseUrl = normalizeMarketplaceBaseUrl(endpoint.baseUrl);
  const cached = remoteSkillCache.get(cacheKey(baseUrl, slug));
  if (isSkillsmpEndpoint(baseUrl)) {
    const record = cached ?? (await findSkillsmpRecord(slug, endpoint));
    const item = toSkillItem(record, baseUrl);
    return {
      ...item,
      content: "",
      install: githubInstallSource(record.githubUrl),
      securityStatus: "unknown",
      securitySummary:
        "来源为 SkillsMP 索引的 GitHub 公开目录。安装时不会执行第三方脚本。",
    };
  }

  const record =
    cached?.content !== undefined
      ? cached
      : await fetchStandardSkillDetail(slug, endpoint);
  if (!record) {
    throw new MarketplaceHttpError("未找到该 Skill。");
  }
  remoteSkillCache.set(cacheKey(baseUrl, slug), record);
  const item = toSkillItem(record, baseUrl);
  return {
    ...item,
    content: record.content ?? "",
    install: normalizeInstallSource(record.install, item.sourceUrl),
    securityStatus: "unknown",
    securitySummary: "安装时不会执行第三方脚本。",
  };
}

export async function testSkillMarketplaceEndpoint(
  endpoint: SkillMarketplaceEndpoint,
): Promise<EndpointTestResult> {
  const startedAt = Date.now();
  try {
    await listRemoteSkills({ pageSize: 1, pageNo: 1 }, endpoint);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: "Skill 市场端点连接正常。",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message:
        error instanceof MarketplaceHttpError
          ? error.message
          : "Skill 市场端点连接失败。",
    };
  }
}

async function findSkillsmpRecord(
  slug: string,
  endpoint: SkillMarketplaceEndpoint,
): Promise<RemoteSkillRecord> {
  const response = await listRemoteSkills(
    { query: slug, pageNo: 1, pageSize: MAX_PAGE_SIZE },
    endpoint,
  );
  const match = response.items.find((item) => item.slug === slug);
  if (!match) throw new MarketplaceHttpError("未找到该 Skill。");
  return (
    remoteSkillCache.get(cacheKey(endpoint.baseUrl, slug)) ?? {
      id: match.slug,
      name: match.name,
      githubUrl: match.sourceUrl,
    }
  );
}

async function fetchStandardSkillDetail(
  slug: string,
  endpoint: SkillMarketplaceEndpoint,
): Promise<RemoteSkillRecord | null> {
  const baseUrl = normalizeMarketplaceBaseUrl(endpoint.baseUrl);
  const payload = await requestMarketplaceJson<StandardSkillDetailResponse>(
    `${baseUrl}${STANDARD_DETAIL_PATH}/${encodeURIComponent(slug)}`,
  );
  const record = payload.data ?? (payload as RemoteSkillRecord);
  return record && typeof record === "object" ? record : null;
}

function isSkillsmpEndpoint(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === "skillsmp.com" || host.endsWith(".skillsmp.com");
}

function isSkillsmpPayload(
  payload: SkillsMpSearchResponse,
): payload is SkillsMpSearchResponse &
  Required<Pick<SkillsMpSearchResponse, "data">> {
  return payload.data?.skills !== undefined;
}

function cacheRemoteSkills(
  baseUrl: string,
  records: RemoteSkillRecord[],
): void {
  for (const record of records) {
    const slug = skillSlug(record);
    if (slug) remoteSkillCache.set(cacheKey(baseUrl, slug), record);
  }
}

function cacheKey(baseUrl: string, slug: string): string {
  return `${normalizeMarketplaceBaseUrl(baseUrl)}:${slug}`;
}

function toSkillItem(
  record: RemoteSkillRecord,
  baseUrl: string,
): SkillMarketplaceItem {
  const slug = skillSlug(record);
  if (!slug || !record.name) {
    throw new MarketplaceHttpError("Skill 市场端点返回数据异常。");
  }
  const sourceUrl =
    record.sourceUrl ??
    record.githubUrl ??
    record.homepageUrl ??
    record.homepage ??
    `${baseUrl}/api/v1/skills/${encodeURIComponent(slug)}`;
  return {
    slug,
    name: record.name,
    cnName: record.cnName ?? record.descriptionZh,
    description: record.description,
    ownerHandle: record.ownerHandle ?? record.ownerName ?? record.author,
    version: record.version,
    stars: record.stars,
    tags: normalizeTags(record.tags),
    updatedAt: normalizeTimestamp(record.updatedAt),
    installed: false,
    sourceUrl,
  };
}

function normalizeInstallSource(
  source: SkillInstallSource | undefined,
  fallbackSourceUrl: string,
): SkillInstallSource | undefined {
  if (
    source?.type === "github" ||
    source?.type === "archive" ||
    source?.type === "files"
  ) {
    return source;
  }
  if (/^https:\/\/github\.com\//i.test(fallbackSourceUrl)) {
    return githubInstallSource(fallbackSourceUrl);
  }
  return undefined;
}

function githubInstallSource(
  url: string | undefined,
): SkillInstallSource | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
    const [, owner, repository, type, ref, ...rest] = parsed.pathname
      .split("/")
      .filter(Boolean);
    if (!owner || !repository) return undefined;
    const path = type === "tree" ? rest.join("/") : "";
    return {
      type: "github",
      repositoryUrl: `https://github.com/${owner}/${repository}`,
      ref: type === "tree" ? ref : undefined,
      path: path ? `${path}/` : "",
    };
  } catch {
    return undefined;
  }
}

function skillSlug(record: RemoteSkillRecord): string | undefined {
  return record.slug?.trim() || record.id?.trim();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (tag): tag is string => typeof tag === "string" && Boolean(tag.trim()),
  );
}

function normalizeTimestamp(
  value: string | number | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  return undefined;
}
