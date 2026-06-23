import { FormEvent, useState } from "react";
import { supabase } from "../../../core/database";
import "../styles/ownerSignup.css";

type Step = "form" | "success";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getFunctionErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function OwnerSignupPage() {
  const [step, setStep] = useState<Step>("form");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [tableCount, setTableCount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setIsSubmitting(true);

    try {
      const trimmedOwnerName = ownerName.trim();
      const trimmedRestaurantName = restaurantName.trim();
      const trimmedEmail = email.trim().toLowerCase();
      const slug = toSlug(trimmedRestaurantName);
      const trimmedTableCount = tableCount.trim();
      const parsedTables = trimmedTableCount ? Number(trimmedTableCount) : null;
      if (parsedTables !== null && (!Number.isInteger(parsedTables) || parsedTables < 1 || parsedTables > 500)) {
        throw new Error("Table count must be a whole number from 1 to 500.");
      }
      const tables = parsedTables;

      const { data, error: signupError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("owner-signup", {
        body: {
          ownerName: trimmedOwnerName,
          email: trimmedEmail,
          password,
          restaurantName: trimmedRestaurantName,
          restaurantSlug: slug,
          tableCount: tables,
        },
      });

      if (signupError) throw new Error((await getFunctionErrorMessage(signupError)) || signupError.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.ok) throw new Error("Account could not be created. Please try again.");

      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === "success") {
    return (
      <main className="sf-signup-page">
        <div className="sf-signup-card sf-signup-success">
          <div className="sf-signup-success-icon">OK</div>
          <h1>Welcome to ServeFlow!</h1>
          <p>
            Your restaurant <strong>{restaurantName}</strong> has been created.
            Sign in with your email and password to access your owner dashboard.
          </p>
          <a href="/staff-login" className="sf-signup-btn-primary">
            Sign In to Dashboard
          </a>
          <p className="sf-signup-note">
            After signing in, you can create cashier and kitchen staff accounts from your dashboard.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="sf-signup-page">
      <div className="sf-signup-card">
        <a href="/" className="sf-signup-logo" aria-label="ServeFlow home">
          <div className="sf-signup-logo-icon">S</div>
          <span>ServeFlow</span>
        </a>

        <h1>Create your restaurant</h1>
        <p className="sf-signup-sub">
          Sign up as an owner. You'll set up your restaurant and add staff after registration.
        </p>

        {error && <div className="sf-signup-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="sf-signup-form" noValidate>
          <label className="sf-signup-field">
            <span>Your Name</span>
            <input
              type="text"
              placeholder="Abdulhayi Alo"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              required
              minLength={2}
              maxLength={60}
              disabled={isSubmitting}
              autoComplete="name"
            />
          </label>

          <label className="sf-signup-field">
            <span>Restaurant Name</span>
            <input
              type="text"
              placeholder="Habesha Restaurant"
              value={restaurantName}
              onChange={(event) => setRestaurantName(event.target.value)}
              required
              minLength={2}
              maxLength={80}
              disabled={isSubmitting}
              autoComplete="organization"
            />
          </label>

          <label className="sf-signup-field">
            <span>
              Number of Tables <span className="sf-signup-optional">(Optional)</span>
            </span>
            <input
              type="number"
              placeholder="e.g. 20"
              value={tableCount}
              onChange={(event) => setTableCount(event.target.value)}
              min={1}
              max={500}
              disabled={isSubmitting}
            />
          </label>

          <label className="sf-signup-field">
            <span>Email Address</span>
            <input
              type="email"
              placeholder="owner@restaurant.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={isSubmitting}
              autoComplete="email"
              inputMode="email"
            />
          </label>

          <label className="sf-signup-field">
            <span>Password</span>
            <input
              type="password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
          </label>

          <button type="submit" className="sf-signup-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating account..." : "Create Restaurant Account"}
          </button>
        </form>

        <p className="sf-signup-login-link">
          Already have an account? <a href="/staff-login">Sign in</a>
        </p>
      </div>
    </main>
  );
}
