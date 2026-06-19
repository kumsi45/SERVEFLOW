import { FormEvent, useState } from "react";
import { redirectToStaffDestination, signInStaff } from "../services/staffAuthService";

export function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setError(null);
      const staffSession = await signInStaff(email.trim(), password);
      redirectToStaffDestination(staffSession);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="staff-login-page">
      <form className="staff-login-panel" onSubmit={handleSubmit}>
        <div>
          <p className="staff-login-eyebrow">ServeFlow Staff</p>
          <h1>Staff Login</h1>
        </div>

        {error ? <p className="staff-login-error">{error}</p> : null}

        <label className="staff-login-field">
          <span>Email</span>
          <input
            autoComplete="email"
            disabled={isSubmitting}
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label className="staff-login-field">
          <span>Password</span>
          <input
            autoComplete="current-password"
            disabled={isSubmitting}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
