import { unzipSync } from "fflate";
import type {
  EndpointTestResult,
  SkillDetailFile,
  SkillInstallSource,
  SkillMarketplaceDetail,
  SkillMarketplaceDetailSection,
  SkillMarketplaceEndpoint,
  SkillMarketplaceItem,
  SkillMarketplaceListRequest,
  SkillMarketplaceListResponse,
} from "@shared/types";
import { getAgentSettings } from "../config-service";
import {
  MarketplaceHttpError,
  normalizeMarketplaceBaseUrl,
  requestMarketplaceBinary,
  requestMarketplaceJson,
} from "../marketplace-http-client";

const SKILLSMP_SEARCH_PATH = "/api/v1/skills/search";
const STANDARD_DETAIL_PATH = "/api/v1/skills";
const MAX_PAGE_SIZE = 50;
const MAX_PREVIEW_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_FILE_BYTES = 512 * 1024;
const MAX_PREVIEW_TOTAL_BYTES = 2 * 1024 * 1024;

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
  downloads?: number;
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

interface ClawHubSkillRecord {
  slug?: string;
  source?: string;
  displayName?: string;
  summary?: string;
  description?: string;
  topics?: unknown;
  version?: string;
  downloads?: number;
  ownerHandle?: string;
  canonicalUrl?: string;
  updatedAt?: number;
  stats?: { downloads?: number; stars?: number };
  latestVersion?: {
    version?: string;
    changelog?: string;
    license?: string | null;
  };
  native?: {
    ownerHandle?: string;
    skill?: {
      stats?: { downloads?: number; stars?: number };
      updatedAt?: number;
    };
  };
}

interface ClawHubSearchResponse {
  results?: ClawHubSkillRecord[];
}

interface ClawHubListResponse {
  items?: ClawHubSkillRecord[];
  nextCursor?: string;
}

interface ClawHubDetailResponse {
  skill?: ClawHubSkillRecord;
  latestVersion?: {
    version?: string;
    changelog?: string;
    license?: string | null;
  };
  owner?: { handle?: string };
  moderation?: unknown;
}

interface ClawHubVersionResponse {
  version?: {
    version?: string;
    createdAt?: number;
    changelog?: string;
    changelogSource?: string;
    license?: string | null;
    files?: Array<{
      path?: string;
      size?: number;
      sha256?: string;
      contentType?: string;
    }>;
    security?: {
      status?: string;
      summary?: string;
      scanners?: {
        llm?: { summary?: string; guidance?: string };
        vt?: { analysis?: string };
      };
    };
  };
}

