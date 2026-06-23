import { FormEvent, useState } from "react";
import {
  getStaffDestinations,
  redirectToStaffDestination,
  signInStaff,
} from "../services/staffAuthService";
import type { StaffDestination } from "../types";
import "../styles/staffLogin.css";

// ─── chart bar heights for the mockup ────────────────────────────────────────
const chartBars = [30, 55, 40, 70, 50, 85, 60, 90, 45, 75, 65, 100];

// ─── Left panel — restaurant ops illustration ─────────────────────────────────
function LeftPanel() {
  return (
    <div className="sl-left">
      {/* brand */}
      <div className="sl-brand">
        <div className="sl-brand-icon">S</div>
        <span className="sl-brand-name">ServeFlow</span>
      </div>

      {/* dashboard mockup */}
      <div className="sl-mockup">
        <div className="sl-mockup-bar">
          <div className="sl-mockup-dots">
            <span style={{ background: "#ff5f57" }} />
            <span style={{ background: "#febc2e" }} />
            <span style={{ background: "#28c840" }} />
          </div>
          <span className="sl-mockup-label">LIVE WORKSPACE v2.4</span>
        </div>

        <div className="sl-mockup-cards">
          <div className="sl-mockup-card">
            <div className="sl-mockup-card-head">
              <span className="sl-mockup-order-id">ORDER #882</span>
              <span className="sl-mockup-status sl-status-prep">IN PREP</span>
            </div>
            <div className="sl-mockup-bar-lines">
              <div className="sl-bar-line" />
              <div className="sl-bar-line" />
              <div className="sl-bar-line" style={{ width: "40%" }} />
            </div>
          </div>
          <div className="sl-mockup-card">
            <div className="sl-mockup-card-head">
              <span className="sl-mockup-order-id">ORDER #881</span>
              <span className="sl-mockup-status sl-status-ready">READY</span>
            </div>
            <div className="sl-mockup-bar-lines">
              <div className="sl-bar-line" style={{ width: "90%", background: "linear-gradient(90deg,#16a34a,#4ade80)" }} />
              <div className="sl-bar-line" style={{ width: "70%" }} />
              <div className="sl-bar-line" style={{ width: "50%" }} />
            </div>
          </div>
        </div>

        <div className="sl-mockup-chart">
          {chartBars.map((h, i) => (
            <div key={i} className="sl-chart-bar" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      {/* feature highlights */}
      <div className="sl-features">
        {[
          "Real-Time Orders",
          "Kitchen Display System",
          "Cashier Management",
          "QR Ordering",
        ].map((f) => (
          <div key={f} className="sl-feature">
            <div className="sl-feature-check">✓</div>
            <span className="sl-feature-text">{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard selector (after login with multiple destinations) ───────────────
function DestinationPicker({ destinations }: { destinations: StaffDestination[] }) {
  function getDashboardLabel(destination: StaffDestination) {
    if (destination.dashboard === "owner") return "Owner Dashboard";
    if (destination.dashboard === "cashier") return "Cashier Dashboard";
    return "Kitchen Dashboard";
  }

  return (
    <div className="sl-right">
      <div className="sl-card">
        <div className="sl-card-brand">
          <div className="sl-card-brand-icon">S</div>
          <span className="sl-card-brand-name">ServeFlow</span>
        </div>
        <h1 className="sl-heading">Select Dashboard</h1>
        <p className="sl-subheading">Choose your workspace to continue.</p>
        <div className="sl-dest-grid">
          {destinations.map((dest) => (
            <button
              key={`${dest.dashboard}:${dest.restaurant.id}`}
              type="button"
              className="sl-dest-btn"
              onClick={() => redirectToStaffDestination(dest)}
            >
              <div className={`sl-dest-icon ${dest.dashboard}`}>
                {dest.dashboard === "cashier" ? "💳" : "🍳"}
              </div>
              <div>
                <div className="sl-dest-info-name">
                  {getDashboardLabel(dest)}
                </div>
                <div className="sl-dest-info-rest">{dest.restaurant.name}</div>
              </div>
              <span className="sl-dest-arrow">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main login page ──────────────────────────────────────────────────────────
export function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<StaffDestination[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setIsSubmitting(true);
      setError(null);
      const staffSession = await signInStaff(email.trim(), password);
      const staffDestinations = getStaffDestinations(staffSession);
      if (staffDestinations.length === 1) {
        redirectToStaffDestination(staffDestinations[0]);
        return;
      }
      setDestinations(staffDestinations);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (destinations.length > 1) {
    return (
      <div className="sl-root">
        <LeftPanel />
        <DestinationPicker destinations={destinations} />
      </div>
    );
  }

  return (
    <div className="sl-root">
      <LeftPanel />

      <div className="sl-right">
        <div className="sl-card">
          {/* brand */}
          <div className="sl-card-brand">
            <div className="sl-card-brand-icon">S</div>
            <span className="sl-card-brand-name">ServeFlow</span>
          </div>

          <h1 className="sl-heading">Welcome Back</h1>
          <p className="sl-subheading">Sign in to access your restaurant workspace</p>

          {error && (
            <div className="sl-error" role="alert">
              <span>⚠️</span> {error}
            </div>
          )}

          <form className="sl-form" onSubmit={handleSubmit} noValidate>
            {/* email */}
            <div className="sl-input-wrap">
              <span className="sl-input-icon" aria-hidden="true">✉</span>
              <input
                className="sl-input"
                type="email"
                placeholder="Work email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                autoComplete="email"
                inputMode="email"
                aria-label="Work email"
              />
            </div>

            {/* password */}
            <div className="sl-input-wrap">
              <span className="sl-input-icon" aria-hidden="true">🔒</span>
              <input
                className="sl-input"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
                autoComplete="current-password"
                aria-label="Password"
              />
              <button
                type="button"
                className="sl-pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>

            {/* remember + forgot */}
            <div className="sl-form-row">
              <label className="sl-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>
              <a href="/forgot-password" className="sl-forgot">
                Forgot password?
              </a>
            </div>

            {/* submit */}
            <button type="submit" className="sl-submit" disabled={isSubmitting}>
              {isSubmitting
                ? <><div className="sl-submit-spinner" />Signing In...</>
                : <>CONTINUE TO WORKSPACE →</>
              }
            </button>

            {/* SSO divider */}
            <div className="sl-divider">
              <div className="sl-divider-line" />
              <span className="sl-divider-text">Or sign in with SSO</span>
              <div className="sl-divider-line" />
            </div>

            {/* SSO button */}
            <button
              type="button"
              className="sl-sso-btn"
              onClick={() => {}}
              aria-label="Single Sign-On"
            >
              <span>⊞</span> Single Sign-On (SAML)
            </button>

            <p className="sl-register-row">
              Don't have an account?{" "}
              <a href="/sign-up" className="sl-register-link">Request a demo</a>
            </p>
          </form>
        </div>

        <div className="sl-security">
          <span>🔒</span>
          Protected by enterprise-grade security
        </div>
      </div>
    </div>
  );
}
