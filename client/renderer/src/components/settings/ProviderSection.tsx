import { useState } from "react";
import { Plus, ServerCog } from "lucide-react";
import type { AgentSettings } from "@shared/types";
import { EmptySettingsState, SettingsCard, SettingsStat } from "./shared";
import { ProviderRow } from "./ProviderRow";
import { AddEndpointDialog } from "./AddEndpointDialog";
import type { ProviderManagement } from "./use-provider-management";

export function ProviderSection({
  draft,
  canEdit,
  pm,
}: {
  draft: AgentSettings;
  canEdit: boolean;
  pm: ProviderManagement;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  return (
    <>
      <div className="settings-stat-grid">
        <SettingsStat label="端点配置" value={String(draft.providers.length)} />
        <SettingsStat
          label="启用模型"
          value={`${draft.providers.reduce(
            (count, provider) =>
              count + provider.models.filter((model) => model.enabled).length,
            0,
          )}/${draft.providers.reduce(
            (count, provider) => count + provider.models.length,
            0,
          )}`}
        />
        <SettingsStat
          label="可用模型"
          value={String(
            draft.providers.reduce(
              (count, provider) =>
                count + provider.models.filter((model) => model.enabled).length,
              0,
            ),
          )}
        />
      </div>
      <SettingsCard
        title="模型池"
        description="模型负责连接配置，并进入默认模型池参与下一次 SDK 会话。"
        icon={<ServerCog size={16} />}
        surface="plain"
        action={
          <button
            disabled={!canEdit}
            onClick={() => setAddDialogOpen(true)}
            title={
              canEdit ? "新增端点配置" : "企业策略禁止新增或修改本地端点配置"
            }
          >
            <Plus size={14} />
            添加模型
          </button>
        }
      >
        <div className="provider-list">
          {draft.providers.length === 0 ? (
            <EmptySettingsState
              title="还没有配置任何模型"
              body="先添加一个模型，再选择默认模型进入下一次 SDK 会话。"
            />
          ) : null}
          {draft.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              pm={pm}
              canEdit={canEdit}
              defaultModel={draft.defaultModel}
            />
          ))}
        </div>
      </SettingsCard>
      {addDialogOpen ? (
        <AddEndpointDialog
          index={draft.providers.length + 1}
          onConfirm={(provider, defaultModelId) => {
            setAddDialogOpen(false);
            void pm.commitNewProvider(provider, defaultModelId);
          }}
          onCancel={() => setAddDialogOpen(false)}
          onStatus={pm.setStatus}
        />
      ) : null}
    </>
  );
}
