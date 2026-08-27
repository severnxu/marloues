import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SessionApprovalTracker } from "../../client/main/core/security/session-approval-tracker";

describe("SessionApprovalTracker", () => {
  let tracker: SessionApprovalTracker;

  beforeEach(() => {
    tracker = new SessionApprovalTracker();
  });

  describe("session approval", () => {
    it("returns false for unmarked session", () => {
      expect(tracker.isSessionApproved("session-1")).toBe(false);
    });

    it("returns true after marking session approved", () => {
      tracker.markSessionApproved("session-1");
      expect(tracker.isSessionApproved("session-1")).toBe(true);
    });

    it("does not affect other sessions", () => {
      tracker.markSessionApproved("session-1");
      expect(tracker.isSessionApproved("session-2")).toBe(false);
    });
  });

  describe("page approval", () => {
    it("returns false for unmarked page", () => {
      expect(tracker.isPageApproved("page-1")).toBe(false);
    });

    it("returns true after marking page approved", () => {
      tracker.markPageApproved("page-1");
      expect(tracker.isPageApproved("page-1")).toBe(true);
    });
  });

  describe("clear", () => {
    it("clears all sessions and pages", () => {
      tracker.markSessionApproved("session-1");
      tracker.markPageApproved("page-1");
      tracker.clear();
      expect(tracker.isSessionApproved("session-1")).toBe(false);
      expect(tracker.isPageApproved("page-1")).toBe(false);
    });
  });

  describe("TTL expiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("session approval expires after 30 minutes", () => {
      tracker.markSessionApproved("session-1");
      expect(tracker.isSessionApproved("session-1")).toBe(true);

      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      expect(tracker.isSessionApproved("session-1")).toBe(false);
    });

    it("page approval expires after 30 minutes", () => {
      tracker.markPageApproved("page-1");
      expect(tracker.isPageApproved("page-1")).toBe(true);

      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      expect(tracker.isPageApproved("page-1")).toBe(false);
    });

    it("session approval survives before 30 minutes", () => {
      tracker.markSessionApproved("session-1");
      vi.advanceTimersByTime(29 * 60 * 1000);
      expect(tracker.isSessionApproved("session-1")).toBe(true);
    });
  });

  describe("cross-turn survival", () => {
    // Simulates: turn 1 exec → mark session; turn 2 write → still approved
    it("session approved in turn 1 remains approved in turn 2", () => {
      // Turn 1
      tracker.markSessionApproved("session-1");

      // Turn 2 (no clear between turns)
      expect(tracker.isSessionApproved("session-1")).toBe(true);
    });

    it("page approved in turn 1 remains approved in turn 2", () => {
      tracker.markPageApproved("page-1");
      expect(tracker.isPageApproved("page-1")).toBe(true);
    });

    it("clear() simulates thread deletion — approvals gone", () => {
      tracker.markSessionApproved("session-1");
      tracker.markPageApproved("page-1");
      tracker.clear();
      expect(tracker.isSessionApproved("session-1")).toBe(false);
      expect(tracker.isPageApproved("page-1")).toBe(false);
    });
  });
});
