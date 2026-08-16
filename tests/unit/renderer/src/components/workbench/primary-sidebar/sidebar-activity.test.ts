import { describe, expect, it } from "vitest";
import {
  resolveCollapsedSidebarToggleActivity,
  resolveSessionCollectionActivity,
  resolveSidebarActivity,
} from "../../../../../../../client/renderer/src/components/workbench/primary-sidebar/sidebar-activity";

describe("sidebar activity aggregation", () => {
  it("prioritizes unread completions over running tasks", () => {
    expect(resolveSidebarActivity(true, true)).toBe("unread");
    expect(
      resolveSessionCollectionActivity(
        ["running-session", "unread-session"],
        new Set(["unread-session"]),
        new Set(["running-session"]),
      ),
    ).toBe("unread");
  });

  it("returns running only when consumers opt into running task markers", () => {
    expect(resolveSidebarActivity(false, true)).toBe("running");
    expect(resolveSidebarActivity(false, false)).toBeNull();
  });

  it("shows only unread completions on the collapsed sidebar toggle", () => {
    expect(resolveCollapsedSidebarToggleActivity(true)).toBe("unread");
    expect(resolveCollapsedSidebarToggleActivity(false)).toBeNull();
  });
});
