import { FormEvent, useState } from "react";
import { supabase } from "../../../core/database";
import { AuthButton, AuthCard, AuthDivider, AuthFooter, AuthHeader, AuthInput, AuthShell, ErrorCard, PasswordStrength, SocialLoginButton, SuccessCard } from "../../auth-experience/components/AuthExperience";

type Step = 1 | 2 | 3;
function toSlug(name: string) { return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
async function getFunctionErrorMessage(error: unknown) { if (!error || typeof error !== "object") return null; const context = (error as { context?: unknown }).context; if (context instanceof Response) { try { const body = await context.clone().json() as { error?: unknown }; return typeof body.error === "string" && body.error.trim() ? body.error : null; } catch { return null; } } return null; }

export function OwnerSignupPage() {
  const [step, setStep] = useState<Step>(1);
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function continueToAccount(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(null); if (ownerName.trim().length < 2 || restaurantName.trim().length < 2) { setError("Please enter your name and business name."); return; } setStep(2); }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setIsSubmitting(true);
    try {
      const trimmedOwnerName = ownerName.trim(); const trimmedRestaurantName = restaurantName.trim(); const trimmedEmail = email.trim().toLowerCase();
      const { data, error: signupError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("owner-signup", { body: { ownerName: trimmedOwnerName, email: trimmedEmail, password, restaurantName: trimmedRestaurantName, restaurantSlug: toSlug(trimmedRestaurantName), tableCount: null } });
      if (signupError) throw new Error((await getFunctionErrorMessage(signupError)) || signupError.message);
      if (data?.error) throw new Error(data.error); if (!data?.ok) throw new Error("Account could not be created. Please try again."); setStep(3);
    } catch (err) { setError(err instanceof Error ? err.message : "Registration failed. Please try again."); }
    finally { setIsSubmitting(false); }
  }

  return <AuthShell message="Your business, ready to flow." detail="Create a secure owner account, then personalize your menu and operations in the guided ServeFlow setup."><AuthCard>
    {step === 3 ? <SuccessCard title="Your workspace is ready" action={<a className="auth-button" href="/staff-login">Sign in & launch setup</a>}>
      <strong>{restaurantName}</strong> is ready. Sign in to continue to your guided setup wizard.
    </SuccessCard> : <>
      <div className="auth-stepper" aria-label={`Step ${step} of 3`}><span className="active" /><span className={step >= 2 ? "active" : ""} /><span /></div>
      <AuthHeader eyebrow={`Step ${step} of 3`} title={step === 1 ? "Tell us about your business" : "Create your secure login"} description={step === 1 ? "Just the essentials. Business details like type and phone are completed in the setup wizard." : <>You’re creating the owner account for <strong>{restaurantName}</strong>.</>} />
      {error && <ErrorCard>{error}</ErrorCard>}
      {step === 1 ? <form onSubmit={continueToAccount} noValidate>
        <AuthInput label="Business name" icon="⌂" value={restaurantName} onChange={event => setRestaurantName(event.target.value)} placeholder="Your business name" minLength={2} maxLength={100} required autoComplete="organization" autoFocus />
        <AuthInput label="Your name" icon="○" value={ownerName} onChange={event => setOwnerName(event.target.value)} placeholder="Owner or manager name" minLength={2} maxLength={80} required autoComplete="name" />
        <p className="auth-note">Business type, phone and menu details come next in ServeFlow Setup.</p>
        <AuthButton type="submit">Continue</AuthButton>
      </form> : <form onSubmit={handleSubmit} noValidate>
        <AuthInput label="Work email" icon="@" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@business.com" required disabled={isSubmitting} autoComplete="email" inputMode="email" autoFocus />
        <AuthInput label="Password" icon="•" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} maxLength={128} required disabled={isSubmitting} autoComplete="new-password" action={<button type="button" className="auth-inline-action" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>} />
        {password && <PasswordStrength password={password} />}
        <div className="auth-row"><button type="button" className="auth-link" style={{border:0,background:"none",padding:0,cursor:"pointer"}} onClick={() => { setStep(1); setError(null); }}>Back</button><span>Your account is secured by Supabase</span></div>
        <AuthButton type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating workspace…" : "Create my workspace"}</AuthButton>
      </form>}
      {step === 2 && <><AuthDivider>Or sign up with</AuthDivider><SocialLoginButton /></>}
      <AuthFooter><p>Already have an account? <a className="auth-link" href="/staff-login">Sign in</a></p></AuthFooter>
    </>}
  </AuthCard></AuthShell>;
}
