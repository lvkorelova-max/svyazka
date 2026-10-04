export function buildTrackerInstallationPayload(form) {
  return {
    name: form.name.trim(),
    primaryDomain: form.primaryDomain.trim(),
    allowedOrigins: form.allowedOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    consentMode: form.consentMode
  };
}

export function trackerScriptSnippet(publicKey, publicBackendOrigin) {
  const origin = publicBackendOrigin.replace(/\/+$/, "");
  return `<script src="${origin}/track/v1.js" data-installation="${publicKey}" async></script>`;
}
