import { describe, it, expect, beforeEach } from "vitest";
import {
  setRedactionRules,
  redactSensitiveText,
  redactSensitiveValue,
} from "../../client/main/core/security/redaction";
import type { RedactionRule } from "@shared/types";

const phoneRule: RedactionRule = {
  id: "phone",
  pattern: "\\d{3}-\\d{4}-\\d{4}",
  replacement: "[phone]",
  enabled: true,
};

describe("redaction", () => {
  beforeEach(() => {
    setRedactionRules(undefined);
  });

  it("redacts Bearer tokens", () => {
    expect(redactSensitiveText("Bearer abc123.def456")).toBe("Bearer [redacted]");
  });

  it("redacts api_key=value pairs", () => {
    expect(redactSensitiveText("api_key=sk-12345")).toBe("api_key=[redacted]");
  });

  it("redacts JSON-style key: value pairs", () => {
    expect(redactSensitiveText('"password": "hunter2"')).toBe('"password": "[redacted]"');
  });

  it("redacts enc: payloads", () => {
    expect(redactSensitiveText("enc:safe:v1:ABCDEF==")).toBe("enc:safe:v1:[redacted]");
  });

  it("does not treat benign id fields as sensitive", () => {
    const value = redactSensitiveValue({ sessionId: "abc", turnId: "t1", apiKey: "sk-1" });
    expect(value).toEqual({ sessionId: "abc", turnId: "t1", apiKey: "[redacted]" });
  });

  it("recurses into nested objects and arrays", () => {
    const value = redactSensitiveValue({ outer: { token: "x" }, list: ["a", "Bearer b"] });
    expect(value).toEqual({ outer: { token: "[redacted]" }, list: ["a", "Bearer [redacted]"] });
  });

  it("applies enabled enterprise rules", () => {
    setRedactionRules([phoneRule]);
    expect(redactSensitiveText("联系 138-1234-5678 电话")).toBe("联系 [phone] 电话");
  });

  it("skips disabled rules", () => {
    setRedactionRules([{ ...phoneRule, enabled: false }]);
    expect(redactSensitiveText("138-1234-5678")).toBe("138-1234-5678");
  });

  it("ignores malformed patterns without throwing", () => {
    setRedactionRules([{ id: "bad", pattern: "([unclosed", replacement: "x", enabled: true }]);
    expect(() => redactSensitiveText("hello")).not.toThrow();
    expect(redactSensitiveText("hello")).toBe("hello");
  });

  it("is idempotent on unchanged input", () => {
    setRedactionRules([phoneRule]);
    setRedactionRules([phoneRule]);
    expect(redactSensitiveText("138-1234-5678")).toBe("[phone]");
  });

  it("clearing rules stops enterprise redaction", () => {
    setRedactionRules([phoneRule]);
    setRedactionRules(undefined);
    expect(redactSensitiveText("138-1234-5678")).toBe("138-1234-5678");
  });
});
