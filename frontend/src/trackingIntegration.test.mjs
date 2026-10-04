import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrackerInstallationPayload,
  trackerScriptSnippet
} from "./trackingIntegration.mjs";
import { getPublicBackendOrigin } from "./api/client.js";

test("maps tracker installation fields to the backend DTO", () => {
  assert.deepEqual(
    buildTrackerInstallationPayload({
      name: "  Main store  ",
      primaryDomain: " shop.example.com ",
      allowedOrigins: " https://shop.example.com, https://www.shop.example.com ",
      consentMode: "REQUIRED"
    }),
    {
      name: "Main store",
      primaryDomain: "shop.example.com",
      allowedOrigins: [
        "https://shop.example.com",
        "https://www.shop.example.com"
      ],
      consentMode: "REQUIRED"
    }
  );
});

test("resolves production relative API to the public backend origin", () => {
  assert.equal(
    getPublicBackendOrigin("https://svyazka.pro", "/api"),
    "https://svyazka.pro"
  );
  assert.equal(
    trackerScriptSnippet("svz_pub_example", getPublicBackendOrigin("https://svyazka.pro", "/api")),
    '<script src="https://svyazka.pro/track/v1.js" data-installation="svz_pub_example" async></script>'
  );
});

test("resolves local absolute API to the local backend origin", () => {
  assert.equal(
    getPublicBackendOrigin("http://localhost:3000", "http://localhost:3000/api"),
    "http://localhost:3000"
  );
  assert.equal(
    trackerScriptSnippet("svz_pub_example", getPublicBackendOrigin("http://localhost:3000", "http://localhost:3000/api")),
    '<script src="http://localhost:3000/track/v1.js" data-installation="svz_pub_example" async></script>'
  );
});
