import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import "../styles/staffLogin.css";

type PageState = "loading" | "form" | "success" | "invalid" | "expired";

function getRecoveryParams() {
  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    accessToken: hashParams.get("access_token") || queryParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token") || queryParams.get("refresh_token"),
    tokenHash: hashParams.get("token_hash") || queryParams.get("token_hash"),
    code: hashParams.get("code") || queryParams.get("code"),
    type: hashParams.get("type") || queryParams.get("type"),
    error: hashParams.get("error") || queryParams.get("error"),
    errorDescription: hashParams.get("error_description") || queryParams.get("error_description"),
  };
}

function hasRecoveryHint() {
  const rawUrl = `${window.location.search}${window.location.hash}`.toLowerCase();
  return rawUrl.includes("type=recovery") || rawUrl.includes("access_token=") || rawUrl.includes("token_hash=") || rawUrl.includes("code=");
}

function getTokenErrorState(message: string | null): Extract<PageState, "expired" | "invalid"> {
  return message && /expir|stale|timeout/i.test(message) ? "expired" : "invalid";
}

function clearRecoveryUrl() {
  window.history.replaceState({}, document.title, "/reset-password");
}

function showSuccessToast() {
  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.textContent = "Password updated. Redirecting to sign in...";
  toast.style.position = "fixed";
  toast.style.right = "18px";
  toast.style.bottom = "18px";
  toast.style.zIndex = "9999";
  toast.style.padding = "12px 16px";
  toast.style.borderRadius = "10px";
  toast.style.background = "#0f766e";
  toast.style.color = "#fff";
  toast.style.fontSize = "14px";
  toast.style.fontWeight = "700";
  toast.style.boxShadow = "0 16px 36px rgba(15, 23, 42, 0.18)";
  document.body.appendChild(toast);

  window.setTimeout(() => toast.remove(), 2400);
}

export function ResetPasswordPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setPageState("form");
      }
    });

    async function createRecoverySession() {
      const params = getRecoveryParams();

      if (params.error) {
        if (mounted) {
          setPageState(getTokenErrorState(params.errorDescription || params.error));
        }
        return;
      }

      try {
        if (params.accessToken && params.refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });

          if (sessionError) {
            throw sessionError;
          }

          clearRecoveryUrl();
          if (mounted) setPageState("form");
          return;
        }

        if (params.tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: params.tokenHash,
            type: "recovery",
          });

          if (verifyError) {
            throw verifyError;
          }

          clearRecoveryUrl();
          if (mounted) setPageState("form");
          return;
        }

        if (params.code) {
          const { error: codeError } = await supabase.auth.exchangeCodeForSession(params.code);

          if (codeError) {
            throw codeError;
          }

          clearRecoveryUrl();
          if (mounted) setPageState("form");
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (mounted && data.session && (params.type === "recovery" || hasRecoveryHint())) {
          clearRecoveryUrl();
          setPageState("form");
          return;
        }

        if (mounted) {
          setPageState("invalid");
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : "Invalid password reset link.";
          setError(message);
          setPageState(getTokenErrorState(message));
        }
      }
    }

    void createRecoverySession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (pageState !== "success") {
      return undefined;
    }

    showSuccessToast();
    const timer = window.setTimeout(() => {
      window.location.assign("/staff-login");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [pageState]);

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
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        setPageState("expired");
        throw new Error("Your password reset link has expired. Please request a new one.");
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        throw new Error(updateError.message);
      }

      await supabase.auth.signOut({ scope: "local" });
      setPageState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password could not be updated.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sl-root">
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
            Secure your account with a strong password to protect your restaurant data.
          </p>
        </div>
        <div className="sl-features">
          {["Real-Time Orders", "Kitchen Display System", "Cashier Management", "QR Ordering"].map((feature) => (
            <div key={feature} className="sl-feature">
              <div className="sl-feature-check">OK</div>
              <span className="sl-feature-text">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sl-right">
        <div className="sl-card">
          <div className="sl-card-brand">
            <img className="sl-card-brand-icon" src="/serveflowlogo.png" alt="" />
            <span className="sl-card-brand-name">ServeFlow</span>
          </div>

          {pageState === "loading" && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ width: 40, height: 40, border: "3px solid #e2e8f0", borderTopColor: "#14b8a6", borderRadius: "50%", animation: "sl-spin 0.7s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ color: "#64748b", fontSize: 14 }}>Verifying your reset link...</p>
            </div>
          )}

          {(pageState === "invalid" || pageState === "expired") && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
              <h1 className="sl-heading">{pageState === "expired" ? "Link expired" : "Invalid link"}</h1>
              <p className="sl-subheading">
                {pageState === "expired"
                  ? "This password reset link has expired."
                  : "This password reset link is invalid."}<br />
                Please request a new password reset link.
              </p>
              {error && (
                <div className="sl-error" role="alert" style={{ textAlign: "left", marginTop: 16 }}>
                  <span>!</span> {error}
                </div>
              )}
              <a
                href="/forgot-password"
                style={{ display: "inline-block", marginTop: 24, padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg,#0f766e,#14b8a6)", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
              >
                Request New Link
              </a>
            </div>
          )}

          {pageState === "success" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>OK</div>
              <h1 className="sl-heading">Password updated</h1>
              <p className="sl-subheading">
                Your password has been changed.<br />
                Redirecting you to sign in.
              </p>
              <a
                href="/staff-login"
                style={{ display: "inline-block", marginTop: 24, padding: "14px 32px", borderRadius: 12, background: "linear-gradient(135deg,#0f766e,#14b8a6)", color: "#fff", fontWeight: 700, fontSize: 15, textDecoration: "none" }}
              >
                Sign In
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
                  <span>!</span> {error}
                </div>
              )}

              <form className="sl-form" onSubmit={handleSubmit} noValidate>
                <div className="sl-input-wrap">
                  <span className="sl-input-icon" aria-hidden="true">#</span>
                  <input
                    className="sl-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="New password (min. 8 characters)"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
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
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <div className="sl-input-wrap">
                  <span className="sl-input-icon" aria-hidden="true">#</span>
                  <input
                    className="sl-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    aria-label="Confirm new password"
                  />
                </div>

                {password.length > 0 && (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {[1, 2, 3, 4].map((level) => (
                      <div key={level} style={{ flex: 1, height: 4, borderRadius: 2, background: password.length >= level * 3 ? (password.length >= 10 ? "#16a34a" : password.length >= 7 ? "#f59e0b" : "#dc2626") : "#e2e8f0" }} />
                    ))}
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6, whiteSpace: "nowrap" }}>
                      {password.length < 8 ? "Too short" : password.length < 10 ? "Fair" : password.length < 13 ? "Good" : "Strong"}
                    </span>
                  </div>
                )}

                <button type="submit" className="sl-submit" disabled={isSubmitting}>
                  {isSubmitting ? <><div className="sl-submit-spinner" />Updating...</> : <>UPDATE PASSWORD</>}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="sl-security">
          <span aria-hidden="true">#</span>
          Protected by enterprise-grade security
        </div>
      </div>
    </div>
  );
}
