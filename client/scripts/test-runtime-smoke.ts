/**
 * 端到端冒烟测试 — 验证 marloues 自己的配置能跑通 DeepSeek API。
 *
 * 关键：临时移走 ~/.claude/settings.json，确保 SDK 只用 marloues 传的 env，
 * 证明不是蹭 Claude Code 的已有配置。
 *
 * 用法： npx tsx scripts/test-runtime-smoke.ts
 */

import { queryClaude } from "../main/core/sdk/claude-sdk";
import { readFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 读取 marloues 自己的 settings.json
const settingsPath = join(homedir(), ".marloues-dev", "config", "settings.json");
const raw = readFileSync(settingsPath, "utf-8");
const settings = JSON.parse(raw);

const provider = settings.agentSettings.providers.find(
  (p: { id: string; enabled: boolean }) => p.id === "deepseek" && p.enabled,
);

if (!provider) {
  console.error("❌ DeepSeek provider not found in marloues settings.json");
  process.exit(1);
}

const model = settings.agentSettings.defaultModel.modelId;

console.log("=== marloues Runtime 冒烟测试（隔离模式）===");
console.log(`Provider:     ${provider.name}`);
console.log(`Base URL:     ${provider.baseUrl}`);
console.log(`API Key:      ${provider.apiKey?.slice(0, 10)}...${provider.apiKey?.slice(-4)}`);
console.log(`Model:        ${model}`);
console.log("");

// 关键：临时移走 ~/.claude/settings.json，确保不蹭已有配置
const claudeSettingsPath = join(homedir(), ".claude", "settings.json");
const claudeSettingsBackup = join(homedir(), ".claude", "settings.json.marloues-backup");
let movedSettings = false;

if (existsSync(claudeSettingsPath)) {
  console.log("⚠️  检测到 ~/.claude/settings.json，临时移走以隔离测试");
  renameSync(claudeSettingsPath, claudeSettingsBackup);
  movedSettings = true;
  console.log("");
}

// 确保测试结束后恢复
function restore() {
  if (movedSettings && existsSync(claudeSettingsBackup)) {
    renameSync(claudeSettingsBackup, claudeSettingsPath);
    console.log("✅ ~/.claude/settings.json 已恢复");
  }
}

async function main() {
  const prompt = "你是什么模型？请只回答模型名称和厂商，不要说其他内容。";

  // 完全用 marloues 的配置，不依赖 process.env 里的 ANTHROPIC_ 变量
  const sdkEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("ANTHROPIC_") && !key.startsWith("CLAUDE_")) {
      sdkEnv[key] = value;
    }
  }

  const options: Record<string, unknown> = {
    cwd: process.cwd(),
    model,
    maxTurns: 1,
    includePartialMessages: true,
    env: {
      ...sdkEnv,
      ANTHROPIC_API_KEY: provider.apiKey,
      ANTHROPIC_AUTH_TOKEN: provider.apiKey,
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_MODEL: model,
      DISABLE_TELEMETRY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  };

  console.log(`📤 发送: "${prompt}"`);
  console.log("");

  let textChunks = 0;
  let thinkingChunks = 0;
  let fullText = "";
  let hasError = false;
  let errorMsg = "";

  try {
    const query = await queryClaude(prompt, options);

    for await (const msg of query) {
      const m = msg as Record<string, unknown>;

      if (m.type === "system") {
        console.log(`  [system] subtype=${m.subtype}`);
      }

      if (m.type === "stream_event") {
        const event = m.event as Record<string, unknown> | undefined;
        if (event?.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta") {
            textChunks++;
            const text = String(delta.text ?? "");
            fullText += text;
            process.stdout.write(text);
          }
          if (delta?.type === "thinking_delta") {
            thinkingChunks++;
          }
        }
      }

      if (m.type === "assistant") {
        const content = (m.message as Record<string, unknown>)?.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<Record<string, unknown>>) {
            if (block.type === "text" && block.text && !fullText) {
              fullText = String(block.text);
              console.log(`  [assistant] ${fullText}`);
            }
          }
        }
      }

      if (m.type === "result") {
        console.log("");
        console.log(`  [result] is_error=${m.is_error} subtype=${m.subtype}`);
        if (m.is_error) {
          hasError = true;
          errorMsg = String(m.result ?? "unknown error");
        }
      }
    }
  } catch (err) {
    hasError = true;
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error("❌ SDK 调用异常:", errorMsg);
  }

  console.log("");
  console.log("=== 测试结果 ===");
  console.log(`Text chunks:     ${textChunks}`);
  console.log(`Thinking chunks: ${thinkingChunks}`);
  console.log(`Full text:       ${fullText.slice(0, 200)}`);
  console.log("");

  if (hasError) {
    console.log("❌ 测试失败:", errorMsg);
    restore();
    process.exit(1);
  } else if (fullText.trim()) {
    console.log("✅ 测试通过 — marloues 自己的配置连通 DeepSeek API");
    restore();
    process.exit(0);
  } else {
    console.log("⚠️ 测试不确定 — 没有收到文本回复，但也没有报错");
    restore();
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  restore();
  process.exit(1);
});
