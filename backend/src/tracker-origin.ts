export function normalizeTrackerOrigin(value: string): string | null {
  try {
    const trimmed = value.trim();
    const parsed = new URL(
      /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    );
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    ) {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname || hostname === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
      return null;
    }
    return `${parsed.protocol}//${hostname}`;
  } catch {
    return null;
  }
}

export function trackerOriginMatches(origin: string, configured: string): boolean {
  const normalizedOrigin = normalizeTrackerOrigin(origin);
  const normalizedConfigured = normalizeTrackerOrigin(configured);
  return Boolean(
    normalizedOrigin &&
      normalizedConfigured &&
      normalizedOrigin === normalizedConfigured,
  );
}
