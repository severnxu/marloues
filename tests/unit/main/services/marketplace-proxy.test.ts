import { describe, expect, it, vi } from "vitest";

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
    vi.unstubAllGlobals();
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

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      id: "example/mcp",
      name: "Example MCP",
      version: "1.1.0",
      packages: [{ registryType: "npm", identifier: "example-mcp" }],
      remotes: [{ transport: "http", url: "https://example.com/mcp" }],
    });
    vi.unstubAllGlobals();
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
    vi.unstubAllGlobals();
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
    vi.unstubAllGlobals();
  });
});
