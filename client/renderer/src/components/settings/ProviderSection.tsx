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
      <div className="provider-settings">
        <div className="settings-stat-grid">
          <SettingsStat label="供应商" value={String(draft.providers.length)} />
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
                  count +
                  provider.models.filter((model) => model.enabled).length,
                0,
              ),
            )}
          />
        </div>
        <SettingsCard
          title="模型池"
          description="供应商进入统一模型池，运行时会自动选择兼容的协议端点。"
          icon={<ServerCog size={16} />}
          surface="plain"
          action={
            <button
              disabled={!canEdit}
              onClick={() => setAddDialogOpen(true)}
              title={
                canEdit ? "添加模型供应商" : "企业策略禁止新增或修改本地供应商"
              }
            >
              <Plus size={14} />
              添加供应商
            </button>
          }
        >
          <div className="provider-list">
            {draft.providers.length === 0 ? (
              <EmptySettingsState
                title="还没有配置任何供应商"
                body="先添加供应商和模型，运行时会自动选择兼容的协议端点。"
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
      </div>
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
