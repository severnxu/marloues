import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { probeMcpServer } from "../../client/main/services/mcp-probe";

const repoRoot = join(__dirname, "..", "..");
const clientRequire = createRequire(join(repoRoot, "client", "package.json"));
const fixtureRoot = mkdtempSync(join(tmpdir(), "marloues-runtime-extensions-"));
const workspaceDir = join(fixtureRoot, "workspace");
const selectedSkillDir = join(fixtureRoot, "selected-skill");
const nativeSkillDir = join(
  workspaceDir,
  ".agents",
  "skills",
  "native-disabled",
);

const MCP_SERVER_CODE = `
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id == null) continue;
    let result = {};
    if (message.method === "initialize") {
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "marloues-project-e2e", version: "1.0.0" }
      };
    } else if (message.method === "tools/list") {
      result = {
        tools: [{
          name: "project_echo",
          description: "Project E2E echo",
          inputSchema: { type: "object", properties: { text: { type: "string" } } }
        }]
      };
    } else if (message.method === "tools/call") {
      result = {
        content: [{ type: "text", text: String(message.params?.arguments?.text ?? "probe-ok") }],
        isError: false
      };
    } else if (message.method === "resources/list") {
      result = { resources: [] };
    } else if (message.method === "resources/templates/list") {
      result = { resourceTemplates: [] };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class JsonRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = "";
  private stderr = "";

  constructor(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) {
    this.child = spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.read(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code, signal) => {
      const error = new Error(
        `app-server exited before responding (code=${code}, signal=${signal})\n${this.stderr}`,
      );
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  close(): void {
    this.child.kill("SIGTERM");
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      };
      if (message.id == null) continue;
      const request = this.pending.get(message.id);
      if (!request) continue;
      this.pending.delete(message.id);
      if (message.error)
        request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  }
}

interface ClaudeQuery {
  initializationResult(): Promise<unknown>;
  supportedCommands(): Promise<unknown[]>;
  mcpServerStatus(): Promise<unknown[]>;
  close(): void;
}

async function runMcpProbe(): Promise<void> {
  const result = await probeMcpServer({
    id: "project-e2e-probe",
    name: "project-e2e-probe",
    enabled: true,
    config: {
      type: "stdio",
      command: process.execPath,
      args: ["-e", MCP_SERVER_CODE],
    },
  });
  if (!result.ok) throw new Error(`MCP probe failed: ${result.error}`);
  if (result.probeTool !== "project_echo") {
    throw new Error("MCP probe did not execute project_echo");
  }
  assertIncludes(
    result.probeResult,
    "probe-ok",
    "MCP probe did not receive the tools/call result",
  );
  console.log("[runtime-extensions] MCP initialize/list/call: ok");
}

async function runCodex(): Promise<void> {
  const codexHome = join(fixtureRoot, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  const rpc = new JsonRpcProcess(
    join(repoRoot, "node_modules", ".bin", "codex"),
    ["app-server"],
    {
      cwd: workspaceDir,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_DISABLE_TELEMETRY: "1",
      },
    },
  );
  try {
    await rpc.request("initialize", {
      clientInfo: {
        name: "marloues-e2e",
        title: "Marloues E2E",
        version: "0.3.3",
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify("initialized", {});
    await rpc.request("skills/extraRoots/set", {
      extraRoots: [selectedSkillDir],
    });
    const listed = await rpc.request("skills/list", {
      cwds: [workspaceDir],
      forceReload: true,
    });
    assertIncludes(
      listed,
      "selected-e2e",
      "Codex did not discover the injected Skill",
    );

    const started = (await rpc.request("thread/start", {
      cwd: workspaceDir,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: {
        skills: {
          config: [
            { path: join(selectedSkillDir, "SKILL.md"), enabled: true },
            { path: join(nativeSkillDir, "SKILL.md"), enabled: false },
          ],
        },
        mcp_servers: {
          project_e2e: {
            enabled: true,
            command: process.execPath,
            args: ["-e", MCP_SERVER_CODE],
          },
        },
      },
    })) as { thread: { id: string } };

    let status: unknown = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      status = await rpc.request("mcpServerStatus/list", {
        threadId: started.thread.id,
        detail: "full",
      });
      if (JSON.stringify(status).includes("project_echo")) break;
      await delay(100);
    }
    assertIncludes(
      status,
      "project_echo",
      "Codex did not connect the injected MCP server",
    );
    console.log("[runtime-extensions] Codex Skill + MCP: ok");
  } finally {
    rpc.close();
  }
}

async function runClaude(): Promise<void> {
  const sdkEntry = clientRequire.resolve("@anthropic-ai/claude-agent-sdk");
  const sdk = (await import(pathToFileURL(sdkEntry).href)) as {
    query(input: {
      prompt: string;
      options: Record<string, unknown>;
    }): ClaudeQuery;
  };
  const controller = new AbortController();
  const query = sdk.query({
    prompt: "只回复 ok",
    options: {
      cwd: workspaceDir,
      maxTurns: 1,
      abortController: controller,
      pathToClaudeCodeExecutable: resolveClaudeExecutable(),
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: join(fixtureRoot, "claude-home"),
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      },
      plugins: [
        { type: "local", path: selectedSkillDir, skipMcpDiscovery: true },
      ],
      skills: ["selected-e2e"],
      strictMcpConfig: true,
      mcpServers: {
        project_e2e: {
          type: "stdio",
          alwaysLoad: true,
          command: process.execPath,
          args: ["-e", MCP_SERVER_CODE],
        },
      },
      permissionMode: "default",
    },
  });
  try {
    const initialization = await query.initializationResult();
    const commands = await query.supportedCommands();
    const status = await query.mcpServerStatus();
    assertIncludes(
      { initialization, commands },
      "selected-e2e",
      "Claude did not discover the injected Skill",
    );
    assertIncludes(
      status,
      "project_echo",
      "Claude did not connect the injected MCP server",
    );
    console.log("[runtime-extensions] Claude Skill + MCP: ok");
  } finally {
    controller.abort();
    query.close();
  }
}

function resolveClaudeExecutable(): string {
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32"
        : "linux";
  const packageName = `@anthropic-ai/claude-agent-sdk-${platform}-${process.arch}`;
  const packagePath = clientRequire.resolve(`${packageName}/package.json`);
  return join(
    dirname(packagePath),
    process.platform === "win32" ? "claude.exe" : "claude",
  );
}

function assertIncludes(value: unknown, needle: string, message: string): void {
  if (!JSON.stringify(value).includes(needle)) throw new Error(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  mkdirSync(selectedSkillDir, { recursive: true });
  mkdirSync(nativeSkillDir, { recursive: true });
  writeFileSync(
    join(selectedSkillDir, "SKILL.md"),
    "---\nname: selected-e2e\ndescription: Selected runtime E2E Skill\n---\n",
    "utf8",
  );
  writeFileSync(
    join(nativeSkillDir, "SKILL.md"),
    "---\nname: native-disabled\ndescription: Must be disabled by project policy\n---\n",
    "utf8",
  );

  await withTimeout(runMcpProbe(), 10_000, "MCP tool-call probe timed out");
  await withTimeout(runCodex(), 20_000, "Codex extension smoke test timed out");
  await withTimeout(
    runClaude(),
    20_000,
    "Claude extension smoke test timed out",
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
