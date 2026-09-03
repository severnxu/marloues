type MarketplaceKind = "skill" | "mcp";

const REQUIRED_MARKETPLACE_METHODS = [
  "marketplaceList",
  "marketplaceDetail",
  "marketplaceInstall",
  "testMarketplaceEndpoint",
] as const;

export function getMarketplaceBridgeIssue(
  kind: MarketplaceKind,
): string | null {
  const bridge = window.marloues as unknown as Record<
    MarketplaceKind,
    Record<string, unknown> | undefined
  >;
  const api = bridge[kind];
  const complete = REQUIRED_MARKETPLACE_METHODS.every(
    (method) => typeof api?.[method] === "function",
  );
  if (complete) return null;

  const label = kind === "skill" ? "Skill" : "MCP";
  return `${label} 市场后端尚未加载。请完全退出并重新启动 Marloues 后再试。`;
}
