import { AuthCard, AuthHeader, AuthShell } from "../../auth-experience/components/AuthExperience";

/** Intake remains closed until retention, approval and invitation delivery are authorized. */
export function OwnerSignupPage() {
  return <AuthShell message="Hospitality, thoughtfully connected." detail="ServeFlow access is reviewed before a new business is onboarded."><AuthCard>
    <AuthHeader eyebrow="ServeFlow access" title="New business applications are not open yet" description="The reviewed application and invitation process is being prepared. No account or trial is created from this page." />
    <p>Existing account holders can continue to sign in. You can contact ServeFlow with product questions without submitting registration details here.</p>
    <div className="auth-row"><a className="auth-button" href="/staff-login">Sign in</a></div>
    <p><a className="auth-link" href="/contact">Contact ServeFlow</a></p>
    <p><a className="auth-link" href="/">Return to the public website</a></p>
  </AuthCard></AuthShell>;
}
