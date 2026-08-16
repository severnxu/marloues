import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageErrorCard } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/MessageErrorCard";

describe("MessageErrorCard", () => {
  it("renders classified guidance and a real copy button", () => {
    const html = renderToStaticMarkup(
      <MessageErrorCard message="401 unauthorized API key" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("网关鉴权失败");
    expect(html).toContain("workflow-detail-copy-button");
    expect(html).toContain("<button");
  });
});
