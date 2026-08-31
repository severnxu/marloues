import { describe, expect, it } from "vitest";
import {
  EMBEDDED_COMMENT_BRIDGE_SCRIPT,
  normalizeCommentBridgeMessage,
} from "../../client/main/services/embedded-comment-bridge";

describe("embedded comment bridge", () => {
  it("normalizes an Escape exit request", () => {
    expect(
      normalizeCommentBridgeMessage({
        type: "exit-requested",
        messageId: "escape-1",
      }),
    ).toEqual({ type: "exit-requested", messageId: "escape-1" });
  });

  it("supports removing one stable comment without renumbering the rest", () => {
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain(
      'message.type === "remove-comment"',
    );
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain(
      'sendToMain({ type: "exit-requested" })',
    );
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).not.toContain("renumberMarkers");
  });

  it("keeps popup outlines and saved markers attached to moving targets", () => {
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain(
      'window.addEventListener("scroll", schedulePositionUpdate, true)',
    );
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain(
      "targetElement.getBoundingClientRect()",
    );
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain(
      "positionCommentMarker(comments[i])",
    );
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain("new MutationObserver");
  });

  it("preserves transparent send-icon edges in the light theme", () => {
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).toContain(
      "border-left-color:transparent;border-right-color:transparent;border-bottom-color:#fff",
    );
    expect(EMBEDDED_COMMENT_BRIDGE_SCRIPT).not.toContain(
      ".ec-popup-send:after,.ec-theme-light .ec-style-confirm:after{border-color:#fff}",
    );
  });
});
