import { useState } from "react";
import { Download, Globe, Network, Plus, ShieldOff, Trash2 } from "lucide-react";
import { SettingsCard, ToggleSwitch } from "@/components/settings/shared";
import type { EnterprisePolicy, NetworkPolicy } from "@shared/types";
import { notify } from "@/lib/notifications";

interface SecuritySettingsProps {
  enterprisePolicy: EnterprisePolicy;
  onPolicyChange: (policy: EnterprisePolicy) => void;
  onExportAuditLog: () => void;
}

/* PRD 4.2.C — 内网版安全 Tab：网络策略白名单 + 脱敏规则 + 审计导出 */
export function SecuritySettings({ enterprisePolicy, onPolicyChange, onExportAuditLog }: SecuritySettingsProps) {
  const networkPolicy: NetworkPolicy = enterprisePolicy.networkPolicy ?? {
    enabled: false,
    allowedDomains: [],
    blockPublicNetwork: false,
  };
  const redactionRules = enterprisePolicy.redactionRules ?? [];
  const auditEnabled = enterprisePolicy.auditEnabled ?? false;
  const [domainDraft, setDomainDraft] = useState("");

  const updatePolicy = (patch: Partial<EnterprisePolicy>) => {
    onPolicyChange({ ...enterprisePolicy, ...patch });
  };

  const updateNetwork = (patch: Partial<NetworkPolicy>) => {
    updatePolicy({ networkPolicy: { ...networkPolicy, ...patch } });
  };

  const addDomain = () => {
    const domain = domainDraft.trim().toLowerCase();
    if (!domain || networkPolicy.allowedDomains.includes(domain)) return;
    updateNetwork({ allowedDomains: [...networkPolicy.allowedDomains, domain] });
    setDomainDraft("");
  };

  const removeDomain = (domain: string) => {
    updateNetwork({ allowedDomains: networkPolicy.allowedDomains.filter((item) => item !== domain) });
  };

  return (
    <div className="security-settings">
      <SettingsCard
        title="网络策略"
        description="限制 Agent 可访问的域名白名单，阻断未授权的外部网络请求。"
        icon={<Globe size={16} />}
        action={
          <ToggleSwitch
            checked={networkPolicy.enabled}
            onChange={() => updateNetwork({ enabled: !networkPolicy.enabled })}
          />
        }
      >
        <div className="settings-row-inline">
          <span className="settings-row-icon"><Network size={16} /></span>
          <span className="settings-row-copy">
            <strong>阻断公网访问</strong>
            <small>启用后，仅允许白名单内的域名发起请求。</small>
          </span>
          <span className="settings-row-trailing">
            <ToggleSwitch
              checked={networkPolicy.blockPublicNetwork}
              onChange={() => updateNetwork({ blockPublicNetwork: !networkPolicy.blockPublicNetwork })}
            />
          </span>
        </div>
        {networkPolicy.enabled ? (
          <div className="security-domain-block">
            <label className="security-block-label">允许的域名</label>
            <p className="security-block-desc">Agent 可访问的外部域名列表（不含协议）。</p>
            <div className="security-domain-list">
              {networkPolicy.allowedDomains.length === 0 ? (
                <p className="task-empty">尚未添加任何域名，所有外部请求将被阻断。</p>
              ) : (
                networkPolicy.allowedDomains.map((domain) => (
                  <div key={domain} className="security-domain-chip">
                    <span>{domain}</span>
                    <button type="button" onClick={() => removeDomain(domain)} aria-label={`移除 ${domain}`}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
              <div className="security-domain-add">
                <input
                  type="text"
                  placeholder="example.com"
                  value={domainDraft}
                  onChange={(event) => setDomainDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addDomain();
                    }
                  }}
                />
                <button type="button" onClick={addDomain}>
                  <Plus size={14} />
                  添加
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="敏感信息脱敏"
        description="按正则规则对 Agent 输出和工具结果进行脱敏处理。规则由企业策略文件统一配置。"
        icon={<ShieldOff size={16} />}
      >
        {redactionRules.length === 0 ? (
          <p className="task-empty">
            尚未配置脱敏规则。脱敏规则由企业策略文件 <code>marloues.enterprise.json</code> 的
            <code>policy.redactionRules</code> 统一配置，本地不可修改。
          </p>
        ) : (
          <div className="security-rule-list">
            {redactionRules.map((rule) => (
              <div key={rule.id} className="security-rule-row">
                <ToggleSwitch checked={rule.enabled} onChange={() => undefined} disabled />
                <div className="security-rule-info">
                  <strong>{rule.name}</strong>
                  <code>{rule.pattern}</code>
                  <small>替换为 {rule.replacement}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="审计日志"
        description="记录所有工具调用与文件操作，可导出供合规审查。"
        icon={<Download size={16} />}
        action={
          <ToggleSwitch checked={auditEnabled} onChange={() => updatePolicy({ auditEnabled: !auditEnabled })} />
        }
      >
        <div className="settings-row-inline">
          <span className="settings-row-icon"><Download size={16} /></span>
          <span className="settings-row-copy">
            <strong>导出审计日志</strong>
            <small>下载最近 500 条审计记录为 JSON 文件。</small>
          </span>
          <span className="settings-row-trailing">
            <button
              type="button"
              className="settings-action-button"
              onClick={() => {
                onExportAuditLog();
                notify({ title: "审计日志已导出", tone: "success" });
              }}
            >
              <Download size={14} />
              导出
            </button>
          </span>
        </div>
      </SettingsCard>
    </div>
  );
}
