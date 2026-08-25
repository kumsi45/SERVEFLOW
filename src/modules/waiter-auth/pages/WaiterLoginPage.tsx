import { useEffect, useRef, useState } from "react";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
import {
  getStoredWaiterSession,
  loadWaiterTerminalContext,
  signInWaiterWithPin,
} from "../services/waiterAuthService";
import type { WaiterTerminalContext } from "../types";
import {
  ConnectionStatus,
  PinIndicator,
  PinPad,
  TerminalClock,
} from "../components/WaiterLoginTerminal";
import "../styles/waiterLogin.css";

type WaiterLoginPageProps = { restaurantSlug: string };
const WAITER_PIN_LENGTH = 4;

function TableStatusStrip({ status }: { status: WaiterTerminalContext["tableStatus"] }) {
  if (!status) return null;
  const items = [
    { label: "Tables", value: status.total },
    { label: "Available", value: status.available },
    { label: "Occupied", value: status.occupied },
    ...(status.other > 0 ? [{ label: "Other", value: status.other }] : []),
  ];

  return (
    <div className="wlt-table-status" aria-label="Table status">
      <span>Table status</span>
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function loginMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "PIN not recognized. Try again.";
  return message.startsWith("Too many attempts")
    ? "Too many attempts. Try again shortly or contact a manager."
    : message;
}

function openWaiterDashboard(canonicalRestaurantSlug: string) {
  window.sessionStorage.setItem("serveflow.waiter.restaurant-slug", canonicalRestaurantSlug);
  window.history.replaceState({}, "", "/waiter/dashboard");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function WaiterLoginPage({ restaurantSlug }: WaiterLoginPageProps) {
  const [restaurant, setRestaurant] = useState<WaiterTerminalContext | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [pin, setPin] = useState("");
  const pinRef = useRef("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const loginAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const session = getStoredWaiterSession(restaurantSlug);
    if (session) openWaiterDashboard(session.restaurant.slug);
  }, [restaurantSlug]);

  useEffect(() => setLogoFailed(false), [restaurant?.logoUrl]);

  useEffect(() => {
    let mounted = true;
    void loadWaiterTerminalContext(restaurantSlug)
      .then((context) => {
        if (mounted) setRestaurant(context);
      })
      .catch(() => {
        if (mounted) setError("Connection unavailable.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [restaurantSlug]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => () => loginAbortRef.current?.abort(), []);

  function addDigit(digit: string) {
    if (submittingRef.current) return;
    const nextPin = `${pinRef.current}${digit}`.slice(0, WAITER_PIN_LENGTH);
    pinRef.current = nextPin;
    setPin(nextPin);
    setError(null);
    if (nextPin.length === WAITER_PIN_LENGTH) void submitPin(nextPin);
  }

  function removeDigit() {
    if (submittingRef.current) return;
    pinRef.current = pinRef.current.slice(0, -1);
    setPin(pinRef.current);
    setError(null);
  }

  async function submitPin(candidatePin = pinRef.current) {
    if (submittingRef.current || candidatePin.length !== WAITER_PIN_LENGTH || !online) return;
    submittingRef.current = true;
    const controller = new AbortController();
    loginAbortRef.current = controller;
    try {
      setSubmitting(true);
      setError(null);
      const result = await signInWaiterWithPin(restaurantSlug, candidatePin, {
        signal: controller.signal,
      });
      openWaiterDashboard(result.session.restaurant.slug);
    } catch (loginError) {
      if (controller.signal.aborted) return;
      setError(loginMessage(loginError));
      pinRef.current = "";
      setPin("");
      setShake(true);
      window.setTimeout(() => setShake(false), 320);
    } finally {
      if (loginAbortRef.current === controller) loginAbortRef.current = null;
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) addDigit(event.key);
      else if (event.key === "Backspace") {
        event.preventDefault();
        removeDigit();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void submitPin();
      } else if (event.key === "Escape" && !submittingRef.current) {
        pinRef.current = "";
        setPin("");
        setError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (loading || !restaurant) {
    return (
      <main className="wlt-loading">
        <ServeFlowBrand variant="full" />
        <span>{error ?? "Opening waiter terminal…"}</span>
      </main>
    );
  }

  return (
    <main className="wlt-page">
      <header className="wlt-terminal-header">
        <div className="wlt-product-identity">
          <ServeFlowBrand variant="full" />
          <span>Waiter terminal</span>
        </div>
        <div className="wlt-status-row">
          <ConnectionStatus online={online} />
          <TerminalClock />
        </div>
      </header>

      <div className="wlt-terminal-shell">
        <section className="wlt-terminal-context" aria-label="Terminal guidance">
          <div>
            <span className="wlt-context-eyebrow">Shared tablet</span>
            <h2>Ready for service</h2>
            <p>Enter your PIN to open your assigned workspace.</p>
          </div>
          <TableStatusStrip status={restaurant.tableStatus} />
          <div className="wlt-context-points" aria-label="Staff access information">
            <div>
              <span aria-hidden="true">01</span>
              <p><strong>Private workspace</strong>Your assigned service view opens after sign-in.</p>
            </div>
            <div>
              <span aria-hidden="true">02</span>
              <p><strong>Shared-device ready</strong>Logout safely hands the terminal to the next waiter.</p>
            </div>
          </div>
        </section>

        <section className={`wlt-pin-panel${shake ? " is-shaking" : ""}`} aria-labelledby="pin-title">
          <div className="wlt-tenant-identity">
            {restaurant.logoUrl && !logoFailed ? (
              <img src={restaurant.logoUrl} alt="" width="48" height="48" onError={() => setLogoFailed(true)} />
            ) : (
              <span className="wlt-tenant-mark" aria-hidden="true">{restaurant.name.trim().charAt(0).toUpperCase()}</span>
            )}
            <span className="wlt-tenant-name" title={restaurant.name}>{restaurant.name}</span>
          </div>
          <div className="wlt-pin-heading">
            <h1 id="pin-title">Enter PIN</h1>
            <PinIndicator length={pin.length} size={WAITER_PIN_LENGTH} />
          </div>
          <div className="wlt-pin-feedback" aria-live="polite">
            {error ? <div className="wlt-pin-error" role="alert">{error}</div> : null}
            {!error && submitting ? <div className="wlt-verifying" role="status">Verifying…</div> : null}
          </div>
          <PinPad
            onDigit={addDigit}
            onBackspace={removeDigit}
            onSubmit={() => void submitPin()}
            disabled={submitting}
            submitDisabled={pin.length !== WAITER_PIN_LENGTH || !online}
          />
          <div className="wlt-pin-support">Use keypad or keyboard</div>
          <TableStatusStrip status={restaurant.tableStatus} />
        </section>
      </div>

      <footer className="wlt-terminal-footer">
        <span>Need help? Contact a manager.</span>
        <span><i aria-hidden="true" /> Secure staff access</span>
      </footer>
    </main>
  );
}
