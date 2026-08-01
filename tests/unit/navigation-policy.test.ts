import { describe, it, expect } from "vitest";
import { isAllowedExternalUrl } from "../../client/main/core/security/navigation-policy";

describe("navigation-policy", () => {
  it("allows file: URLs", () => {
    expect(isAllowedExternalUrl("file:///tmp/a.txt")).toBe(true);
  });

  it("rejects non-http(s) protocols", () => {
    expect(isAllowedExternalUrl("ftp://example.com")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("mailto:x@y.com")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isAllowedExternalUrl("not a url")).toBe(false);
    expect(isAllowedExternalUrl("")).toBe(false);
  });

  it("allows localhost on both protocols", () => {
    expect(isAllowedExternalUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedExternalUrl("https://localhost")).toBe(true);
  });

  it("allows private IPv4 ranges", () => {
    expect(isAllowedExternalUrl("http://10.0.0.1")).toBe(true);
    expect(isAllowedExternalUrl("http://127.0.0.1")).toBe(true);
    expect(isAllowedExternalUrl("http://169.254.169.254")).toBe(true);
    expect(isAllowedExternalUrl("http://172.16.0.1")).toBe(true);
    expect(isAllowedExternalUrl("http://172.31.255.255")).toBe(true);
    expect(isAllowedExternalUrl("http://192.168.1.1")).toBe(true);
  });

  it("rejects public IPv4 addresses", () => {
    expect(isAllowedExternalUrl("http://8.8.8.8")).toBe(false);
    expect(isAllowedExternalUrl("http://1.1.1.1")).toBe(false);
  });

  it("allows internal hostname suffixes", () => {
    expect(isAllowedExternalUrl("http://corp.internal")).toBe(true);
    expect(isAllowedExternalUrl("http://intranet.corp")).toBe(true);
    expect(isAllowedExternalUrl("http://nas.lan")).toBe(true);
    expect(isAllowedExternalUrl("http://a.b.c.local")).toBe(true);
  });

  it("allows single-label hostnames", () => {
    expect(isAllowedExternalUrl("http://router")).toBe(true);
  });

  it("rejects public hostnames", () => {
    expect(isAllowedExternalUrl("https://api.openai.com")).toBe(false);
    expect(isAllowedExternalUrl("https://www.baidu.com")).toBe(false);
  });

  it("handles IPv6 loopback", () => {
    expect(isAllowedExternalUrl("http://[::1]:8080")).toBe(true);
  });
});
