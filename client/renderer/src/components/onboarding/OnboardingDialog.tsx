import { useEffect, useState } from "react";
import { ArrowRight, Bot, Check, Cpu, FolderOpen, Rocket } from "lucide-react";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { notify } from "@/lib/notifications";
import type { RuntimeKind } from "@shared/types";

const RUNTIME_OPTIONS: Array<{ id: RuntimeKind; title: string; description: string }> = [
  { id: "sdk", title: "SDK Runtime", description: "厂商 SDK，合规友好、企业交付" },
  { id: "binary", title: "Binary Runtime", description: "外部 Agent 二进制，能力最强" },
  { id: "self-built", title: "自建 Runtime", description: "完全可控的 agent loop" },
];

/* PRD 5.10 — 单页滚动式引导，每一步可跳过，完成后不再弹出。 */
export function OnboardingDialog({ onComplete, onOpenSettings }: { onComplete: () => void; onOpenSettings: () => void }) {
  const completed = useOnboardingStore((state) => state.completed);
  const selectedRuntime = useOnboardingStore((state) => state.selectedRuntime);
  const configuredModel = useOnboardingStore((state) => state.configuredModel);
  const selectedWorkspace = useOnboardingStore((state) => state.selectedWorkspace);
  const markStep = useOnboardingStore((state) => state.markStep);
  const complete = useOnboardingStore((state) => state.complete);

  const runtimeState = useSettingsStore((state) => state.runtimeState);
  const switchRuntime = useSettingsStore((state) => state.switchRuntime);
  const listModels = useSettingsStore((state) => state.listModels);
  const models = useSettingsStore((state) => state.models);

  const workspace = useWorkspaceStore((state) => state.current);
  const selectWorkspace = useWorkspaceStore((state) => state.select);

  const [activeRuntime, setActiveRuntime] = useState<RuntimeKind>(runtimeState?.activeRuntimeId ?? "sdk");

  useEffect(() => {
    void listModels();
  }, [listModels]);

  useEffect(() => {
    if (workspace?.path) markStep("selectedWorkspace", true);
  }, [workspace?.path, markStep]);

  useEffect(() => {
    if (runtimeState?.activeRuntimeId) {
      setActiveRuntime(runtimeState.activeRuntimeId);
      markStep("selectedRuntime", true);
    }
  }, [runtimeState?.activeRuntimeId, markStep]);

  if (completed) return null;

  const handleSelectRuntime = async (id: RuntimeKind) => {
    setActiveRuntime(id);
    try {
      await switchRuntime(id);
      markStep("selectedRuntime", true);
      notify({ title: "Runtime 已切换", description: `${id} 内核已激活`, tone: "success" });
    } catch {
      // 切换失败不阻塞引导
    }
  };

  const handleSelectWorkspace = async () => {
    try {
      await selectWorkspace();
    } catch {
      // 用户取消选择
    }
  };

  const handleOpenSettings = () => {
    markStep("configuredModel", true);
    onOpenSettings();
    handleFinish();
  };

  const handleFinish = () => {
    complete();
    onComplete();
  };

  const stepsDone = [selectedRuntime, configuredModel, selectedWorkspace].filter(Boolean).length;

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="初次使用引导">
      <div className="onboarding-dialog scrollbar-thin">
        <header className="onboarding-head">
          <Rocket size={28} />
          <h1>欢迎使用 marloues</h1>
          <p>一个工作台，任意 Agent。完成下方三步即可开始，也可随时跳过。</p>
        </header>

        <section className={`onboarding-step ${selectedRuntime ? "done" : ""}`}>
          <div className="onboarding-step-head">
            <span className="onboarding-step-index">1</span>
            <h2>
              <Cpu size={16} />
              选择 Agent 内核
            </h2>
            {selectedRuntime ? <Check size={16} className="onboarding-check" /> : null}
          </div>
          <div className="onboarding-runtime-grid">
            {RUNTIME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`onboarding-runtime-card ${activeRuntime === option.id ? "active" : ""}`}
                onClick={() => void handleSelectRuntime(option.id)}
              >
                <Bot size={18} />
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          <button type="button" className="onboarding-skip" onClick={() => markStep("selectedRuntime", true)}>
            跳过这步
          </button>
        </section>

        <section className={`onboarding-step ${configuredModel ? "done" : ""}`}>
          <div className="onboarding-step-head">
            <span className="onboarding-step-index">2</span>
            <h2>
              <ArrowRight size={16} />
              配置模型连接
            </h2>
            {configuredModel ? <Check size={16} className="onboarding-check" /> : null}
          </div>
          {models.length > 0 ? (
            <p className="onboarding-models-hint">当前可用模型：{models.map((model) => model.id).join("、")}</p>
          ) : (
            <p className="onboarding-models-hint">尚未配置模型端点，稍后可在设置中完成。</p>
          )}
          <div className="onboarding-step-actions">
            <button type="button" className="onboarding-skip" onClick={() => markStep("configuredModel", true)}>
              跳过这步
            </button>
            <button type="button" className="onboarding-action" onClick={handleOpenSettings}>
              前往设置
            </button>
          </div>
        </section>

        <section className={`onboarding-step ${selectedWorkspace ? "done" : ""}`}>
          <div className="onboarding-step-head">
            <span className="onboarding-step-index">3</span>
            <h2>
              <FolderOpen size={16} />
              选择工作区
            </h2>
            {selectedWorkspace ? <Check size={16} className="onboarding-check" /> : null}
          </div>
          {workspace?.path ? (
            <p className="onboarding-workspace-path">{workspace.path}</p>
          ) : (
            <p className="onboarding-models-hint">尚未选择工作区目录。</p>
          )}
          <div className="onboarding-step-actions">
            <button type="button" className="onboarding-skip" onClick={() => markStep("selectedWorkspace", true)}>
              跳过这步
            </button>
            <button type="button" className="onboarding-action" onClick={() => void handleSelectWorkspace()}>
              打开文件夹
            </button>
          </div>
        </section>

        <footer className="onboarding-footer">
          <small>已完成 {stepsDone} / 3 步</small>
          <button type="button" className="onboarding-start" onClick={handleFinish}>
            开始使用
          </button>
        </footer>
      </div>
    </div>
  );
}
