import assert from "node:assert/strict";
import {
  getRemoteMcpServerDetail,
  listRemoteMcpServers,
} from "../../client/main/services/mcp-marketplace/mcp-marketplace-service";
import {
  getRemoteSkillDetail,
  listRemoteSkills,
} from "../../client/main/services/skill-marketplace/skill-marketplace-service";

async function main(): Promise<void> {
  const skillsMpEndpoint = {
    baseUrl: "https://skillsmp.com",
    enabled: true,
  };
  const skillsMp = await listRemoteSkills(
    { query: "playwright", pageNo: 1, pageSize: 2 },
    skillsMpEndpoint,
  );
  assert.ok(skillsMp.items.length > 0, "SkillsMP should return skills");
  assert.ok(
    skillsMp.items[0].sourceUrl.startsWith("https://github.com/"),
    "SkillsMP result should expose a GitHub source",
  );

  const clawHubEndpoint = {
    baseUrl: "https://clawhub.ai",
    enabled: true,
  };
  const clawHub = await listRemoteSkills(
    { query: "playwright", pageSize: 2 },
    clawHubEndpoint,
  );
  assert.ok(clawHub.items.length > 0, "ClawHub should return skills");
  const clawHubDetail = await getRemoteSkillDetail(
    clawHub.items[0].slug,
    clawHubEndpoint,
  );
  assert.ok(clawHubDetail.content.trim(), "ClawHub should return SKILL.md");
  assert.equal(clawHubDetail.install?.type, "archive");

  const officialEndpoint = {
    baseUrl: "https://registry.modelcontextprotocol.io",
    enabled: true,
  };
  const official = await listRemoteMcpServers(
    { query: "filesystem", pageSize: 2 },
    officialEndpoint,
  );
  assert.ok(official.items.length > 0, "official MCP Registry should respond");
  const officialDetail = await getRemoteMcpServerDetail(
    official.items[0].id,
    officialEndpoint,
  );
  assert.ok(
    (officialDetail.packages?.length ?? 0) +
      (officialDetail.remotes?.length ?? 0) >
      0,
    "official MCP detail should expose an install source",
  );

  const smitheryEndpoint = {
    baseUrl: "https://registry.smithery.ai",
    enabled: true,
  };
  const smithery = await listRemoteMcpServers(
    { query: "filesystem", pageSize: 2 },
    smitheryEndpoint,
  );
  assert.ok(smithery.items.length > 0, "Smithery should return servers");
  const smitheryDetail = await getRemoteMcpServerDetail(
    smithery.items[0].id,
    smitheryEndpoint,
  );
  assert.ok(
    smitheryDetail.remotes?.some((remote) => remote.url.startsWith("https://")),
    "Smithery detail should expose a remote MCP URL",
  );

  console.log(
    JSON.stringify(
      {
        skills: {
          skillsMp: skillsMp.items.map((item) => item.name),
          clawHub: clawHub.items.map((item) => item.name),
          clawHubVersion: clawHubDetail.version,
        },
        mcp: {
          official: official.items.map((item) => item.name),
          officialInstallSources:
            (officialDetail.packages?.length ?? 0) +
            (officialDetail.remotes?.length ?? 0),
          smithery: smithery.items.map((item) => item.name),
          smitheryRemote: smitheryDetail.remotes?.[0]?.url,
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