interface ClawHubVersionsResponse {
  items?: Array<{
    version?: string;
    createdAt?: number;
    changelog?: string;
    changelogSource?: string;
  }>;
  nextCursor?: string | null;
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
  if (isClawHubEndpoint(baseUrl)) {
    return listClawHubSkills(baseUrl, request);
  }
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
  version?: string,
  section: SkillMarketplaceDetailSection = "base",
): Promise<SkillMarketplaceDetail> {
  const baseUrl = normalizeMarketplaceBaseUrl(endpoint.baseUrl);
  const cached = remoteSkillCache.get(cacheKey(baseUrl, slug));
  if (isClawHubEndpoint(baseUrl)) {
    return getClawHubSkillDetail(baseUrl, slug, version, section);
  }
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

function isClawHubEndpoint(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === "clawhub.ai" || host.endsWith(".clawhub.ai");
}

async function listClawHubSkills(
  baseUrl: string,
  request: SkillMarketplaceListRequest,
): Promise<SkillMarketplaceListResponse> {
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, request.pageSize ?? request.limit ?? 20),
  );
  const query = request.query?.trim();
  if (query) {
    const url = new URL(`${baseUrl}/api/v1/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(pageSize));
    const payload = await requestMarketplaceJson<ClawHubSearchResponse>(
      url.toString(),
    );
    const records = (payload.results ?? []).filter(
      (record) => !record.source || record.source === "clawhub",
    );
    cacheRemoteSkills(
      baseUrl,
      records.map((record) => clawHubRecordToRemote(record, baseUrl)),
    );
    return {
      items: records.map((record) =>
        toSkillItem(clawHubRecordToRemote(record, baseUrl), baseUrl),
      ),
      total: records.length,
      hasMore: false,
    };
  }

  const url = new URL(`${baseUrl}/api/v1/skills`);
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("sort", "recommended");
  url.searchParams.set("nonSuspiciousOnly", "true");
  if (request.cursor?.trim()) {
    url.searchParams.set("cursor", request.cursor.trim());
  }
  const payload = await requestMarketplaceJson<ClawHubListResponse>(
    url.toString(),
  );
  const records = payload.items ?? [];
  const normalized = records.map((record) =>
    clawHubRecordToRemote(record, baseUrl),
  );
  cacheRemoteSkills(baseUrl, normalized);
  return {
    items: normalized.map((record) => toSkillItem(record, baseUrl)),
    nextCursor: payload.nextCursor,
    hasMore: Boolean(payload.nextCursor),
  };
}

async function getClawHubSkillDetail(
  baseUrl: string,
  reference: string,
  requestedVersion?: string,
  section: SkillMarketplaceDetailSection = "base",
): Promise<SkillMarketplaceDetail> {
  const requested = parseClawHubReference(reference);
  const resolved =
    requested.ownerHandle === undefined
      ? await resolveClawHubOwner(baseUrl, requested.slug)
      : requested;
  const detailUrl = new URL(
    `${baseUrl}/api/v1/skills/${encodeURIComponent(resolved.slug)}`,
  );
  if (resolved.ownerHandle) {
    detailUrl.searchParams.set("ownerHandle", resolved.ownerHandle);
  }
  const payload = await requestMarketplaceJson<ClawHubDetailResponse>(
    detailUrl.toString(),
  );
  const skill = payload.skill;
  if (!skill?.slug || !skill.displayName) {
    throw new MarketplaceHttpError("未找到该 Skill。");
  }
  const latestVersion = payload.latestVersion ?? skill.latestVersion;
  const selectedVersion = requestedVersion?.trim() || latestVersion?.version;
  const shouldFetchVersion =
    Boolean(selectedVersion) &&
    (section === "content" ||
      section === "files" ||
      section === "security" ||
      section === "all");
  const shouldFetchVersions = section === "versions" || section === "all";
  const shouldFetchArchive =
    section === "content" || section === "files" || section === "all";
  const versionUrl = selectedVersion
    ? new URL(
        `${baseUrl}/api/v1/skills/${encodeURIComponent(
          skill.slug,
        )}/versions/${encodeURIComponent(selectedVersion)}`,
      )
    : undefined;
  const ownerHandle =
    payload.owner?.handle ?? skill.ownerHandle ?? resolved.ownerHandle;
  if (versionUrl && ownerHandle) {
    versionUrl.searchParams.set("ownerHandle", ownerHandle);
  }
  const versionsUrl = new URL(
    `${baseUrl}/api/v1/skills/${encodeURIComponent(skill.slug)}/versions`,
  );
  versionsUrl.searchParams.set("limit", String(MAX_PAGE_SIZE));
  if (ownerHandle) versionsUrl.searchParams.set("ownerHandle", ownerHandle);
  const [versionPayload, versionsPayload] = await Promise.all([
    shouldFetchVersion && versionUrl
      ? requestMarketplaceJson<ClawHubVersionResponse>(versionUrl.toString())
      : Promise.resolve(undefined),
    shouldFetchVersions
      ? requestMarketplaceJson<ClawHubVersionsResponse>(
          versionsUrl.toString(),
        ).catch(() => ({ items: [] }))
      : Promise.resolve(undefined),
  ]);
  if (
    requestedVersion &&
    shouldFetchVersion &&
    versionPayload?.version?.version !== requestedVersion
  ) {
    throw new MarketplaceHttpError(`未找到版本 v${requestedVersion}。`);
  }
  const item = toSkillItem(
    clawHubRecordToRemote(
      {
        ...skill,
        ownerHandle,
        version: selectedVersion,
        updatedAt: versionPayload?.version?.createdAt ?? skill.updatedAt,
      },
      baseUrl,
    ),
    baseUrl,
  );
  const security = normalizeClawHubModeration(
    versionPayload?.version?.security ?? payload.moderation,
  );
  const downloadUrl = new URL(`${baseUrl}/api/v1/download`);
  downloadUrl.searchParams.set("slug", skill.slug);
  if (ownerHandle) {
    downloadUrl.searchParams.set("ownerHandle", ownerHandle);
  }
  if (selectedVersion) {
    downloadUrl.searchParams.set("version", selectedVersion);
  }
  const versionFiles = normalizeClawHubFiles(versionPayload);
  const previewContents =
    shouldFetchArchive && versionFiles.length
      ? await loadClawHubPreviewContents(
          downloadUrl.toString(),
          versionFiles,
        ).catch(() => new Map<string, string>())
      : new Map<string, string>();
  const selectedContent =
    previewContents.get("SKILL.md") ??
    (selectedVersion === latestVersion?.version ? skill.description : "") ??
    "";
  return {
    ...item,
    sourceUrl: ownerHandle
      ? `${baseUrl}/${encodeURIComponent(
          ownerHandle,
        )}/skills/${encodeURIComponent(skill.slug)}`
      : item.sourceUrl,
    content: selectedContent,
    ...(section === "files" || section === "all"
      ? {
          files: versionFiles.map((file) => ({
            ...file,
            content: previewContents.get(file.path),
          })),
        }
      : {}),
    ...(shouldFetchVersions
      ? {
          versions: (versionsPayload?.items ?? []).flatMap((entry) =>
            entry.version
              ? [
                  {
                    version: entry.version,
                    createdAt: entry.createdAt,
                    changelog: entry.changelog,
                    changelogSource: entry.changelogSource,
                  },
                ]
              : [],
          ),
        }
      : {}),
    install: {
      type: "archive",
      url: downloadUrl.toString(),
      verification: createClawHubVerification(versionPayload, security.status),
    },
    changelog: versionPayload?.version?.changelog ?? latestVersion?.changelog,
    license: versionPayload?.version?.license ?? latestVersion?.license,
    securityStatus: security.status,
    securitySummary: security.summary,
  };
}

function normalizeClawHubFiles(
  payload: ClawHubVersionResponse | undefined,
): SkillDetailFile[] {
  return (payload?.version?.files ?? []).flatMap((file) => {
    const path = file.path?.trim();
    if (!path || path === "_meta.json") return [];
    return [
      {
        path,
        size: file.size,
        sha256: file.sha256,
        contentType: file.contentType,
      },
    ];
  });
}

async function loadClawHubPreviewContents(
  downloadUrl: string,
  files: SkillDetailFile[],
): Promise<Map<string, string>> {
  const archive = await requestMarketplaceBinary(downloadUrl, {
    maxBytes: MAX_PREVIEW_ARCHIVE_BYTES,
  });
  if (archive[0] !== 0x50 || archive[1] !== 0x4b) return new Map();

  const previewPaths = new Set(
    files
      .filter(
        (file) =>
          (file.size ?? 0) <= MAX_PREVIEW_FILE_BYTES && isTextPreviewFile(file),
      )
      .map((file) => file.path),
  );
  let selectedBytes = 0;
  const entries = unzipSync(archive, {
    filter: (file) => {
      const matchedPath = [...previewPaths].find(
        (path) => file.name === path || file.name.endsWith(`/${path}`),
      );
      if (!matchedPath) return false;
      if (selectedBytes + file.originalSize > MAX_PREVIEW_TOTAL_BYTES) {
        return false;
      }
      selectedBytes += file.originalSize;
      return true;
    },
  });
  const result = new Map<string, string>();
  for (const [archivePath, content] of Object.entries(entries)) {
    const matchedPath = [...previewPaths].find(
      (path) => archivePath === path || archivePath.endsWith(`/${path}`),
    );
    if (!matchedPath) continue;
    result.set(matchedPath, Buffer.from(content).toString("utf8"));
  }
  return result;
}

function isTextPreviewFile(file: SkillDetailFile): boolean {
  if (file.contentType?.startsWith("text/")) return true;
  return /\.(?:md|mdx|txt|json|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|sh|bash|zsh|fish|ps1|html?|css|scss|xml)$/i.test(
    file.path,
  );
}

async function resolveClawHubOwner(
  baseUrl: string,
  slug: string,
): Promise<{ slug: string; ownerHandle?: string }> {
  const cached = remoteSkillCache.get(cacheKey(baseUrl, slug));
  const searchUrl = new URL(`${baseUrl}/api/v1/search`);
  searchUrl.searchParams.set("q", slug);
  searchUrl.searchParams.set("mode", "exact");
  searchUrl.searchParams.set("limit", String(MAX_PAGE_SIZE));
  searchUrl.searchParams.set("nonSuspiciousOnly", "true");
  const payload = await requestMarketplaceJson<ClawHubSearchResponse>(
    searchUrl.toString(),
  );
  const candidates = (payload.results ?? []).filter(
    (record) => record.slug === slug && clawHubOwnerHandle(record),
  );
  const match =
    candidates.find(
      (record) =>
        record.displayName === cached?.name &&
        record.downloads === cached?.downloads,
    ) ?? candidates[0];
  const ownerHandle = match ? clawHubOwnerHandle(match) : undefined;
  if (!ownerHandle) {
    throw new MarketplaceHttpError("该 Skill 缺少可解析的发布者信息。");
  }
  return { slug, ownerHandle };
}

function parseClawHubReference(reference: string): {
  slug: string;
  ownerHandle?: string;
} {
  const segments = reference.replace(/^@/, "").split("/");
  const [first, second, ...rest] = segments;
  if (!first || rest.length || (second !== undefined && !second)) {
    throw new MarketplaceHttpError("Skill 标识无效。");
  }
  if (!second) return { slug: first };
  return { ownerHandle: first, slug: second };
}

function clawHubOwnerHandle(record: ClawHubSkillRecord): string | undefined {
  return record.ownerHandle ?? record.native?.ownerHandle;
}

function createClawHubVerification(
  payload: ClawHubVersionResponse | undefined,
  securityStatus: SkillMarketplaceDetail["securityStatus"],
): Extract<SkillInstallSource, { type: "archive" }>["verification"] {
  if (securityStatus !== "clean" || !payload?.version?.files?.length) {
    return undefined;
  }
  // ClawHub generates _meta.json at download time, so its bytes do not match
  // the immutable version manifest. It is not needed at runtime and is omitted
  // from both verification and installation.
  const manifestFiles = payload.version.files.filter(
    (file) => file.path?.trim() !== "_meta.json",
  );
  const files = manifestFiles.flatMap((file) => {
    const path = file.path?.trim();
    const sha256 = file.sha256?.trim().toLowerCase();
    if (!path || !/^[a-f0-9]{64}$/.test(sha256 ?? "")) return [];
    return [{ path, sha256: sha256!, size: file.size }];
  });
  if (!files.length || files.length !== manifestFiles.length) return undefined;
  return {
    kind: "sha256-manifest",
    registry: "clawhub.ai",
    status: "clean",
    files,
  };
}

function clawHubRecordToRemote(
  record: ClawHubSkillRecord,
  baseUrl: string,
): RemoteSkillRecord {
  const ownerHandle = clawHubOwnerHandle(record);
  return {
    id:
      record.slug && ownerHandle
        ? `${ownerHandle}/${record.slug}`
        : record.slug,
    name: record.displayName ?? record.slug,
    description: record.summary ?? record.description,
    ownerHandle,
    version: record.version ?? record.latestVersion?.version,
    sourceUrl: record.canonicalUrl
      ? new URL(record.canonicalUrl, baseUrl).toString()
      : record.slug
        ? `${baseUrl}/skills/${encodeURIComponent(record.slug)}`
        : baseUrl,
    tags: record.topics,
    downloads:
      record.downloads ??
      record.stats?.downloads ??
      record.native?.skill?.stats?.downloads,
    stars: record.stats?.stars ?? record.native?.skill?.stats?.stars,
    updatedAt: record.updatedAt ?? record.native?.skill?.updatedAt,
  };
}

function normalizeClawHubModeration(value: unknown): {
  status: "clean" | "warning" | "suspicious" | "unknown";
  summary: string;
} {
  if (!value || typeof value !== "object") {
    return {
      status: "unknown",
      summary: "ClawHub 暂无审核结论，安装前请检查内容。",
    };
  }
  const record = value as Record<string, unknown>;
  const scanners = record.scanners as
    | {
        llm?: { summary?: unknown; guidance?: unknown };
        vt?: { analysis?: unknown };
      }
    | undefined;
  const verdict = String(
    record.verdict ?? record.status ?? record.riskLevel ?? "",
  ).toLowerCase();
  const summary =
    typeof record.summary === "string" && record.summary.trim()
      ? record.summary
      : typeof scanners?.llm?.summary === "string" &&
          scanners.llm.summary.trim()
        ? scanners.llm.summary
        : typeof scanners?.vt?.analysis === "string" &&
            scanners.vt.analysis.trim()
          ? scanners.vt.analysis
          : "已读取 ClawHub 审核信息。";
  if (["clean", "pass", "safe", "low", "none"].includes(verdict)) {
    return { status: "clean", summary };
  }
  if (["suspicious", "fail", "high", "critical", "blocked"].includes(verdict)) {
    return { status: "suspicious", summary };
  }
  return { status: "warning", summary };
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
    downloads: record.downloads,
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
