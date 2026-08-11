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
} from "../components/WaiterLoginTerminal";
import "../styles/waiterLogin.css";

type WaiterLoginPageProps = { restaurantSlug: string };
type LoginView = "entry" | "pin";
const WAITER_PIN_LENGTH = 4;

function openWaiterDashboard(canonicalRestaurantSlug: string) {
  window.sessionStorage.setItem("serveflow.waiter.restaurant-slug", canonicalRestaurantSlug);
  window.history.replaceState({}, "", "/waiter/dashboard");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function WaiterLoginPage({ restaurantSlug }: WaiterLoginPageProps) {
  const [restaurant, setRestaurant] = useState<WaiterTerminalContext | null>(null);
  const [view, setView] = useState<LoginView>("entry");
  const [pin, setPin] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const session = getStoredWaiterSession(restaurantSlug);
    if (session) openWaiterDashboard(session.restaurant.slug);
  }, [restaurantSlug]);

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

  function addDigit(digit: string) {
    if (!submitting) {
      setPin((value) => `${value}${digit}`.slice(0, WAITER_PIN_LENGTH));
      setError(null);
    }
  }

  async function submitPin() {
    if (submittingRef.current || pin.length !== WAITER_PIN_LENGTH || !online) return;
    submittingRef.current = true;
    try {
      setSubmitting(true);
      setError(null);
      const result = await signInWaiterWithPin(restaurantSlug, pin);
      openWaiterDashboard(result.session.restaurant.slug);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "PIN not recognized. Try again.");
      setPin("");
      setShake(true);
      window.setTimeout(() => setShake(false), 320);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (view !== "pin") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) addDigit(event.key);
      else if (event.key === "Backspace") {
        event.preventDefault();
        setPin((value) => value.slice(0, -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        void submitPin();
      } else if (event.key === "Escape" && !submitting) {
        setView("entry");
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
      <div className="wlt-status-row">
        <ConnectionStatus online={online} />
      </div>

      {view === "entry" ? (
        <section className="wlt-entry" aria-labelledby="waiter-terminal-title">
          <ServeFlowBrand variant="full" />
          <div className="wlt-tenant-name">{restaurant.name}</div>
          <h1 id="waiter-terminal-title">Waiter Ordering Terminal</h1>
          {error ? <div className="wlt-entry-error" role="alert">{error}</div> : null}
          <button
            type="button"
            className="wlt-login-button"
            onClick={() => {
              setView("pin");
              setPin("");
              setError(online ? null : "Connection unavailable.");
            }}
          >
            Waiter Login
          </button>
        </section>
      ) : (
        <section className={`wlt-pin-panel${shake ? " is-shaking" : ""}`} aria-labelledby="pin-title">
          <button
            type="button"
            className="wlt-back"
            onClick={() => {
              setView("entry");
              setPin("");
              setError(null);
            }}
            disabled={submitting}
            aria-label="Back to waiter login"
          >
            ←
          </button>
          <div className="wlt-pin-heading">
            <span>{restaurant.name}</span>
            <h1 id="pin-title">Enter PIN</h1>
            <PinIndicator length={pin.length} size={WAITER_PIN_LENGTH} />
          </div>
          {error ? <div className="wlt-pin-error" role="alert">{error}</div> : null}
          <PinPad
            onDigit={addDigit}
            onBackspace={() => {
              setPin((value) => value.slice(0, -1));
              setError(null);
            }}
            onSubmit={() => void submitPin()}
            disabled={submitting}
            submitDisabled={pin.length !== WAITER_PIN_LENGTH || !online}
          />
          <div className="wlt-pin-support">Use keypad or keyboard</div>
        </section>
      )}
    </main>
  );
}
