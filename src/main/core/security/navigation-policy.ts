const ALLOWED_INTERNAL_SUFFIXES = [".internal", ".intranet", ".corp", ".lan", ".local"];

export function isAllowedExternalUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === "file:") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "::1") return true;
  if (isPrivateIpv4(hostname)) return true;
  if (hostname.includes(":")) return isPrivateIpv6(hostname);
  if (!hostname.includes(".")) return true;
  return ALLOWED_INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index],
    )
  )
    return false;

  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  return hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
}
