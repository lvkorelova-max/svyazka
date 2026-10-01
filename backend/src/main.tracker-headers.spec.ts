import { applyTrackerScriptHeaders } from "./tracker-script-headers";

describe("tracker script response headers", () => {
  it("allows the public tracker script to load cross-origin", () => {
    const headers: Record<string, string> = {};
    applyTrackerScriptHeaders(
      { path: "/track/v1.js" },
      {
        setHeader: (name, value) => {
          headers[name] = String(value);
        },
      },
    );

    expect(headers["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("does not relax headers for API routes", () => {
    const setHeader = jest.fn();
    applyTrackerScriptHeaders(
      { path: "/api/brand/tilda-integration" },
      { setHeader },
    );
    expect(setHeader).not.toHaveBeenCalled();
  });
});
