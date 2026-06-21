import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import "../styles/staffLogin.css";

type PageState = "loading" | "form" | "success" | "invalid";

export function ResetPasswordPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supabase sends the recovery token via URL hash (#access_token=...&type=recovery)
  // onAuthStateChange fires with PASSWORD_RECOVERY event when the token is valid
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setPageState("form");
      } else if (event === "SIGNED_IN" && pageState === "loading") {
        // Token already exchanged — still allow password change
        setPageState("form");
      }
    });

    // Fallback: if no auth event fires within 3s, the link is invalid/expired
    const timer = setTimeout(() => {
      setPageState((current) => current === "loading" ? "invalid" : current);
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        throw new Error(updateError.message);
      }

      // Sign out so user logs in fresh with new password
      await supabase.auth.signOut();
      setPageState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password could not be updated.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sl-root">
      {/* ── left panel ── */}
      <div className="sl-left">
        <div className="sl-brand">
          <div className="sl-brand-icon">S</div>
          <span className="sl-brand-name">ServeFlow</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
            Restaurant Operations<br />
            <span style={{ color: "#0f766e" }}>Simplified.</span>
          </div>
          <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.65 }}>
            Secure your account with a strong password to protect your restaurant data.
          </p>
        </div>
        <div className="sl-features">
          {["Real-Time Orders","Kitchen Display System","Cashier Management","QR Ordering"].map((f) => (
            <div key={f} className="sl-feature">
              <div className="sl-feature-check">✓</div>
              <span className="sl-feature-text">{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── right panel ── */}
      <div className="sl-right">
        <div className="sl-card">
          <div className="sl-card-brand">
            <div className="sl-card-brand-icon">S</div>
            <span className="sl-card-brand-name">ServeFlow</span>
          </div>

          {pageState === "loading" && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ width: 40, height: 40, border: "3px solid #e2e8f0", borderTopColor: "#14b8a6", borderRadius: "50%", animation: "sl-spin 0.7s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ color: "#64748b", fontSize: 14 }}>Verifying your reset link...</p>
            </div>
          )}

          {pageState === "invalid" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
              <h1 className="sl-heading">Link expired</h1>
              <p className="sl-subheading">
                This password reset link has expired or is invalid.<br />
                Please request a new one.
              </p>
              <a
                href="/forgot-password"
                style={{ display: "inline-block", marginTop: 24, padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg,#0f766e,#14b8a6)", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
              >
                Request New Link →
              </a>
            </div>
          )}

          {pageState === "success" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h1 className="sl-heading">Password updated!</h1>
              <p className="sl-subheading">
                Your password has been successfully changed.<br />
                You can now sign in with your new password.
              </p>
              <a
                href="/staff-login"
                style={{ display: "inline-block", marginTop: 24, padding: "14px 32px", borderRadius: 12, background: "linear-gradient(135deg,#0f766e,#14b8a6)", color: "#fff", fontWeight: 700, fontSize: 15, textDecoration: "none" }}
              >
                Sign In →
              </a>
            </div>
          )}

          {pageState === "form" && (
            <>
              <h1 className="sl-heading">Set new password</h1>
              <p className="sl-subheading">
                Choose a strong password for your ServeFlow account.
              </p>

              {error && (
                <div className="sl-error" role="alert">
                  <span>⚠️</span> {error}
                </div>
              )}

              <form className="sl-form" onSubmit={handleSubmit} noValidate>
                <div className="sl-input-wrap">
                  <span className="sl-input-icon" aria-hidden="true">🔒</span>
                  <input
                    className="sl-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="New password (min. 8 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    aria-label="New password"
                    autoFocus
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

                <div className="sl-input-wrap">
                  <span className="sl-input-icon" aria-hidden="true">🔒</span>
                  <input
                    className="sl-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    aria-label="Confirm new password"
                  />
                </div>

                {/* password strength hint */}
                {password.length > 0 && (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {[1,2,3,4].map((i) => (
                      <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: password.length >= i * 3 ? (password.length >= 10 ? "#16a34a" : password.length >= 7 ? "#f59e0b" : "#dc2626") : "#e2e8f0" }} />
                    ))}
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6, whiteSpace: "nowrap" }}>
                      {password.length < 8 ? "Too short" : password.length < 10 ? "Fair" : password.length < 13 ? "Good" : "Strong"}
                    </span>
                  </div>
                )}

                <button type="submit" className="sl-submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? <><div className="sl-submit-spinner" />Updating...</>
                    : <>UPDATE PASSWORD →</>
                  }
                </button>
              </form>
            </>
          )}
        </div>

        <div className="sl-security">
          <span>🔒</span>
          Protected by enterprise-grade security
        </div>
      </div>
    </div>
  );
}
