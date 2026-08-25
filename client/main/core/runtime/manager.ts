/**
 * Runtime Manager — 管理 AgentRuntime 实例的生命周期.
 */

import type { AgentRuntime } from "@shared/agent-runtime";
import type {
  ModelOption,
  RuntimeDescriptor,
  RuntimeKind,
  RuntimeState,
} from "@shared/types";
import {
  getAgentSettings,
  saveAgentSettings,
} from "../../services/config-service";
import { resolveBundledCodexBinary } from "../../codex/transport/connection";
import { BinaryRuntime } from "./binary-runtime";
import { ClaudeRuntime } from "./claude-runtime";
import { SelfBuiltRuntime } from "./self-built-runtime";

type RuntimeFactory = () => AgentRuntime;

function binaryRuntimeDescriptor(): RuntimeDescriptor & {
  create?: RuntimeFactory;
} {
  const bundled = resolveBundledCodexBinary();
  return {
    id: "binary",
    name: "Binary Runtime",
    description: "通过外部 Agent 二进制运行，目标是复用最强的现成 Agent 能力。",
    status: "available",
    statusReason: bundled
      ? undefined
      : "未发现 bundled binary，将尝试使用 PATH 中的 codex 命令。",
    capabilities: {
      forkThread: true,
      interruptTurn: true,
      setModel: false,
      setPermissionMode: true,
      registerTool: false,
      cancelTool: false,
      editMessage: false,
      sandbox: true,
    },
    create: () => new BinaryRuntime(),
  };
}

export async function listRuntimeModels(): Promise<ModelOption[]> {
  const runtime = getRuntime();
  if (runtime.getAvailableModels) return runtime.getAvailableModels();
  return [];
}

export async function setRuntimeModel(
  providerId: string,
  modelId: string,
): Promise<RuntimeState> {
  const runtime = getRuntime();
  if (runtime.setModel) await runtime.setModel(modelId);
  const settings = getAgentSettings();
  saveAgentSettings({ ...settings, defaultModel: { providerId, modelId } });
  return getRuntimeState();
}

const runtimeRegistry: Record<
  RuntimeKind,
  RuntimeDescriptor & { create?: RuntimeFactory }
> = {
  sdk: {
    id: "sdk",
    name: "SDK Runtime",
    description: "通过厂商 Agent SDK 运行，适合合规、企业端点和内网交付。",
    status: "available",
    capabilities: {
      forkThread: true,
      interruptTurn: true,
      setModel: true,
      setPermissionMode: true,
      registerTool: false,
      cancelTool: false,
      editMessage: true,
      sandbox: true,
    },
    create: () => new ClaudeRuntime(),
  },
  binary: binaryRuntimeDescriptor(),
  "self-built": {
    id: "self-built",
    name: "Self-built Runtime",
    description: "自建 agent loop，目标是获得最高可控性和可审计性。",
    status: "available",
    capabilities: {
      forkThread: true,
      interruptTurn: true,
      setModel: true,
      setPermissionMode: true,
      registerTool: true,
      cancelTool: true,
      editMessage: true,
      sandbox: true,
    },
    create: () => new SelfBuiltRuntime(),
  },
};

let runtime: AgentRuntime | null = null;
let activeRuntimeId: RuntimeKind = "sdk";

function runtimeDescriptors(): RuntimeDescriptor[] {
  return Object.values(runtimeRegistry).map(
    ({ create: _create, ...descriptor }) => descriptor,
  );
}

function selectedRuntimeId(): RuntimeKind {
  const settings = getAgentSettings();
  const configured = settings.activeRuntimeId;
  return configured && runtimeRegistry[configured]?.status === "available"
    ? configured
    : "sdk";
}

async function createRuntime(runtimeId: RuntimeKind): Promise<AgentRuntime> {
  const entry = runtimeRegistry[runtimeId];
  if (!entry) throw new Error(`Unknown runtime: ${runtimeId}`);
  if (entry.status !== "available" || !entry.create) {
    throw new Error(entry.statusReason || `${entry.name} is not available`);
  }
  const nextRuntime = entry.create();
  await nextRuntime.initialize();
  return nextRuntime;
}

/** 初始化 runtime（app ready 时调用）*/
export async function initRuntime(): Promise<void> {
  if (runtime) return;
  activeRuntimeId = selectedRuntimeId();
  runtime = await createRuntime(activeRuntimeId);
}

/** 获取当前 runtime 实例 */
export function getRuntime(): AgentRuntime {
  if (!runtime)
    throw new Error("Runtime not initialized. Call initRuntime() first.");
  return runtime;
}

/** 销毁 runtime（app quit 时调用）*/
export async function destroyRuntime(): Promise<void> {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
}

export function getRuntimeState(): RuntimeState {
  return {
    activeRuntimeId,
    activeRuntimeName: runtime?.name ?? runtimeRegistry[activeRuntimeId].name,
    runtimes: runtimeDescriptors(),
  };
}

export async function switchRuntime(
  runtimeId: RuntimeKind,
): Promise<RuntimeState> {
  if (runtimeId === activeRuntimeId && runtime) return getRuntimeState();

  const nextRuntime = await createRuntime(runtimeId);
  const previousRuntime = runtime;
  runtime = nextRuntime;
  activeRuntimeId = runtimeId;

  try {
    if (previousRuntime) await previousRuntime.destroy();
  } catch {
    // Switching succeeded; cleanup failure should not roll back the selected runtime.
  }

  const settings = getAgentSettings();
  saveAgentSettings({ ...settings, activeRuntimeId: runtimeId });
  return getRuntimeState();
}
