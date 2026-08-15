import { useEffect } from "react";
import { ArrowRight, Check, FolderOpen, Settings } from "lucide-react";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";

/**
 * Full-screen onboarding view shown when the user has not yet selected a
 * workspace. Workspace selection is mandatory (the agent runtime needs a cwd);
 * model endpoint configuration is skippable — users can configure it later
 * in Settings.
 */
export function OnboardingView() {
  const completed = useOnboardingStore((state) => state.completed);
  const configuredModel = useOnboardingStore((state) => state.configuredModel);
  const selectedWorkspace = useOnboardingStore(
    (state) => state.selectedWorkspace,
  );
  const markStep = useOnboardingStore((state) => state.markStep);
  const complete = useOnboardingStore((state) => state.complete);

  const listModels = useSettingsStore((state) => state.listModels);
  const models = useSettingsStore((state) => state.models);

  const workspace = useWorkspaceStore((state) => state.current);
  const selectWorkspace = useWorkspaceStore((state) => state.select);

  const openSettingsSection = useSettingsDialogStore(
    (state) => state.openSection,
  );

  useEffect(() => {
    void listModels();
  }, [listModels]);

  // Reflect runtime workspace state into the onboarding store so the "开始使用"
  // button enables/disables automatically.
  useEffect(() => {
    markStep("selectedWorkspace", Boolean(workspace?.path));
  }, [workspace?.path, markStep]);

  if (completed && workspace) return null;

  const handleSelectWorkspace = async () => {
    try {
      await selectWorkspace();
    } catch {
      // 用户取消选择
    }
  };

  const handleOpenSettings = () => {
    openSettingsSection("providers");
  };

  const handleSkipModel = () => {
    markStep("configuredModel", true);
  };

  const handleFinish = () => {
    if (!selectedWorkspace) return;
    complete();
  };

  const canStart = selectedWorkspace;

  return (
    <div
      className="onboarding-view"
      role="dialog"
      aria-modal="true"
      aria-label="marloues 初次设置"
    >
      <div className="onboarding-view-card scrollbar-thin">
        <header className="onboarding-head">
          <span className="onboarding-brand" aria-hidden="true">
            marloues
          </span>
          <h1>初次设置</h1>
          <p>两步即可开始：选好工作区，Agent 就有家了。</p>
        </header>

        {/* Step 1: Workspace — mandatory, no skip */}
        <section
          className={`onboarding-step ${selectedWorkspace ? "done" : ""}`}
          aria-labelledby="onboarding-step-workspace"
        >
          <div className="onboarding-step-head">
            <span className="onboarding-step-index" aria-hidden="true">
              {selectedWorkspace ? <Check size={14} /> : 1}
            </span>
            <h2 id="onboarding-step-workspace">
              <FolderOpen size={14} aria-hidden="true" />
              选择工作区
            </h2>
          </div>
          {workspace?.path ? (
            <p className="onboarding-workspace-path" title={workspace.path}>
              {workspace.path}
            </p>
          ) : (
            <p className="onboarding-models-hint">
              Agent 会在该目录下读写文件、运行命令。
            </p>
          )}
          <div className="onboarding-step-actions">
            <button
              type="button"
              className="onboarding-action"
              onClick={() => void handleSelectWorkspace()}
            >
              {selectedWorkspace ? "更换文件夹" : "打开文件夹"}
              <kbd className="onboarding-kbd" aria-hidden="true">
                ⌘O
              </kbd>
            </button>
          </div>
        </section>

        {/* Step 2: Model endpoint — skippable */}
        <section
          className={`onboarding-step ${configuredModel ? "done" : ""}`}
          aria-labelledby="onboarding-step-model"
        >
          <div className="onboarding-step-head">
            <span className="onboarding-step-index" aria-hidden="true">
              {configuredModel ? <Check size={14} /> : 2}
            </span>
            <h2 id="onboarding-step-model">配置模型端点</h2>
          </div>
          {models.length > 0 ? (
            <p className="onboarding-models-hint">
              当前可用模型：{models.map((model) => model.id).join("、")}
            </p>
          ) : (
            <p className="onboarding-models-hint">
              尚未配置模型端点，可在「设置 → 模型端点」中完成。
            </p>
          )}
          <div className="onboarding-step-actions">
            <button
              type="button"
              className="onboarding-skip"
              onClick={handleSkipModel}
            >
              稍后配置
            </button>
            <button
              type="button"
              className="onboarding-action"
              onClick={handleOpenSettings}
            >
              <Settings size={14} aria-hidden="true" />
              前往设置
            </button>
          </div>
        </section>

        <footer className="onboarding-footer">
          <small>{selectedWorkspace ? "工作区已就绪" : "请先选择工作区"}</small>
          <button
            type="button"
            className="onboarding-start"
            onClick={handleFinish}
            disabled={!canStart}
          >
            开始使用
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </footer>
      </div>
    </div>
  );
}
