import { normalizeTrackerOrigin, trackerOriginMatches } from "./tracker-origin";

describe("tracker origin normalization", () => {
  it("treats www and bare domains as the same origin", () => {
    expect(normalizeTrackerOrigin(" HTTPS://WWW.BYSOLA.RU/ ")).toBe("https://bysola.ru");
    expect(trackerOriginMatches("https://bysola.ru", "https://www.bysola.ru")).toBe(true);
  });

  it("rejects unsupported and private host forms", () => {
    expect(normalizeTrackerOrigin("ftp://bysola.ru")).toBeNull();
    expect(normalizeTrackerOrigin("http://localhost")).toBeNull();
    expect(normalizeTrackerOrigin("http://127.0.0.1")).toBeNull();
    expect(normalizeTrackerOrigin("https://bysola.ru/shop")).toBeNull();
  });
});
