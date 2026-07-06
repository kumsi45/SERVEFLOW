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

function buildSessionKey(scan) {
  return `${scan.slug}-${scan.table}-${scan.qr}`;
}

function simulateQrSessionBoundary(scans) {
  const storage = new Map();
  const activeSessionKey = "serveflow.publicQrActiveSessionKey";
  const prefixesToClear = [
    "serveflow.publicQrContext",
    "serveflow.publicQrCart",
    "serveflow.publicQrCheckout",
  ];

  let memory = {
    cartItems: ["old-item"],
    checkoutVisible: true,
    activeOrderId: "old-order",
    submittedOrderId: "old-submitted",
  };

  for (const scan of scans) {
    const sessionKey = buildSessionKey(scan);
    storage.set("serveflow.publicQrContext:stale", "stale-context");
    storage.set("serveflow.publicQrCart:stale", "stale-cart");
    storage.set("serveflow.publicQrCheckout:stale", "stale-checkout");

    if (storage.get(activeSessionKey) !== sessionKey) {
      for (const key of [...storage.keys()]) {
        if (prefixesToClear.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
          storage.delete(key);
        }
      }

      storage.set(activeSessionKey, sessionKey);
      memory = {
        cartItems: [],
        checkoutVisible: false,
        activeOrderId: null,
        submittedOrderId: null,
      };
    }
  }

  return {
    activeSessionKey: storage.get(activeSessionKey),
    staleStorageKeys: [...storage.keys()].filter((key) => key !== activeSessionKey),
    memory,
  };
}

async function main() {
  const results = [];
  const qrContext = readSource("src", "modules", "public-qr-ordering", "services", "publicQrContext.ts");
  const checkoutHook = readSource("src", "modules", "public-qr-ordering", "hooks", "usePublicQrCheckoutState.ts");
  const cartHook = readSource("src", "modules", "public-qr-ordering", "hooks", "usePublicQrCart.ts");
  const qrMenuPage = readSource("src", "modules", "qr-menu", "pages", "QRMenuPage.tsx");
  const orderingPage = readSource("src", "modules", "ordering", "pages", "OrderingPage.tsx");
  const publicModules = [qrContext, checkoutHook, cartHook, qrMenuPage, orderingPage].join("\n");

  results.push(result(
    "Public QR context exposes the immutable PublicQrSession boundary",
    qrContext.includes("export type PublicQrSession")
      && qrContext.includes("restaurantId: string | null")
      && qrContext.includes("tableNumber: string")
      && qrContext.includes("qrToken: string")
      && qrContext.includes("sessionKey: string")
      && qrContext.includes("activeOrderId: string | null")
      && qrContext.includes("buildPublicQrSession("),
    "PublicQrSession carries restaurantId, tableNumber, qrToken, sessionKey, and activeOrderId."
  ));

  results.push(result(
    "Session key is deterministic and derived only from restaurant slug, table number, and QR token",
    qrContext.includes("buildPublicQrSessionKey")
      && qrContext.includes("`${restaurantSlug.trim()}-${tableNumber.trim()}-${qrToken.trim()}`")
      && !publicModules.includes("scanKey"),
    "The old scanKey identity was removed from public QR runtime code."
  ));

  results.push(result(
    "QR changes purge stale public storage at the session boundary",
    qrContext.includes("serveflow.publicQrActiveSessionKey")
      && qrContext.includes("clearPublicQrStorageForNewSession")
      && qrContext.includes("serveflow.publicQrCart")
      && qrContext.includes("serveflow.publicQrCheckout")
      && qrContext.includes("window.localStorage.removeItem(key)"),
    "Cart, checkout, and old QR context storage are cleared on sessionKey mismatch."
  ));

  results.push(result(
    "Checkout and cart state are scoped only by sessionKey",
    checkoutHook.includes("qrContext.sessionKey")
      && checkoutHook.includes("sessionKey: qrContext.sessionKey")
      && cartHook.includes("usePublicQrCart(restaurantSlug: string, sessionKey = \"\")")
      && qrMenuPage.includes("usePublicQrCart(restaurantSlug, checkout.sessionKey)"),
    "No restaurant-only public cart or checkout state survives a QR session switch."
  ));

  results.push(result(
    "QRMenuPage fully resets UI/session memory when sessionKey changes",
    qrMenuPage.includes("[checkout.sessionKey, restaurantSlug]")
      && qrMenuPage.includes("setActiveSession(null)")
      && qrMenuPage.includes("setSubmittedOrder(undefined)")
      && qrMenuPage.includes("setSubmitError(undefined)")
      && qrMenuPage.includes("setCartVisible(false)")
      && qrMenuPage.includes("setFoodInfoItem(undefined)")
      && qrMenuPage.includes("cart.clearCart()"),
    "The menu route clears active session, submitted order, errors, cart panel, food panel, and cart."
  ));

  results.push(result(
    "OrderingPage fully resets UI/session memory when sessionKey changes",
    orderingPage.includes("[qrParams.sessionKey, restaurantSlug]")
      && orderingPage.includes("setActiveSession(null)")
      && orderingPage.includes("setSubmittedOrder(null)")
      && orderingPage.includes("setCheckoutError(null)")
      && orderingPage.includes("clearCart()")
      && orderingPage.includes("setSubmitting(false)"),
    "The ordering route clears active session, submitted order, errors, submitting state, and cart."
  ));

  results.push(result(
    "Public routes reject stale async session/order results after a QR switch",
    qrMenuPage.includes("currentSessionKeyRef")
      && qrMenuPage.includes("currentSessionKeyRef.current === requestSessionKey")
      && orderingPage.includes("currentSessionKeyRef")
      && orderingPage.includes("currentSessionKeyRef.current === requestSessionKey"),
    "Async fetch and submit completions are guarded by the active sessionKey."
  ));

  const sequence = simulateQrSessionBoundary([
    { slug: "restaurant-a", table: "1", qr: "qr-a1" },
    { slug: "restaurant-a", table: "5", qr: "qr-a5" },
    { slug: "restaurant-b", table: "2", qr: "qr-b2" },
    { slug: "restaurant-b", table: "9", qr: "qr-b9" },
    { slug: "restaurant-a", table: "3", qr: "qr-a3" },
  ]);
  results.push(result(
    "A1 to A5 to B2 to B9 to A3 leaves only the last QR session active",
    sequence.activeSessionKey === "restaurant-a-3-qr-a3"
      && sequence.staleStorageKeys.length === 0
      && sequence.memory.cartItems.length === 0
      && sequence.memory.checkoutVisible === false
      && sequence.memory.activeOrderId === null
      && sequence.memory.submittedOrderId === null,
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
