import { AttributionService } from "./attribution.service";

describe("Svyazka attribution tracker browser contract", () => {
  const service = new AttributionService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  function execute(search: string, initialCookie = "") {
    let cookie = initialCookie;
    let checkoutInput:
      { type: string; name: string; value: string } | undefined;
    const form = {
      elements: {
        namedItem: (name: string) =>
          checkoutInput?.name === name ? checkoutInput : null,
      },
      appendChild: (input: typeof checkoutInput) => {
        checkoutInput = input;
      },
    };
    const document = {
      currentScript: {
        dataset: {
          installation: "",
          checkoutField: "attributionId",
          checkoutSelector: "form",
        },
        src: "https://svyazka.test/track/v1.js",
      },
      querySelectorAll: () => [form],
      createElement: () => ({ type: "", name: "", value: "" }),
      documentElement: {},
    };
    Object.defineProperty(document, "cookie", {
      get: () => cookie,
      set: (value: string) => {
        cookie = value.split(";")[0];
      },
    });
    const window: Record<string, unknown> = {};
    const MutationObserver = class {
      observe() {}
    };
    window.MutationObserver = MutationObserver;
    const run = new Function(
      "window",
      "document",
      "location",
      "URLSearchParams",
      "MutationObserver",
      service.trackerScript(),
    );
    run(window, document, { search }, URLSearchParams, MutationObserver);
    return {
      cookie,
      checkoutInput,
      getAttributionId: (
        window.SvyazkaAttribution as {
          getAttributionId: () => string | null;
        }
      ).getAttributionId,
    };
  }

  it("persists an opaque attributionId and exposes only the stable getter", () => {
    const expiresAt = Date.now() + 60_000;
    const result = execute(`?svz_a=svz_a_public-token&svz_exp=${expiresAt}`);
    expect(result.cookie).toBe("_svz_at=svz_a_public-token");
    expect(result.getAttributionId()).toBe("svz_a_public-token");
    expect(result.checkoutInput).toEqual({
      type: "hidden",
      name: "attributionId",
      value: "svz_a_public-token",
    });
  });

  it("survives internal navigation after attribution query parameters disappear", () => {
    const nextPage = execute("", "_svz_at=svz_a_public-token");
    expect(nextPage.getAttributionId()).toBe("svz_a_public-token");
    expect(nextPage.checkoutInput?.value).toBe("svz_a_public-token");
  });

  it("does not attribute a new browser or accept an expired incoming token", () => {
    expect(execute("").getAttributionId()).toBeNull();
    expect(
      execute(
        `?svz_a=svz_a_expired-token&svz_exp=${Date.now() - 1}`,
      ).getAttributionId(),
    ).toBeNull();
  });
});
