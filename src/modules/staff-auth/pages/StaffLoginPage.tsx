import { FormEvent, useState } from "react";
import {
  getStaffDestinations,
  redirectToStaffDestination,
  signInStaff,
  loadOperationalStaffProfiles,
  signInOperationalStaff,
  type OperationalStaffProfile,
} from "../services/staffAuthService";
import type { StaffDestination } from "../types";
import "../styles/staffLogin.css";
import "../../auth-experience/styles/authExperience.css";
import { SocialLoginButton } from "../../auth-experience/components/AuthExperience";

// ─── chart bar heights for the mockup ────────────────────────────────────────
const chartBars = [30, 55, 40, 70, 50, 85, 60, 90, 45, 75, 65, 100];

// ─── Left panel — restaurant ops illustration ─────────────────────────────────
function LeftPanel() {
  return (
    <div className="sl-left">
      {/* brand */}
      <div className="sl-brand">
        <img className="sl-brand-icon" src="/serveflowlogo.png" alt="" />
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
    if (destination.dashboard === "manager") return "Manager Dashboard";
    if (destination.dashboard === "cashier") return "Cashier Dashboard";
    if (destination.dashboard === "inventory") return "Inventory Dashboard";
    return "Kitchen Dashboard";
  }

  return (
    <div className="sl-right">
      <div className="sl-card">
        <div className="sl-card-brand">
          <img className="sl-card-brand-icon" src="/serveflowlogo.png" alt="" />
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
                {dest.dashboard === "manager" ? "MG" : dest.dashboard === "cashier" ? "💳" : "🍳"}
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
  const [loginMode, setLoginMode] = useState<"terminal" | "owner">("owner");
  const [restaurantIdentity, setRestaurantIdentity] = useState(() => localStorage.getItem("serveflow.staff-terminal.restaurant") ?? "");
  const [operationalProfiles, setOperationalProfiles] = useState<OperationalStaffProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<OperationalStaffProfile | null>(null);
  const [terminalPin, setTerminalPin] = useState("");
  const [terminalLoading, setTerminalLoading] = useState(false);
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

  async function connectTerminal() {
    try {
      setTerminalLoading(true);
      setError(null);
      const profiles = await loadOperationalStaffProfiles(restaurantIdentity);
      localStorage.setItem("serveflow.staff-terminal.restaurant", restaurantIdentity.trim());
      setOperationalProfiles(profiles);
      if (!profiles.length) setError("No active operational staff were found for this restaurant.");
    } catch {
      setError("Restaurant terminal was not found. Check the restaurant code.");
    } finally {
      setTerminalLoading(false);
    }
  }

  async function submitOperationalPin() {
    if (!selectedProfile || terminalPin.length !== 4) return;
    try {
      setTerminalLoading(true);
      setError(null);
      const staffSession = await signInOperationalStaff(restaurantIdentity, selectedProfile.employeeId, terminalPin);
      const destination = getStaffDestinations(staffSession).find((item) => item.restaurant.role === selectedProfile.role);
      if (!destination) throw new Error("No matching staff workspace was found.");
      redirectToStaffDestination(destination);
    } catch {
      setError("Incorrect PIN. Please try again.");
      setTerminalPin("");
    } finally {
      setTerminalLoading(false);
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

  if (loginMode === "terminal") {
    return (
      <main className="st-terminal">
        <header className="st-terminal-header"><img src="/serveflowlogo.png" alt="ServeFlow" /><strong>Restaurant Staff Terminal</strong><button type="button" onClick={() => setLoginMode("owner")}>Owner or legacy sign in</button></header>
        <section className="st-terminal-content">
          {!operationalProfiles.length ? <>
            <div className="st-terminal-title"><span>Shared staff terminal</span><h1>Connect to your restaurant</h1><p>Enter the restaurant code once. This tablet will remember it.</p></div>
            {error && <div className="sl-error" role="alert">{error}</div>}
            <div className="st-connect"><input value={restaurantIdentity} onChange={(event) => setRestaurantIdentity(event.target.value)} placeholder="Restaurant code" aria-label="Restaurant code" /><button type="button" onClick={() => void connectTerminal()} disabled={terminalLoading || !restaurantIdentity.trim()}>{terminalLoading ? "Connecting…" : "Connect terminal"}</button></div>
          </> : !selectedProfile ? <>
            <div className="st-terminal-title"><span>Restaurant terminal</span><h1>Select your name</h1><p>Employee ID distinguishes staff members who share the same name.</p></div>
            {error && <div className="sl-error" role="alert">{error}</div>}
            <div className="st-profile-grid">{operationalProfiles.map((profile) => <button type="button" key={profile.staffId} onClick={() => { setSelectedProfile(profile); setError(null); }}><b>{profile.displayName.slice(0, 1).toUpperCase()}</b><strong>{profile.displayName}</strong><span>{profile.role} · {profile.employeeId}</span><small>{profile.shift || "Active"}</small></button>)}</div>
            <button className="st-change-restaurant" type="button" onClick={() => setOperationalProfiles([])}>Change restaurant</button>
          </> : <>
            <button className="st-back" type="button" onClick={() => { setSelectedProfile(null); setTerminalPin(""); setError(null); }}>← All staff</button>
            <div className="st-terminal-title"><span>{selectedProfile.employeeId}</span><h1>Welcome, {selectedProfile.displayName}</h1><p>Enter your 4-digit PIN</p></div>
            <div className="st-pin-dots">{[0,1,2,3].map((index) => <i key={index} className={terminalPin.length > index ? "filled" : ""} />)}</div>
            {error && <div className="st-pin-error" role="alert">{error}</div>}
            <div className="st-keypad">{[7,8,9,4,5,6,1,2,3].map((digit) => <button type="button" key={digit} onClick={() => setTerminalPin((pin) => `${pin}${digit}`.slice(0,4))}>{digit}</button>)}<button type="button" onClick={() => setTerminalPin((pin) => pin.slice(0,-1))}>⌫</button><button type="button" onClick={() => setTerminalPin((pin) => `${pin}0`.slice(0,4))}>0</button><button type="button" className="confirm" onClick={() => void submitOperationalPin()} disabled={terminalPin.length !== 4 || terminalLoading}>✓</button></div>
          </>}
        </section>
      </main>
    );
  }

  return (
    <div className="sl-root">
      <LeftPanel />

      <div className="sl-right">
        <div className="sl-card">
          {/* brand */}
          <div className="sl-card-brand">
            <img className="sl-card-brand-icon" src="/serveflowlogo.png" alt="" />
            <span className="sl-card-brand-name">ServeFlow</span>
          </div>

          <h1 className="sl-heading">Welcome back</h1>
          <p className="sl-subheading">Sign in to manage your hospitality business.</p>

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
              <span className="sl-divider-text">Or sign in with</span>
              <div className="sl-divider-line" />
            </div>

            <SocialLoginButton />

            <p className="sl-register-row">
              Don't have an account?{" "}
              <a href="/sign-up" className="sl-register-link">Create an account</a>
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
