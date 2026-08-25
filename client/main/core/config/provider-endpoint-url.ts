export function buildProviderEndpointUrl(
  baseUrl: string,
  canonicalPath: string,
): string {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  const versionedBase = /(?:^|\/)v\d+[a-z0-9._-]*$/i.test(basePath);
  const resourcePath =
    versionedBase && canonicalPath.startsWith("/v1/")
      ? canonicalPath.slice(3)
      : canonicalPath;
  parsed.pathname = `${basePath}${resourcePath}`;
  parsed.hash = "";
  return parsed.toString();
}
