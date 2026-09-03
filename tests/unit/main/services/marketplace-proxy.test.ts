import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../client/main/services/config-service", () => ({
  getAgentSettings: vi.fn(() => ({
    skillMarketplaceEndpoint: undefined,
    mcpMarketplaceEndpoint: undefined,
  })),
}));

function jsonResponse(payload: unknown) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-length": String(body.byteLength),
      "content-type": "application/json",
    }),
    arrayBuffer: async () => body.buffer,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("marketplace proxy adapters", () => {
  it("maps the standard Skill marketplace contract without treating it as MCP", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          items: [
            {
              id: "demo-skill",
              name: "Demo Skill",
              description: "A standard skill",
              ownerName: "marloues",
              version: "1.2.0",
              tags: ["demo"],
              updatedAt: "2026-09-03T00:00:00Z",
              install: {
                type: "files",
                files: [
                  { path: "SKILL.md", url: "https://example.com/SKILL.md" },
                ],
              },
            },
          ],
          pagination: { total: 1, hasMore: false },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listRemoteSkills } =
      await import("../../../../client/main/services/skill-marketplace/skill-marketplace-service");
    const response = await listRemoteSkills(
      { query: "demo", pageNo: 1, pageSize: 20 },
      { baseUrl: "https://skill.example.com", enabled: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://skill.example.com/api/v1/skills/search?q=demo&page=1&pageSize=20",
      expect.any(Object),
    );
    expect(response.items[0]).toMatchObject({
      slug: "demo-skill",
      name: "Demo Skill",
      ownerHandle: "marloues",
      version: "1.2.0",
      tags: ["demo"],
      installed: false,
    });
    expect(response.hasMore).toBe(false);
  });

  it("maps ClawHub search and detail responses to an installable archive", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/v1/search")) {
        return jsonResponse({
          results: [
            {
              slug: "demo-claw-skill",
              displayName: "Demo Claw Skill",
              summary: "A ClawHub skill",
              ownerHandle: "marloues",
              canonicalUrl: "/marloues/skills/demo-claw-skill",
              downloads: 42,
              updatedAt: 1_788_000_000_000,
              native: { skill: { stats: { stars: 7 } } },
            },
          ],
        });
      }
      if (url.includes("/versions?")) {
        return jsonResponse({
          items: [
            {
              version: "1.2.3",
              createdAt: 1_788_000_000_000,
              changelog: "Initial release",
              changelogSource: "user",
            },
            {
              version: "1.2.2",
              createdAt: 1_787_000_000_000,
              changelog: "Previous release",
              changelogSource: "user",
            },
          ],
          nextCursor: null,
        });
      }
      if (url.includes("/versions/1.2.3")) {
        return jsonResponse({
          version: {
            version: "1.2.3",
            createdAt: 1_788_000_000_000,
            changelog: "Initial release",
            license: "MIT",
            files: [
              {
                path: "SKILL.md",
                size: 49,
                sha256:
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                contentType: "text/markdown",
              },
              {
                path: "_meta.json",
                size: 120,
                sha256:
                  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              },
            ],
            security: { status: "clean", summary: "No risks detected" },
          },
        });
      }
      if (url.includes("/versions/1.2.2")) {
        return jsonResponse({
          version: {
            version: "1.2.2",
            createdAt: 1_787_000_000_000,
            changelog: "Previous release",
            files: [],
            security: { status: "clean", summary: "No risks detected" },
          },
        });
      }
      return jsonResponse({
        skill: {
          slug: "demo-claw-skill",
          displayName: "Demo Claw Skill",
          summary: "A ClawHub skill",
          description: "---\nname: demo-claw-skill\n---\nUse this skill.",
          topics: ["demo"],
        },
        latestVersion: {
          version: "1.2.3",
          changelog: "Initial release",
          license: "MIT",
        },
        owner: { handle: "marloues" },
        moderation: { status: "pass", summary: "No risks detected" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getRemoteSkillDetail, listRemoteSkills } =
      await import("../../../../client/main/services/skill-marketplace/skill-marketplace-service");
    const endpoint = { baseUrl: "https://clawhub.ai", enabled: true };
    const response = await listRemoteSkills(
      { query: "demo", pageSize: 20 },
      endpoint,
    );
    const baseDetail = await getRemoteSkillDetail(
      "marloues/demo-claw-skill",
      endpoint,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(baseDetail.content).toContain("Use this skill");
    expect(baseDetail.files).toBeUndefined();
    expect(baseDetail.versions).toBeUndefined();

    const detail = await getRemoteSkillDetail(
      "marloues/demo-claw-skill",
      endpoint,
      undefined,
      "all",
    );
    const historicalDetail = await getRemoteSkillDetail(
      "marloues/demo-claw-skill",
      endpoint,
      "1.2.2",
      "all",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://clawhub.ai/api/v1/search?q=demo&limit=20",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(response.items[0]).toMatchObject({
      slug: "marloues/demo-claw-skill",
      name: "Demo Claw Skill",
      ownerHandle: "marloues",
      downloads: 42,
      stars: 7,
    });
    expect(detail).toMatchObject({
      version: "1.2.3",
      content: expect.stringContaining("Use this skill"),
      files: [
        expect.objectContaining({
          path: "SKILL.md",
          size: 49,
          contentType: "text/markdown",
        }),
      ],
      versions: [
        expect.objectContaining({
          version: "1.2.3",
          changelog: "Initial release",
        }),
        expect.objectContaining({
          version: "1.2.2",
          changelog: "Previous release",
        }),
      ],
      securityStatus: "clean",
      install: {
        type: "archive",
        url: "https://clawhub.ai/api/v1/download?slug=demo-claw-skill&ownerHandle=marloues&version=1.2.3",
        verification: {
          kind: "sha256-manifest",
          registry: "clawhub.ai",
          status: "clean",
          files: [
            {
              path: "SKILL.md",
              sha256:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          ],
        },
      },
    });
    expect(historicalDetail).toMatchObject({
      version: "1.2.2",
      changelog: "Previous release",
      install: {
        type: "archive",
        url: "https://clawhub.ai/api/v1/download?slug=demo-claw-skill&ownerHandle=marloues&version=1.2.2",
      },
    });
  });

  it("maps official MCP Registry records to the MCP-only marketplace model", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        servers: [
          {
            server: {
              name: "example/mcp",
              title: "Example MCP",
              description: "An MCP server",
              version: "1.0.0",
              websiteUrl: "https://example.com",
              packages: [
                {
                  registryType: "npm",
                  identifier: "example-mcp",
                  version: "1.0.0",
                },
              ],
              remotes: [
                {
                  type: "streamable-http",
                  url: "https://example.com/mcp",
                },
              ],
            },
            _meta: {
              "io.modelcontextprotocol.registry/official": {
                isLatest: false,
              },
            },
          },
          {
            server: {
              name: "example/mcp",
              title: "Example MCP",
              description: "An MCP server",
              version: "1.1.0",
              websiteUrl: "https://example.com",
              packages: [
                {
                  registryType: "npm",
                  identifier: "example-mcp",
                  version: "1.1.0",
                  runtimeHint: "npx",
                  runtimeArguments: [{ value: "-y" }],
                  environmentVariables: [
                    {
                      name: "EXAMPLE_TOKEN",
                      description: "API token",
                      isRequired: true,
                      isSecret: true,
                    },
                  ],
                },
              ],
              remotes: [
                {
                  type: "streamable-http",
                  url: "https://example.com/mcp",
                },
              ],
            },
            _meta: {
              "io.modelcontextprotocol.registry/official": {
                isLatest: true,
              },
            },
          },
        ],
        metadata: { count: 2 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listRemoteMcpServers } =
      await import("../../../../client/main/services/mcp-marketplace/mcp-marketplace-service");
    const response = await listRemoteMcpServers(
      { query: "example", page: 1, pageSize: 20 },
      { baseUrl: "https://registry.modelcontextprotocol.io", enabled: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0.1/servers?search=example&version=latest&limit=20",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      id: "example/mcp",
      name: "Example MCP",
      version: "1.1.0",
      packages: [
        {
          registryType: "npm",
          identifier: "example-mcp",
          command: "npx",
          args: ["-y"],
          requiredEnvironment: [
            { name: "EXAMPLE_TOKEN", description: "API token", secret: true },
          ],
        },
      ],
      remotes: [{ transport: "http", url: "https://example.com/mcp" }],
    });
  });

  it("keeps the standard MCP marketplace contract separate from Skill fields", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          items: [
            {
              id: "demo-mcp",
              name: "Demo MCP",
              description: "A standard MCP server",
              author: "marloues",
              version: "2.0.0",
              remotes: [{ transport: "sse", url: "https://example.com/sse" }],
            },
          ],
          pagination: { total: 1, hasMore: false },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listRemoteMcpServers } =
      await import("../../../../client/main/services/mcp-marketplace/mcp-marketplace-service");
    const response = await listRemoteMcpServers(
      { query: "demo", page: 1, pageSize: 20 },
      { baseUrl: "https://mcp.example.com", enabled: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://mcp.example.com/api/v1/servers/search?q=demo&page=1&pageSize=20",
      expect.any(Object),
    );
    expect(response.items[0]).toMatchObject({
      id: "demo-mcp",
      name: "Demo MCP",
      author: "marloues",
      remotes: [{ transport: "sse", url: "https://example.com/sse" }],
    });
  });

  it("maps Smithery display names and deployment connections without requiring package fields", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        servers: [
          {
            qualifiedName: "brave",
            displayName: "Brave Search",
            description: "Search the web",
            verified: true,
            useCount: 100,
            homepage: "https://brave.com",
          },
        ],
        pagination: {
          currentPage: 1,
          pageSize: 20,
          totalPages: 2,
          totalCount: 40,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listRemoteMcpServers } =
      await import("../../../../client/main/services/mcp-marketplace/mcp-marketplace-service");
    const response = await listRemoteMcpServers(
      { page: 1, pageSize: 20 },
      { baseUrl: "https://registry.smithery.ai", enabled: true },
    );

    expect(response.items[0]).toMatchObject({
      id: "brave",
      name: "Brave Search",
      verified: true,
      installed: false,
    });
    expect(response.hasMore).toBe(true);
    expect(response.nextCursor).toBe("2");
  });

  it("stops reading a streaming marketplace response after the byte limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const { requestMarketplaceJson } =
      await import("../../../../client/main/services/marketplace-http-client");

    await expect(
      requestMarketplaceJson("https://market.example.com/catalog"),
    ).rejects.toThrow("市场端点响应数据过大");
  });
});
