import { FormEvent, useEffect, useState } from "react";
import {
  getStoredWaiterSession,
  loadWaiterTerminalContext,
  signInWaiter,
  signOutWaiter,
} from "../services/waiterAuthService";
import type { WaiterSession, WaiterTerminalContext } from "../types";
import "../styles/waiterLogin.css";

type WaiterLoginPageProps = {
  restaurantSlug: string;
};

function getWaiterDashboardPath(canonicalRestaurantSlug: string) {
  return `/waiter/${encodeURIComponent(canonicalRestaurantSlug)}/dashboard`;
}

export function WaiterLoginPage({ restaurantSlug }: WaiterLoginPageProps) {
  const [restaurant, setRestaurant] = useState<WaiterTerminalContext | null>(null);
  const [session, setSession] = useState<WaiterSession | null>(() =>
    getStoredWaiterSession(restaurantSlug)
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadContext() {
      try {
        setLoading(true);
        setError(null);
        const terminalContext = await loadWaiterTerminalContext(restaurantSlug);
        if (mounted) {
          setRestaurant(terminalContext);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Waiter terminal is unavailable.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadContext();

    return () => {
      mounted = false;
    };
  }, [restaurantSlug]);

  useEffect(() => {
    if (session) {
      window.location.replace(getWaiterDashboardPath(session.restaurant.slug));
    }
  }, [session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSubmitting(true);
      setError(null);
      const waiterSession = await signInWaiter(restaurantSlug, username, password);
      setSession(waiterSession);
      setUsername("");
      setPassword("");
      window.location.replace(getWaiterDashboardPath(waiterSession.restaurant.slug));
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Waiter login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await signOutWaiter();
    } finally {
      setSession(null);
      setUsername("");
      setPassword("");
      setError(null);
    }
  }

  const displayRestaurant = session?.restaurant ?? restaurant;
  const initial = displayRestaurant?.name?.slice(0, 1).toUpperCase() || "S";

  if (loading) {
    return (
      <main className="waiter-login-page">
        <section className="waiter-login-card">
          <div className="waiter-logo-fallback">S</div>
          <p className="waiter-status-text">Loading waiter terminal...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="waiter-login-page">
      <section className="waiter-login-card" aria-labelledby="waiter-login-title">
        <div className="waiter-brand">
          <img src="/serveflowlogo.png" alt="" className="waiter-brand-logo" />
          <span>ServeFlow Waiter</span>
        </div>

        <div className="waiter-restaurant-mark" aria-hidden="true">
          {displayRestaurant?.logoUrl ? (
            <img src={displayRestaurant.logoUrl} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </div>

        <h1 id="waiter-login-title">{displayRestaurant?.name ?? "Waiter Terminal"}</h1>

        {session ? (
          <div className="waiter-session-panel" role="status">
            <p className="waiter-session-kicker">Logged in</p>
            <p className="waiter-session-name">{session.displayName}</p>
            <button type="button" className="waiter-submit" onClick={handleLogout}>
              Logout
            </button>
          </div>
        ) : (
          <form className="waiter-login-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="waiter-error" role="alert">
                {error}
              </div>
            )}

            <label>
              <span>Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
                autoComplete="username"
                inputMode="text"
                required
              />
            </label>

            <label>
              <span>PIN / Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                autoComplete="current-password"
                inputMode="numeric"
                type="password"
                required
              />
            </label>

            <button type="submit" className="waiter-submit" disabled={submitting}>
              {submitting ? "Logging in..." : "Login"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
