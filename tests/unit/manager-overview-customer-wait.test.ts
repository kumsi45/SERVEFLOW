import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { customerWaitingAlertLabel } from "../../src/modules/manager/services/managerDashboardService";

const service = readFileSync(
  resolve(process.cwd(), "src/modules/manager/services/managerDashboardService.ts"),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "src/modules/manager/pages/ManagerDashboardPage.tsx"),
  "utf8",
);

describe("Manager Overview customer waiting alert", () => {
  it("uses operational 30-minute and one-hour labels", () => {
    expect(customerWaitingAlertLabel(30)).toBe("Waiting more than 30 minutes");
    expect(customerWaitingAlertLabel(59)).toBe("Waiting more than 30 minutes");
    expect(customerWaitingAlertLabel(60)).toBe("Waiting more than 1 hour");
    expect(customerWaitingAlertLabel(125)).toBe("Waiting more than 1 hour");
  });

  it("derives the alert from the live dining-session age at a 30-minute threshold", () => {
    expect(service).toContain("waitingMinutes: 30");
    expect(service).toContain("const customerWaitingMinutes = sessionMinutes ?? createdMinutes");
    expect(service).toContain("customerWaitingMinutes >= ALERT_THRESHOLDS.waitingMinutes");
    expect(service).not.toContain("Waiting more than X minutes");
  });

  it("refreshes visible Overview timing every minute in addition to realtime events", () => {
    expect(page).toContain("window.setInterval");
    expect(page).toContain("document.visibilityState === \"visible\"");
    expect(page).toContain("60_000");
    expect(page).toContain("window.clearInterval(timer)");
  });
});
