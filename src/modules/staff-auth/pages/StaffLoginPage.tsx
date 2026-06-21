import { FormEvent, useState } from "react";
import {
  getStaffDestinations,
  redirectToStaffDestination,
  signInStaff,
} from "../services/staffAuthService";
import type { StaffDestination } from "../types";

function formatDashboardName(destination: StaffDestination) {
  return destination.dashboard === "cashier" ? "Cashier" : "Kitchen";
}

export function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <main className="staff-login-page">
        <section className="staff-login-panel">
          <div>
            <p className="staff-login-eyebrow">ServeFlow Staff</p>
            <h1>Select Dashboard</h1>
          </div>

          {destinations.map((destination) => (
            <button
              key={`${destination.dashboard}:${destination.restaurant.id}`}
              type="button"
              onClick={() => redirectToStaffDestination(destination)}
            >
              {formatDashboardName(destination)} - {destination.restaurant.name}
            </button>
          ))}
        </section>
      </main>
    );
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
