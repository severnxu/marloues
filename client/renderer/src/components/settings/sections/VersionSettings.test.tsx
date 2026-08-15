import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionSettingsView } from "./VersionSettings";

describe("VersionSettingsView", () => {
  it("renders the client and UI versions in the settings section", () => {
    const html = renderToStaticMarkup(
      <VersionSettingsView
        versionInfo={{
          clientVersion: "0.2.0",
          uiVersion: "0.2.13",
          buildEnv: "dev",
          protocolVersion: "2.0",
          capabilities: [],
          packaged: false,
          clientUpdateConfigured: false,
          hotUpdateConfigured: false,
          trustedKeyIds: [],
        }}
      />,
    );

    expect(html).toContain("版本信息");
    expect(html).toContain("客户端");
    expect(html).toContain("v0.2.0");
    expect(html).toContain("UI");
    expect(html).toContain("v0.2.13");
    expect(html).not.toContain("Business");
    expect(html).not.toContain("Runtime");
  });

  it("does not mix language runtime versions into app version info", () => {
    const html = renderToStaticMarkup(
      <VersionSettingsView
        versionInfo={{
          clientVersion: "0.2.0",
          uiVersion: "0.2.13",
          buildEnv: "dev",
          protocolVersion: "2.0",
          capabilities: [],
          packaged: false,
          clientUpdateConfigured: false,
          hotUpdateConfigured: false,
          trustedKeyIds: [],
        }}
      />,
    );

    expect(html).not.toContain("运行时");
  });
});
