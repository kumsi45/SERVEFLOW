import { FormEvent, useState } from "react";
import { getPasswordResetRedirectUrl } from "../../../core/config/appUrl";
import { supabase } from "../../../core/database";
import { AuthButton, AuthCard, AuthFooter, AuthHeader, AuthInput, AuthShell, ErrorCard, SuccessCard } from "../../auth-experience/components/AuthExperience";

type PageState = "form" | "sent";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<PageState>("form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setIsSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: getPasswordResetRedirectUrl() });
      if (resetError) throw new Error(resetError.message);
      setState("sent");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send reset email."); }
    finally { setIsSubmitting(false); }
  }

  return <AuthShell message="A quick reset. Then back to service." detail="Secure account recovery keeps your restaurant workspace protected without slowing down your day."><AuthCard>
    {state === "sent" ? <SuccessCard title="Check your email" action={<><button className="auth-button" type="button" onClick={() => setState("form")}>Use another email</button><AuthFooter><p><a className="auth-link" href="/staff-login">Back to sign in</a></p></AuthFooter></>}>
      We sent a secure password reset link to <strong>{email}</strong>. Open it to choose a new password.
    </SuccessCard> : <>
      <AuthHeader eyebrow="Account recovery" title="Forgot your password?" description="Enter your work email and we’ll send you a secure reset link." />
      {error && <ErrorCard>{error}</ErrorCard>}
      <form onSubmit={handleSubmit} noValidate>
        <AuthInput label="Email address" icon="@" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@business.com" required disabled={isSubmitting} autoComplete="email" inputMode="email" autoFocus />
        <AuthButton type="submit" disabled={isSubmitting || !email.trim()}>{isSubmitting ? "Sending link…" : "Send reset link"}</AuthButton>
      </form>
      <AuthFooter><p>Remembered it? <a className="auth-link" href="/staff-login">Back to sign in</a></p></AuthFooter>
    </>}
  </AuthCard></AuthShell>;
}
