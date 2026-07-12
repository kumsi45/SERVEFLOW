const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function assertBefore(haystack, before, after) {
  const beforeIndex = haystack.indexOf(before);
  const afterIndex = haystack.indexOf(after);
  return beforeIndex !== -1 && afterIndex !== -1 && beforeIndex < afterIndex;
}

function main() {
  const appUrl = read("src/core/config/appUrl.ts");
  const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
  const setupWizard = read("src/modules/setup-wizard/pages/RestaurantSetupWizardPage.tsx");
  const qrRenderers = `${ownerPage}\n${setupWizard}`;

  const results = [
    result(
      "Single app URL resolver exists",
      appUrl.includes("export function getAppUrl()")
        && assertBefore(appUrl, "VITE_PUBLIC_APP_URL", "VITE_APP_URL")
        && assertBefore(appUrl, "VITE_APP_URL", "window.location.origin"),
      "Expected getAppUrl priority: VITE_PUBLIC_APP_URL, VITE_APP_URL, window.location.origin."
    ),
    result(
      "Shared absolute QR URL helper exists",
      appUrl.includes("export function buildAbsolutePublicUrl")
        && appUrl.includes("return `${getAppUrl()}${rawUrl}`"),
      "Relative stored QR paths must be promoted to absolute scanner URLs."
    ),
    result(
      "QR payload guard rejects relative paths",
      appUrl.includes("export function assertAbsoluteQrPayload")
        && appUrl.includes("Generated table QR payload must be an absolute public URL"),
      "Physical QR payloads must never start with /r/."
    ),
    result(
      "Owner QR renderer uses shared absolute helper",
      ownerPage.includes("buildAbsolutePublicUrl(qrUrl?.trim() || qrPath?.trim())")
        && ownerPage.includes("assertAbsoluteQrPayload(url)")
        && ownerPage.includes("assertAbsoluteQrPayload(printable.orderingUrl)")
        && ownerPage.includes("assertAbsoluteQrPayload(orderingUrl)"),
      "Owner QR thumbnails, modal exports, print, and downloads must encode absolute URLs."
    ),
    result(
      "Setup Wizard QR renderer uses shared absolute helper",
      setupWizard.includes("buildAbsolutePublicUrl(table.qr_url?.trim() || table.qr_path?.trim())")
        && setupWizard.includes("assertAbsoluteQrPayload(orderingUrl)"),
      "Setup Wizard QR publishing and print flows must encode absolute URLs."
    ),
    result(
      "QR renderers do not return raw /r/ payloads",
      !qrRenderers.includes('return rawUrl.startsWith("/") ? rawUrl')
        && !qrRenderers.includes("QRCode.toDataURL(table.qr_path")
        && !qrRenderers.includes("QRCode.toDataURL(table.qr_url")
        && !qrRenderers.includes("QRCode.toString(table.qr_path")
        && !qrRenderers.includes("QRCode.toString(table.qr_url"),
      "QR image payload must come from buildAbsolutePublicUrl, not raw qr_path or qr_url."
    ),
  ];

  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? `: ${entry.detail}` : ""}`);
  }

  const failures = results.filter((entry) => !entry.ok);
  console.log(`Passed: ${results.length - failures.length}`);
  console.log(`Failed: ${failures.length}`);
  if (failures.length > 0) process.exit(1);
}

main();
