import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "../../client/shared/agent-runtime";

process.env.MARLOUES_HOME = mkdtempSync(
  join(tmpdir(), "marloues-runtime-contract-"),
);
let cleanupEventLog: (() => void) | undefined;
let cleanupModelServer: (() => Promise<void>) | undefined;
let cleanupRemoteMcpServer: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
  const { getAgentSettings, saveAgentSettings } =
    await import("../../client/main/services/config-service");
  const { setClaudeQueryOverrideForTests } =
    await import("../../client/main/core/sdk/claude-sdk");
  const { listEndpointModels, testEndpointModel, testEndpointProfile } =
    await import("../../client/main/services/endpoint-models");
  const { probeMcpServer } =
    await import("../../client/main/services/mcp-probe");
  const {
    destroyRuntime,
    getRuntime,
    getRuntimeState,
    initRuntime,
    switchRuntime,
  } = await import("../../client/main/core/runtime/manager");
  const { eventLog } = await import("../../client/main/codex/event-log");
  cleanupEventLog = () => eventLog.destroy();

  mkdirSync(process.env.MARLOUES_HOME!, { recursive: true });
  const modelServer = await startModelServer();
  cleanupModelServer = modelServer.close;
  const remoteMcpServer = await startRemoteMcpServer();
  cleanupRemoteMcpServer = remoteMcpServer.close;
  const mcpServerPath = join(process.env.MARLOUES_HOME!, "contract-mcp.cjs");
  writeFileSync(
    mcpServerPath,
    [
      "const readline = require('node:readline');",
      "const rl = readline.createInterface({ input: process.stdin });",
      "const respond = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\\n`);",
      "rl.on('line', (line) => {",
      "  const msg = JSON.parse(line);",
      "  if (msg.method === 'initialize') respond(msg.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'contract-mcp', version: '1.0.0' }, capabilities: { tools: {} } });",
      "  if (msg.method === 'tools/list') respond(msg.id, { tools: [{ name: 'contract.echo', description: 'Contract echo', inputSchema: { type: 'object' } }] });",
      "  if (msg.method === 'tools/call' && msg.params && msg.params.name === 'contract.echo') respond(msg.id, { content: [{ type: 'text', text: 'echo ok' }] });",
      "});",
    ].join("\n"),
    "utf-8",
  );
  const settings = getAgentSettings();
  saveAgentSettings({
    ...settings,
    activeRuntimeId: "self-built",
    providers: [
      {
        id: "contract-provider",
        name: "Contract Provider",
        type: "openai-compatible",
        enabled: true,
        baseUrl: modelServer.baseUrl,
        models: [
          { id: "contract-model", label: "Contract Model", enabled: true },
          { id: "disabled-model", label: "Disabled Model", enabled: false },
        ],
      },
    ],
    defaultModel: {
      providerId: "contract-provider",
      modelId: "contract-model",
    },
    mcpServers: [
      {
        id: "contract-mcp",
        name: "Contract MCP",
        enabled: true,
        config: { command: "node", args: [mcpServerPath] },
        lastStatus: "ok",
        tools: ["contract.echo"],
      },
    ],
  });

  await initRuntime();
  assert(
    getRuntimeState().activeRuntimeId === "self-built",
    "initRuntime should honor activeRuntimeId",
  );
  assert(
    getRuntimeState().runtimes.every(
      (runtime) => runtime.status === "available",
    ),
    "all PRD v1 runtime descriptors should be available",
  );

  const runtime = getRuntime();
  const runtimeModels = await runtime.getAvailableModels?.();
  assert(
    runtimeModels?.some((model) => model.id === "local-loop"),
    "self-built runtime should expose its local model",
  );

  const listedModels = await listEndpointModels({
    id: "probe-provider",
    name: "Probe Provider",
    type: "openai-compatible",
    enabled: true,
    baseUrl: modelServer.baseUrl,
    apiKey: "contract-key",
    models: [],
  });
  assert(
    listedModels.ok,
    "endpoint model discovery should call /v1/models successfully",
  );
  assert(
    listedModels.models.some((model) => model.id === "contract-model-a"),
    "endpoint model discovery should parse OpenAI-compatible model IDs",
  );
  const profileTest = await testEndpointProfile({
    id: "probe-provider",
    name: "Probe Provider",
    type: "openai-compatible",
    enabled: true,
    baseUrl: modelServer.baseUrl,
    apiKey: "contract-key",
    models: [],
  });
  assert(
    profileTest.ok,
    "endpoint profile test should succeed when /v1/models is reachable",
  );
  const modelTest = await testEndpointModel(
    {
      id: "probe-provider",
      name: "Probe Provider",
      type: "openai-compatible",
      enabled: true,
      baseUrl: modelServer.baseUrl,
      apiKey: "contract-key",
      models: [],
    },
    "contract-model-b",
  );
  assert(modelTest.ok, "endpoint model test should verify an advertised model");

  const thread = await runtime.createThread("contract");
  const loopWorkspace = join(process.env.MARLOUES_HOME!, "loop-workspace");
  mkdirSync(loopWorkspace, { recursive: true });
  writeFileSync(join(loopWorkspace, "notes.md"), "contract notes\n", "utf-8");
  const events = await collect(
    await runtime.sendMessage({
      threadId: thread.id,
      turnId: "turn-contract",
      content: "hello contract",
      cwd: process.cwd(),
    }),
  );
  assert(
    events.some((event) => event.kind === "turn-start"),
    "sendMessage should emit turn-start",
  );
  assert(
    events.some((event) => event.kind === "text-chunk"),
    "sendMessage should stream text chunks",
  );
  assert(
    events.some(
      (event) =>
        event.kind === "token-usage" &&
        (event.payload.usage.totalTokens ?? 0) > 0,
    ),
    "self-built runtime should emit token usage for completed turns",
  );
  assert(
    events.some(
      (event) =>
        event.kind === "turn-complete" && event.payload.result === "success",
    ),
    "sendMessage should complete successfully",
  );
  const readEvents = await collect(
    await runtime.sendMessage({
      threadId: thread.id,
      turnId: "turn-self-built-read",
      content: "/read notes.md",
      cwd: loopWorkspace,
    }),
  );
  assert(
    readEvents.some(
      (event) =>
        event.kind === "tool-start" &&
        event.payload.toolName === "self-built.fs.read",
    ),
    "self-built loop should execute read through a tool event",
  );
  assert(
    textFromEvents(readEvents).includes("contract notes"),
    "self-built read should stream file content",
  );
  const patchEvents = await collectWithApprovalResponse(
    await runtime.sendMessage({
      threadId: thread.id,
      turnId: "turn-self-built-patch",
      content: "/patch generated.md\ncreated by self-built loop\n",
      cwd: loopWorkspace,
    }),
    (event) => {
      if (event.kind === "approval-request")
        runtime.respondApproval(event.payload.requestId, true, "once");
    },
  );
  assert(
    patchEvents.some(
      (event) =>
        event.kind === "approval-request" &&
        event.payload.toolName === "self-built.fs.patch",
    ),
    "self-built patch should request approval",
  );
  assert(
    patchEvents.some(
      (event) =>
        event.kind === "tool-complete" && event.payload.isError === false,
    ),
    "approved self-built patch should complete tool execution",
  );
  const generatedContent = await import("node:fs").then((fs) =>
    fs.readFileSync(join(loopWorkspace, "generated.md"), "utf-8"),
  );
  assert(
    generatedContent.includes("created by self-built loop"),
    "self-built patch should write inside workspace",
  );
  const undoEvents = await collect(
    await runtime.sendMessage({
      threadId: thread.id,
      turnId: "turn-self-built-undo",
      content: "/undo",
      cwd: loopWorkspace,
    }),
  );
  assert(
    undoEvents.some(
      (event) =>
        event.kind === "tool-complete" &&
        String(event.payload.output).includes("removing newly created file"),
    ),
    "self-built undo should remove newly created patch files",
  );
  const traversalEvents = await collect(
    await runtime.sendMessage({
      threadId: thread.id,
      turnId: "turn-self-built-sandbox",
      content: "/read ../outside.md",
      cwd: loopWorkspace,
    }),
  );
  assert(
    traversalEvents.some(
      (event) =>
        event.kind === "turn-complete" && event.payload.result === "error",
    ),
    "self-built filesystem tools should enforce workspace sandbox",
  );

  const tools = await runtime.listTools();
  assert(
    tools.some((tool) => tool.name === "contract.echo"),
    "runtime tools should include configured MCP tools",
  );
  const mcpProbe = await probeMcpServer({
    id: "contract-mcp",
    name: "Contract MCP",
    enabled: true,
    config: { command: "node", args: [mcpServerPath] },
  });
  assert(
    mcpProbe.ok,
    "stdio MCP probe should initialize server and list tools",
  );
  assert(
    mcpProbe.tools.includes("contract.echo"),
    "stdio MCP probe should discover tools/list result",
  );
  const httpMcpProbe = await probeMcpServer({
    id: "contract-http-mcp",
    name: "Contract HTTP MCP",
    enabled: true,
    config: {
      type: "http",
      url: `${remoteMcpServer.baseUrl}/mcp`,
      headers: { Authorization: "Bearer mcp-key" },
    },
  });
  assert(
    httpMcpProbe.ok,
    "HTTP MCP probe should call initialize and tools/list",
  );
  assert(
    httpMcpProbe.tools.includes("remote.echo"),
    "HTTP MCP probe should discover remote tools/list result",
  );
  const sseMcpProbe = await probeMcpServer({
    id: "contract-sse-mcp",
    name: "Contract SSE MCP",
    enabled: true,
    config: {
      type: "sse",
      url: `${remoteMcpServer.baseUrl}/sse`,
      headers: { Authorization: "Bearer mcp-key" },
    },
  });
  assert(
    sseMcpProbe.ok,
    "SSE MCP probe should discover message endpoint and call tools/list",
  );
  assert(
    sseMcpProbe.tools.includes("remote.echo"),
    "SSE MCP probe should discover remote tools/list result",
  );

  const approvalStream = await runtime.sendMessage({
    threadId: thread.id,
    turnId: "turn-approval-allow",
    content: "/approval please run the sensitive tool",
    cwd: process.cwd(),
  });
  const approvalEvents = await collectWithApprovalResponse(
    approvalStream,
    (event) => {
      if (event.kind === "approval-request")
        runtime.respondApproval(event.payload.requestId, true, "once");
    },
  );
  assert(
    approvalEvents.some((event) => event.kind === "approval-request"),
    "approval flow should request user permission before sensitive tool execution",
  );
  assert(
    approvalEvents.some(
      (event) =>
        event.kind === "tool-start" &&
        event.payload.toolName === "self-built.sensitive-write",
    ),
    "approved flow should start the sensitive tool",
  );
  assert(
    approvalEvents.some(
      (event) =>
        event.kind === "tool-complete" && event.payload.isError === false,
    ),
    "approved flow should complete the sensitive tool",
  );

  const cancelToolStream = await runtime.sendMessage({
    threadId: thread.id,
    turnId: "turn-tool-cancel",
    content: "/approval run then cancel the sensitive tool",
    cwd: process.cwd(),
  });
  const cancelToolEvents = await collectWithApprovalResponse(
    cancelToolStream,
    (event) => {
      if (event.kind === "approval-request")
        runtime.respondApproval(event.payload.requestId, true, "once");
      if (event.kind === "tool-start")
        void runtime.cancelTool?.(event.payload.toolId);
    },
  );
  assert(
    cancelToolEvents.some(
      (event) => event.kind === "tool-complete" && event.payload.isError,
    ),
    "cancelTool should complete the running tool as an error",
  );
  assert(
    cancelToolEvents.some(
      (event) =>
        event.kind === "turn-complete" && event.payload.result === "aborted",
    ),
    "cancelTool should abort the active turn after cancelling the running tool",
  );

  const deniedStream = await runtime.sendMessage({
    threadId: thread.id,
    turnId: "turn-approval-deny",
    content: "/approval deny the sensitive tool",
    cwd: process.cwd(),
  });
  const deniedEvents = await collectWithApprovalResponse(
    deniedStream,
    (event) => {
      if (event.kind === "approval-request")
        runtime.respondApproval(event.payload.requestId, false, "once");
    },
  );
  assert(
    deniedEvents.some(
      (event) =>
        event.kind === "turn-complete" && event.payload.result === "error",
    ),
    "denied approval should complete the turn as an error",
  );

  const interrupted = await runtime.sendMessage({
    threadId: thread.id,
    turnId: "turn-interrupt",
    content: "interrupt me",
    cwd: process.cwd(),
  });
  await runtime.interruptTurn?.("turn-interrupt");
  const interruptedEvents = await collect(interrupted);
  assert(
    interruptedEvents.some(
      (event) =>
        event.kind === "turn-complete" && event.payload.result === "aborted",
    ),
    "interruptTurn should abort the active turn",
  );

  const editableThread = await runtime.createThread("editable");
  await collect(
    await runtime.sendMessage({
      threadId: editableThread.id,
      turnId: "turn-edit-original",
      messageId: "editable-user-message",
      content: "original editable prompt",
      cwd: process.cwd(),
    }),
  );
  const truncated = await runtime.truncateThread?.(editableThread.id, {
    fromMessageId: "editable-user-message",
    includeMessage: false,
  });
  assert(
    truncated?.messages.length === 0,
    "truncateThread should remove the selected user message and following turns",
  );
  await collect(
    await runtime.sendMessage({
      threadId: editableThread.id,
      turnId: "turn-edit-next",
      messageId: "editable-user-message",
      content: "edited prompt",
      cwd: process.cwd(),
    }),
  );
  const editedThread = (await runtime.listThreads()).find(
    (item) => item.id === editableThread.id,
  );
  assert(
    editedThread?.messages.some(
      (message) =>
        message.id === "editable-user-message" &&
        message.content === "edited prompt",
    ),
    "sendMessage should preserve caller-provided messageId for edited prompts",
  );

  const state = await switchRuntime("sdk");
  assert(
    state.activeRuntimeId === "sdk",
    "switchRuntime should switch to SDK runtime",
  );
  const sdkModels = await getRuntime().getAvailableModels?.();
  assert(
    sdkModels?.some((model) => model.id === "contract-model"),
    "SDK runtime should expose enabled configured provider models",
  );
  setClaudeQueryOverrideForTests((_prompt, options) => {
    const canUseTool = options.canUseTool as
      | ((
          toolName: string,
          input: Record<string, unknown>,
          context: Record<string, unknown>,
        ) => Promise<{ behavior: string }>)
      | undefined;
    async function* stream(): AsyncIterable<unknown> {
      const permission = await canUseTool?.(
        "Bash",
        { command: "echo sdk approval" },
        {
          toolUseID: "sdk-tool-1",
          title: "SDK wants to run a shell command",
          displayName: "Run command",
          description: "echo sdk approval",
        },
      );
      yield {
        type: "assistant",
        message: {
          content:
            permission?.behavior === "allow"
              ? [{ type: "text", text: "sdk approval allowed" }]
              : [{ type: "text", text: "sdk approval denied" }],
        },
      };
      yield { type: "result", subtype: "success" };
    }
    return stream();
  });
  const sdkRuntime = getRuntime();
  const sdkThread = await sdkRuntime.createThread("sdk-approval");
  const sdkApprovalEvents = await collectWithApprovalResponse(
    await sdkRuntime.sendMessage({
      threadId: sdkThread.id,
      turnId: "turn-sdk-approval",
      content: "trigger sdk approval",
      cwd: process.cwd(),
    }),
    (event) => {
      if (event.kind === "approval-request")
        sdkRuntime.respondApproval(event.payload.requestId, true, "once");
    },
  );
  assert(
    sdkApprovalEvents.some(
      (event) =>
        event.kind === "approval-request" && event.payload.toolName === "Bash",
    ),
    "SDK runtime should emit approval-request from canUseTool",
  );
  assert(
    sdkApprovalEvents.some(
      (event) =>
        event.kind === "text-chunk" &&
        event.payload.content.includes("sdk approval allowed"),
    ),
    "approved SDK canUseTool should allow the tool path to continue",
  );
  setClaudeQueryOverrideForTests(null);
  await destroyRuntime();
  await cleanupModelServer?.();
  cleanupModelServer = undefined;
  await cleanupRemoteMcpServer?.();
  cleanupRemoteMcpServer = undefined;
}

