import { describe, it, expect } from "vitest";
import {
  isAllowedApplicationNavigation,
  isAllowedExternalUrl,
} from "../../client/main/core/security/navigation-policy";

describe("navigation-policy", () => {
  it("rejects every non-http(s) protocol", () => {
    expect(isAllowedExternalUrl("file:///tmp/a.txt")).toBe(false);
    expect(isAllowedExternalUrl("ftp://example.com")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("mailto:x@y.com")).toBe(false);
    expect(isAllowedExternalUrl("marloues://settings")).toBe(false);
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

describe("application navigation policy", () => {
  const packagedEntry =
    "file:///C:/Program%20Files/Marloues/renderer/index.html";

  it("allows only the packaged application document", () => {
    expect(isAllowedApplicationNavigation(packagedEntry, packagedEntry)).toBe(
      true,
    );
    expect(
      isAllowedApplicationNavigation(
        `${packagedEntry}#conversation`,
        packagedEntry,
      ),
    ).toBe(true);
    expect(
      isAllowedApplicationNavigation(
        `${packagedEntry}?view=chat`,
        packagedEntry,
      ),
    ).toBe(true);
  });

  it("rejects other local files and non-file protocols in packaged mode", () => {
    expect(
      isAllowedApplicationNavigation(
        "file:///C:/Program%20Files/Marloues/renderer/other.html",
        packagedEntry,
      ),
    ).toBe(false);
    expect(
      isAllowedApplicationNavigation("https://intranet.corp", packagedEntry),
    ).toBe(false);
    expect(
      isAllowedApplicationNavigation("javascript:alert(1)", packagedEntry),
    ).toBe(false);
  });

  it("allows same-origin application routes in development", () => {
    const devEntry = "http://localhost:5173/app";

    expect(
      isAllowedApplicationNavigation(
        "http://localhost:5173/conversations/123#latest",
        devEntry,
      ),
    ).toBe(true);
  });

  it("rejects cross-origin navigation in development", () => {
    const devEntry = "http://localhost:5173/app";

    expect(
      isAllowedApplicationNavigation("https://localhost:5173/app", devEntry),
    ).toBe(false);
    expect(
      isAllowedApplicationNavigation("http://localhost:5174/app", devEntry),
    ).toBe(false);
    expect(
      isAllowedApplicationNavigation("http://127.0.0.1:5173/app", devEntry),
    ).toBe(false);
    expect(
      isAllowedApplicationNavigation(
        "http://localhost:5173@evil.test/app",
        devEntry,
      ),
    ).toBe(false);
  });

  it("rejects malformed URLs and untrusted application protocols", () => {
    expect(isAllowedApplicationNavigation("not a url", packagedEntry)).toBe(
      false,
    );
    expect(
      isAllowedApplicationNavigation(
        "marloues://settings",
        "marloues://application",
      ),
    ).toBe(false);
  });
});
