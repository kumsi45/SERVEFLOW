import { useEffect, useMemo, useState } from "react";
import {
  getKnownWaiterProfiles,
  getStoredWaiterSession,
  loadWaiterTerminalContext,
  loadWaiterTerminalProfiles,
  resolveWaiterTerminalProfile,
  signInWaiter,
} from "../services/waiterAuthService";
import type { WaiterTerminalContext, WaiterTerminalProfile } from "../types";
import {
  PinIndicator,
  PinPad,
  RestaurantHeader,
  SearchWaiter,
  WaiterGrid,
} from "../components/WaiterLoginTerminal";
import "../styles/waiterLogin.css";

type WaiterLoginPageProps = { restaurantSlug: string };

function getWaiterDashboardPath(canonicalRestaurantSlug: string) {
  window.sessionStorage.setItem("serveflow.waiter.restaurant-slug", canonicalRestaurantSlug);
  return "/waiter/dashboard";
}

export function WaiterLoginPage({ restaurantSlug }: WaiterLoginPageProps) {
  const [restaurant, setRestaurant] = useState<WaiterTerminalContext | null>(null);
  const [profiles, setProfiles] = useState<WaiterTerminalProfile[]>(() => getKnownWaiterProfiles(restaurantSlug));
  const [selectedWaiter, setSelectedWaiter] = useState<WaiterTerminalProfile | null>(null);
  const [search, setSearch] = useState("");
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const sessionExpired = new URLSearchParams(window.location.search).get("reason") === "expired";

  useEffect(() => {
    const session = getStoredWaiterSession(restaurantSlug);
    if (session) window.location.replace(getWaiterDashboardPath(session.restaurant.slug));
  }, [restaurantSlug]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadWaiterTerminalContext(restaurantSlug), loadWaiterTerminalProfiles(restaurantSlug)])
      .then(([context, terminalProfiles]) => {
        if (mounted) {
          setRestaurant(context);
          setProfiles(terminalProfiles);
        }
      })
      .catch(() => { if (mounted) setError("This restaurant terminal is currently unavailable."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [restaurantSlug]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const visibleProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((profile) =>
      profile.displayName.toLowerCase().includes(query) || profile.employeeId.toLowerCase().includes(query)
    );
  }, [profiles, search]);

  async function findWaiter() {
    const known = visibleProfiles.length === 1 ? visibleProfiles[0] : null;
    if (known) {
      selectWaiter(known);
      return;
    }
    try {
      setResolving(true);
      setError(null);
      const profile = await resolveWaiterTerminalProfile(restaurantSlug, search);
      setProfiles(getKnownWaiterProfiles(restaurantSlug));
      selectWaiter(profile);
    } catch {
      setError("Waiter not found. Check the name or employee ID and try again.");
    } finally {
      setResolving(false);
    }
  }

  function selectWaiter(profile: WaiterTerminalProfile) {
    setSelectedWaiter(profile);
    setPin("");
    setError(null);
  }

  function addDigit(digit: string) {
    if (!submitting) setPin((value) => (value.length < 12 ? `${value}${digit}` : value));
  }

  async function submitPin() {
    if (!selectedWaiter || !pin || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      const session = await signInWaiter(restaurantSlug, selectedWaiter.employeeId, pin);
      window.location.replace(getWaiterDashboardPath(session.restaurant.slug));
    } catch {
      setError("Incorrect PIN. Please try again.");
      setPin("");
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!selectedWaiter) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (/^\d$/.test(event.key)) addDigit(event.key);
      else if (event.key === "Backspace") setPin((value) => value.slice(0, -1));
      else if (event.key === "Enter") void submitPin();
      else if (event.key === "Escape") setSelectedWaiter(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (loading || !restaurant) {
    return <main className="wlt-loading"><img src="/serveflowlogo.png" alt="ServeFlow" /><span>Preparing waiter terminal…</span></main>;
  }

  return (
    <main className="wlt-page">
      <RestaurantHeader restaurant={restaurant} now={now} online={online} />
      {!online && <div className="wlt-offline-note">Offline · Orders will synchronize automatically when the connection returns.</div>}
      {(sessionExpired || error) && !selectedWaiter && (
        <div className={`wlt-notice ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
          {error ?? "Session expired. Please select your name to continue."}
        </div>
      )}

      {!selectedWaiter ? (
        <section className="wlt-selection" aria-labelledby="waiter-selection-title">
          <div className="wlt-section-heading">
            <span>Restaurant terminal</span>
            <h1 id="waiter-selection-title">Select your name to begin</h1>
            <p>Tap your profile, enter your PIN, and start working.</p>
          </div>
          <SearchWaiter value={search} onChange={(value) => { setSearch(value); setError(null); }} onResolve={() => void findWaiter()} busy={resolving} />
          <WaiterGrid profiles={visibleProfiles} onSelect={selectWaiter} />
          {profiles.length === 0 && !search && (
            <div className="wlt-empty"><strong>Find your profile</strong><span>Enter your name or employee ID above once. This terminal will remember verified waiters.</span></div>
          )}
          {profiles.length > 0 && visibleProfiles.length === 0 && (
            <div className="wlt-empty"><strong>No saved profile matches</strong><span>Press Find to securely locate an active waiter.</span></div>
          )}
        </section>
      ) : (
        <section className={`wlt-pin-view ${shake ? "is-shaking" : ""}`} aria-labelledby="pin-title">
          <button type="button" className="wlt-back" onClick={() => { setSelectedWaiter(null); setPin(""); setError(null); }}>← All waiters</button>
          <div className="wlt-pin-identity">
            <span className="wlt-pin-avatar">{selectedWaiter.displayName.slice(0, 1).toUpperCase()}</span>
            <span>{restaurant.name}</span>
            <h1 id="pin-title">Welcome, {selectedWaiter.displayName}</h1>
            <p>Enter your PIN to start working</p>
            <PinIndicator length={pin.length} />
            {error && <div className="wlt-pin-error" role="alert"><strong>Incorrect PIN</strong><span>Please try again.</span></div>}
          </div>
          <PinPad
            onDigit={addDigit}
            onBackspace={() => setPin((value) => value.slice(0, -1))}
            onSubmit={() => void submitPin()}
            disabled={submitting}
          />
          <p className="wlt-keyboard-hint">Press Enter to confirm · Esc to choose another waiter</p>
        </section>
      )}
    </main>
  );
}
