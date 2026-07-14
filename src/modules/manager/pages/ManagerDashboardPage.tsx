import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import "../styles/managerDashboard.css";

type Props = {
  restaurantName: string;
  managerName: string;
};

export function ManagerDashboardPage({ restaurantName, managerName }: Props) {
  async function logout() {
    await signOutStaff();
    window.location.replace("/staff-login");
  }

  return (
    <main className="md-page">
      <header className="md-header">
        <div>
          <small>ServeFlow Manager</small>
          <strong>{restaurantName}</strong>
        </div>
        <button type="button" onClick={() => void logout()}>Logout</button>
      </header>
      <section className="md-welcome">
        <span>Manager Dashboard</span>
        <h1>Welcome, {managerName}</h1>
        <p>Your manager account is active. Operational manager modules will be added here without exposing Owner settings, billing, subscriptions, tenant configuration, or Owner AI reports.</p>
      </section>
    </main>
  );
}
