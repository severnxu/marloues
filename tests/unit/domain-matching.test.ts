import { describe, expect, it } from "vitest";
import {
  matchesDomainList,
  EMPTY_SECURITY_RULES,
} from "../../client/main/core/security/security-host";

describe("matchesDomainList", () => {
  describe("empty list semantics", () => {
    it("returns false for empty list (non-whitelist mode = allow)", () => {
      expect(matchesDomainList("example.com", [])).toBe(false);
    });

    it("returns false for empty list with any host", () => {
      expect(matchesDomainList("evil.com", [])).toBe(false);
    });
  });

  describe("exact domain matching", () => {
    it("matches exact domain", () => {
      expect(matchesDomainList("example.com", ["example.com"])).toBe(true);
    });

    it("does not match different domain", () => {
      expect(matchesDomainList("evil.com", ["example.com"])).toBe(false);
    });

    it("matches one of multiple configured domains", () => {
      expect(
        matchesDomainList("docs.example.com", ["other.com", "example.com"]),
      ).toBe(true);
    });
  });

  describe("subdomain matching", () => {
    it("matches subdomain of configured domain", () => {
      expect(matchesDomainList("sub.example.com", ["example.com"])).toBe(true);
    });

    it("matches deeply nested subdomain", () => {
      expect(matchesDomainList("a.b.c.example.com", ["example.com"])).toBe(
        true,
      );
    });

    it("does not match parent domain", () => {
      // "example.com" does NOT end with ".example" → no match
      expect(matchesDomainList("example.com", ["example"])).toBe(false);
      // but sub.example.com DOES end with ".example.com" → match
      expect(matchesDomainList("sub.example.com", ["example.com"])).toBe(true);
    });
  });

  describe("wildcard matching", () => {
    it("matches wildcard *.example.com", () => {
      expect(matchesDomainList("sub.example.com", ["*.example.com"])).toBe(
        true,
      );
    });

    it("wildcard *.example.com also matches root domain (stripped to example.com)", () => {
      // The implementation strips *. prefix, making *.example.com equivalent to example.com
      expect(matchesDomainList("example.com", ["*.example.com"])).toBe(true);
    });
  });

  describe("case insensitivity", () => {
    it("matches regardless of case in host", () => {
      expect(matchesDomainList("EXAMPLE.COM", ["example.com"])).toBe(true);
    });

    it("matches regardless of case in configured", () => {
      expect(matchesDomainList("example.com", ["EXAMPLE.COM"])).toBe(true);
    });
  });

  describe("trailing dot normalization", () => {
    it("strips trailing dot from host", () => {
      expect(matchesDomainList("example.com.", ["example.com"])).toBe(true);
    });

    it("strips trailing dot from configured", () => {
      expect(matchesDomainList("example.com", ["example.com."])).toBe(true);
    });
  });

  describe("whitespace handling", () => {
    it("trims whitespace from configured entries", () => {
      expect(matchesDomainList("example.com", ["  example.com  "])).toBe(true);
    });
  });
});

describe("EMPTY_SECURITY_RULES", () => {
  it("has empty deniedDomains", () => {
    expect(EMPTY_SECURITY_RULES.deniedDomains).toEqual([]);
  });

  it("has empty allowedDomains (non-whitelist mode)", () => {
    expect(EMPTY_SECURITY_RULES.allowedDomains).toEqual([]);
  });

  it("has networkAccess not set to deny", () => {
    expect(EMPTY_SECURITY_RULES.networkAccess).not.toBe("deny");
  });
});

describe("browser navigation policy semantics", () => {
  // Simulates the framenavigated interception logic in browser-service.ts
  function shouldBlock(
    host: string,
    rules: {
      deniedDomains: string[];
      allowedDomains: string[];
      networkAccess?: string;
    },
  ): boolean {
    const denied = matchesDomainList(host, rules.deniedDomains ?? []);
    const whitelisted =
      (rules.allowedDomains ?? []).length > 0 &&
      !matchesDomainList(host, rules.allowedDomains ?? []);
    const globalDeny = rules.networkAccess === "deny";
    return denied || whitelisted || globalDeny;
  }

  it("allows when no rules configured (empty = open)", () => {
    expect(shouldBlock("example.com", EMPTY_SECURITY_RULES)).toBe(false);
  });

  it("blocks denied domain", () => {
    expect(
      shouldBlock("evil.com", {
        deniedDomains: ["evil.com"],
        allowedDomains: [],
      }),
    ).toBe(true);
  });

  it("allows non-denied domain when no whitelist", () => {
    expect(
      shouldBlock("safe.com", {
        deniedDomains: ["evil.com"],
        allowedDomains: [],
      }),
    ).toBe(false);
  });

  it("blocks non-whitelisted domain when whitelist is non-empty", () => {
    expect(
      shouldBlock("evil.com", {
        deniedDomains: [],
        allowedDomains: ["example.com"],
      }),
    ).toBe(true);
  });

  it("allows whitelisted domain", () => {
    expect(
      shouldBlock("example.com", {
        deniedDomains: [],
        allowedDomains: ["example.com"],
      }),
    ).toBe(false);
  });

  it("blocks all navigation when networkAccess is deny", () => {
    expect(
      shouldBlock("example.com", {
        deniedDomains: [],
        allowedDomains: [],
        networkAccess: "deny",
      }),
    ).toBe(true);
  });

  it("networkAccess deny overrides whitelist", () => {
    expect(
      shouldBlock("example.com", {
        deniedDomains: [],
        allowedDomains: ["example.com"],
        networkAccess: "deny",
      }),
    ).toBe(true);
  });
});
