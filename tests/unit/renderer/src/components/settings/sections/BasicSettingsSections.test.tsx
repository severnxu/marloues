import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersonalizationSettings } from "../../../../../../../client/renderer/src/components/settings/sections/BasicSettingsSections";

describe("PersonalizationSettings", () => {
  it("renders the custom instruction textarea as a full-width standalone control", () => {
    const html = renderToStaticMarkup(
      <PersonalizationSettings
        customInstructions="请保持简洁。"
        onCustomInstructionsChange={() => {}}
      />,
    );

    expect(html).toContain("settings-large-textarea");
    expect(html).toContain('aria-label="自定义指令"');
    expect(html).not.toContain("settings-field--textarea");
    expect(html).not.toContain("settings-field--bare");
  });
});
