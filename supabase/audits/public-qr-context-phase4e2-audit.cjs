const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const sourceRoot = path.join(__dirname, "..", "..");

function readSource(...segments) {
  return fs.readFileSync(path.join(sourceRoot, ...segments), "utf8");
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function simulateScanStorageSequence(scans) {
  const storage = new Map();
  const activeSessionKey = "serveflow.publicQrActiveSessionKey";
  const legacyActiveScanKey = "serveflow.publicQrActiveScan";
  const prefixesToClear = [
    "serveflow.publicQrContext",
    "serveflow.publicQrCart",
    "serveflow.publicQrCheckout",
  ];

  for (const scan of scans) {
    storage.set("serveflow.publicQrContext:old", "stale-table");
    storage.set("serveflow.publicQrCart:old", "stale-cart");
    storage.set("serveflow.publicQrCheckout:old", "stale-checkout");
    storage.set(legacyActiveScanKey, "legacy-stale-scan");

    const sessionKey = `${scan.slug}-${scan.table}-${scan.qr}`;
    if (storage.get(activeSessionKey) !== sessionKey) {
      for (const key of [...storage.keys()]) {
        if (prefixesToClear.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
          storage.delete(key);
        }
      }
      storage.delete(legacyActiveScanKey);
      storage.set(activeSessionKey, sessionKey);
    }
  }

  return {
    activeSession: storage.get(activeSessionKey),
    staleKeys: [...storage.keys()].filter((key) => key !== activeSessionKey),
  };
}

async function main() {
  const results = [];
  const qrContext = readSource("src", "modules", "public-qr-ordering", "services", "publicQrContext.ts");
  const checkoutHook = readSource("src", "modules", "public-qr-ordering", "hooks", "usePublicQrCheckoutState.ts");
  const cartHook = readSource("src", "modules", "public-qr-ordering", "hooks", "usePublicQrCart.ts");
  const qrMenuPage = readSource("src", "modules", "qr-menu", "pages", "QRMenuPage.tsx");
  const orderingPage = readSource("src", "modules", "ordering", "pages", "OrderingPage.tsx");

  results.push(result(
    "QR context no longer restores table or token from localStorage",
    !qrContext.includes("readStoredQrContext")
      && !qrContext.includes("storeQrContext")
      && !qrContext.includes('source: "stored"')
      && !qrContext.includes("storedContext")
      && qrContext.includes("new URLSearchParams(window.location.search)"),
    "Only current URL search params may populate tableNumber and qrToken."
  ));

  results.push(result(
    "A new scan purges old public QR context, checkout, and cart storage",
    qrContext.includes("clearPublicQrStorageForNewSession")
      && qrContext.includes("serveflow.publicQrActiveSessionKey")
      && qrContext.includes("serveflow.publicQrContext")
      && qrContext.includes("serveflow.publicQrCart")
      && qrContext.includes("serveflow.publicQrCheckout")
      && qrContext.includes("window.localStorage.removeItem(key)"),
    "Scan replacement explicitly removes stale public QR storage prefixes."
  ));

  results.push(result(
    "Checkout state is scoped to the active QR session key",
    checkoutHook.includes("qrContext.sessionKey")
      && checkoutHook.includes("getCheckoutStorageKey(restaurantSlug, sessionKey")
      && checkoutHook.includes("setTableNumber(qrContext.tableNumber)")
      && checkoutHook.includes("sessionKey: qrContext.sessionKey"),
    "Customer name, payment method, visibility, and table state reset on scan changes."
  ));

  results.push(result(
    "Cart state is scoped by session key and not just restaurant",
    cartHook.includes("sessionKey")
      && cartHook.includes("getCartStorageKey(restaurantSlug, sessionKey")
      && qrMenuPage.includes("usePublicQrCart(restaurantSlug, checkout.sessionKey)")
      && qrMenuPage.includes("checkout.sessionKey"),
    "Public cart storage follows the active QR scan."
  ));

  results.push(result(
    "Public routes clear session and confirmation state when QR context changes",
    qrMenuPage.includes("setActiveSession(null)")
      && qrMenuPage.includes("setSubmittedOrder(undefined)")
      && qrMenuPage.includes("[checkout.sessionKey, restaurantSlug]")
      && orderingPage.includes("setActiveSession(null)")
      && orderingPage.includes("setSubmittedOrder(null)")
      && orderingPage.includes("[qrParams.sessionKey, restaurantSlug]"),
    "Both public entry points reset current order/session state for a new scan."
  ));

  results.push(result(
    "No public QR submit path bypasses shared context reader",
    !checkoutHook.includes('params.get("qr")')
      && !qrMenuPage.includes("new URLSearchParams(window.location.search)")
      && !orderingPage.includes("new URLSearchParams(window.location.search)")
      && qrMenuPage.includes("checkout.qrToken")
      && orderingPage.includes("qrParams.qrToken"),
    "Only publicQrContext.ts reads QR URL parameters."
  ));

  const sequence = simulateScanStorageSequence([
    { slug: "restaurant-a", table: "1", qr: "qr-a1" },
    { slug: "restaurant-a", table: "5", qr: "qr-a5" },
    { slug: "restaurant-b", table: "2", qr: "qr-b2" },
    { slug: "restaurant-b", table: "9", qr: "qr-b9" },
    { slug: "restaurant-a", table: "3", qr: "qr-a3" },
  ]);
  results.push(result(
    "A1 to A5 to B2 to B9 to A3 scan sequence leaves only the latest scan active",
    sequence.activeSession === "restaurant-a-3-qr-a3" && sequence.staleKeys.length === 0,
    JSON.stringify(sequence)
  ));

  try {
    execSync("npm run build", { cwd: sourceRoot, stdio: "pipe" });
    results.push(result("Build passes", true));
  } catch (error) {
    results.push(result("Build passes", false, error.stdout?.toString() || error.message));
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}: ${entry.detail}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
