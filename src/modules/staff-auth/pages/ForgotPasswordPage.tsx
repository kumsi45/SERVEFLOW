import { FormEvent, useState } from "react";
import { getPasswordResetRedirectUrl } from "../../../core/config/appUrl";
import { supabase } from "../../../core/database";
import "../styles/staffLogin.css";

type PageState = "form" | "sent";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<PageState>("form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: getPasswordResetRedirectUrl(),
        }
      );

      if (resetError) {
        throw new Error(resetError.message);
      }

      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sl-root">
      {/* ── left panel ── */}
      <div className="sl-left">
        <div className="sl-brand">
          <img className="sl-brand-icon" src="/serveflowlogo.png" alt="" />
          <span className="sl-brand-name">ServeFlow</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
            Restaurant Operations<br />
            <span style={{ color: "#0f766e" }}>Simplified.</span>
          </div>
          <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.65 }}>
            Manage your orders, kitchen, and cashier from one powerful platform.
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
            <img className="sl-card-brand-icon" src="/serveflowlogo.png" alt="" />
            <span className="sl-card-brand-name">ServeFlow</span>
          </div>

          {state === "sent" ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
              <h1 className="sl-heading">Check your email</h1>
              <p className="sl-subheading">
                We sent a password reset link to <strong>{email}</strong>.<br />
                Click the link in the email to set a new password.
              </p>
              <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 16 }}>
                Didn't receive it? Check your spam folder or{" "}
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "#0f766e", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
                  onClick={() => setState("form")}
                >
                  try again
                </button>.
              </p>
              <a href="/staff-login" style={{ display: "inline-block", marginTop: 24, color: "#0f766e", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
                ← Back to Sign In
              </a>
            </div>
          ) : (
            <>
              <h1 className="sl-heading">Forgot password?</h1>
              <p className="sl-subheading">
                Enter your work email and we'll send you a link to reset your password.
              </p>

              {error && (
                <div className="sl-error" role="alert">
                  <span>⚠️</span> {error}
                </div>
              )}

              <form className="sl-form" onSubmit={handleSubmit} noValidate>
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
                    autoFocus
                  />
                </div>

                <button type="submit" className="sl-submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? <><div className="sl-submit-spinner" />Sending...</>
                    : <>SEND RESET LINK →</>
                  }
                </button>

                <a
                  href="/staff-login"
                  style={{ textAlign: "center", display: "block", fontSize: 14, color: "#0f766e", fontWeight: 600, textDecoration: "none", marginTop: 4 }}
                >
                  ← Back to Sign In
                </a>
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