async function startModelServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    if (
      req.url === "/v1/models" &&
      req.headers.authorization === "Bearer contract-key"
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "contract-model-a", object: "model" },
            {
              id: "contract-model-b",
              object: "model",
              display_name: "Contract Model B",
            },
          ],
        }),
      );
      return;
    }
    // testEndpointModel sends a diagnostic POST /v1/messages ping
    if (
      req.url === "/v1/messages" &&
      req.method === "POST" &&
      req.headers.authorization === "Bearer contract-key"
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg-contract",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "pong" }],
          model: "contract-model-b",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
      return;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "unauthorized" } }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(
    address && typeof address === "object",
    "model test server should listen on a TCP port",
  );
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function startRemoteMcpServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const { createServer } = await import("node:http");
  const server = createServer(async (req, res) => {
    if (req.url === "/sse" && req.headers.authorization === "Bearer mcp-key") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: endpoint\ndata: /mcp\n\n`);
      return;
    }
    if (
      req.url === "/mcp" &&
      req.method === "POST" &&
      req.headers.authorization === "Bearer mcp-key"
    ) {
      const body = await readRequestBody(req);
      const message = JSON.parse(body) as { id: number; method: string };
      if (message.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2024-11-05",
              serverInfo: { name: "remote-mcp", version: "1.0.0" },
              capabilities: { tools: {} },
            },
          }),
        );
        return;
      }
      if (message.method === "tools/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [
                {
                  name: "remote.echo",
                  description: "Remote echo",
                  inputSchema: { type: "object" },
                },
              ],
            },
          }),
        );
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(
    address && typeof address === "object",
    "remote MCP test server should listen on a TCP port",
  );
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function readRequestBody(
  req: import("node:http").IncomingMessage,
): Promise<string> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body;
}

async function collect(
  stream: AsyncIterable<RuntimeEvent>,
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function collectWithApprovalResponse(
  stream: AsyncIterable<RuntimeEvent>,
  onEvent: (event: RuntimeEvent) => void,
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    onEvent(event);
  }
  return events;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function textFromEvents(events: RuntimeEvent[]): string {
  return events
    .filter(
      (event): event is Extract<RuntimeEvent, { kind: "text-chunk" }> =>
        event.kind === "text-chunk",
    )
    .map((event) => event.payload.content)
    .join("");
}

main()
  .then(() => {
    console.info("runtime contract ok");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.MARLOUES_HOME) {
      rmSync(process.env.MARLOUES_HOME, { recursive: true, force: true });
    }
    await cleanupModelServer?.();
    await cleanupRemoteMcpServer?.();
    cleanupEventLog?.();
  });
