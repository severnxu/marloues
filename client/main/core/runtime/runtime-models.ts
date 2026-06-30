import type { ModelOption } from "@shared/types";
import { getAgentSettings } from "../../services/config-service";

export function configuredRuntimeModels(): ModelOption[] {
  const settings = getAgentSettings();
  const byId = new Map<string, ModelOption>();

  for (const provider of settings.providers) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      if (!model.enabled || byId.has(model.id)) continue;
      byId.set(model.id, model);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
