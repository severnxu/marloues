import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantTurnHeader } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/AssistantTurnHeader";

describe("AssistantTurnHeader", () => {
  it("renders a real disclosure control when activity can expand", () => {
    const html = renderToStaticMarkup(
      <AssistantTurnHeader
        activity="done"
        duration="42s"
        expanded={false}
        hasActivityItems
        label="耗时"
        tone="is-muted"
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("workflow-turn-header-chevron");
    expect(html).toContain("耗时");
    expect(html).toContain("42s");
    expect(html).toContain("workflow-turn-header-rule");
  });

  it("uses static markup when the header has no action", () => {
    const html = renderToStaticMarkup(
      <AssistantTurnHeader
        activity="done"
        duration="1s"
        expanded={false}
        hasActivityItems={false}
        label="耗时"
        tone="is-muted"
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("workflow-turn-header-button is-static");
    expect(html).toContain("<button");
    expect(html).not.toContain("aria-expanded");
  });
});
