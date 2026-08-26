import { getAgentSettings } from "../../client/main/services/config-service";
import { resolveRuntimeProviderRoutes } from "../../client/main/core/config/provider-routing";

const s = getAgentSettings();
const p = s.providers.find((p) => p.id === s.defaultModel?.providerId);
console.log("providerId:", p?.id);
console.log("providerName:", p?.name);
console.log("apiKey present:", !!p?.apiKey);
console.log("apiKey prefix:", p?.apiKey?.slice(0, 20));
console.log("apiKeyEnv:", p?.apiKeyEnv);
console.log("modelId:", s.defaultModel?.modelId);
console.log("activeRuntimeId:", s.activeRuntimeId);

const plan = resolveRuntimeProviderRoutes(s, { runtimeId: "sdk" });
console.log("\nRoute plan for SDK runtime:");
console.log("sourceProtocol:", plan.sourceProtocol);
console.log("routes count:", plan.routes.length);
console.log(
  "directRoute:",
  plan.directRoute
    ? `${plan.directRoute.baseUrl} (${plan.directRoute.protocol})`
    : "none",
);
console.log("requiresGateway:", plan.requiresGateway);
for (const r of plan.routes) {
  console.log(
    `  route: ${r.endpointId} proto=${r.protocol} baseUrl=${r.baseUrl} model=${r.model}`,
  );
}
