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

export function OwnerSignupPage() {
  const [step, setStep] = useState<Step>("form");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [tableCount, setTableCount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // Step 1 — create auth account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: ownerName.trim() },
        },
      });

      if (authError) throw new Error(authError.message);
      if (!authData.user) throw new Error("Account could not be created. Please try again.");

      const userId = authData.user.id;

      // Step 2 — create restaurant
      const slug = toSlug(restaurantName);
      const tables = tableCount ? parseInt(tableCount, 10) : null;
      const { data: restaurantData, error: restaurantError } = await supabase
        .from("restaurants")
        .insert({ name: restaurantName.trim(), slug, ...(tables ? { table_count: tables } : {}) })
        .select("id")
        .single();

      if (restaurantError) throw new Error(restaurantError.message);

      const newRestaurantId = restaurantData.id as string;
      setRestaurantId(newRestaurantId);

      // Step 3 — add owner to restaurant_staff
      const { error: staffError } = await supabase.from("restaurant_staff").insert({
        restaurant_id: newRestaurantId,
        user_id: userId,
        role: "owner",
        display_name: ownerName.trim(),
        active: true,
      });

      if (staffError) throw new Error(staffError.message);

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
          <div className="sf-signup-success-icon">🎉</div>
          <h1>Welcome to ServeFlow!</h1>
          <p>
            Your restaurant <strong>{restaurantName}</strong> has been created.
            Check your email to confirm your account, then sign in to access your owner dashboard.
          </p>
          <a href="/staff-login" className="sf-signup-btn-primary">
            Sign In to Dashboard →
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
              onChange={(e) => setOwnerName(e.target.value)}
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
              onChange={(e) => setRestaurantName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              disabled={isSubmitting}
              autoComplete="organization"
            />
          </label>

          <label className="sf-signup-field">
            <span>Number of Tables <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}>(Optional)</span></span>
            <input
              type="number"
              placeholder="e.g. 20"
              value={tableCount}
              onChange={(e) => setTableCount(e.target.value)}
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
              onChange={(e) => setEmail(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
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
          Already have an account?{" "}
          <a href="/staff-login">Sign in</a>
        </p>
      </div>
    </main>
  );
}
