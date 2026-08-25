import React from "react";
import { createRoot } from "react-dom/client";
import { ManagerCopilot } from "../../../src/modules/manager/components/ManagerCopilot";
import { ManagerCopilotErrorBoundary } from "../../../src/modules/manager/components/ManagerCopilotErrorBoundary";
import { ManagerLayout } from "../../../src/modules/manager/components/ManagerLayout";
import {
  openManagerCopilotForUpdate,
  type ManagerLiveUpdate,
} from "../../../src/modules/manager/managerLiveUpdates";
import type {
  CopilotAnswer,
  ManagerCopilotSnapshot,
} from "../../../src/modules/manager/services/managerCopilotService";

const snapshot: ManagerCopilotSnapshot = {
  intelligence: null,
  staff: null,
  guests: null,
  kitchen: null,
  inventory: null,
  menu: null,
  unavailable: [],
};
const update: ManagerLiveUpdate = {
  id: "staff-update-safe-summary",
  kind: "actionable",
  title: "Staff activity changed",
  context: "staff",
  copilotPrompt: "What changed?",
};
const params = new URLSearchParams(window.location.search);
const delay = Number(params.get("delay") ?? 450);
const failFirst = params.get("failFirst") === "1";
const failAttempts = Number(params.get("failAttempts") ?? (failFirst ? 1 : 0));
const fullManagerShell = params.get("shell") === "1";
const fixedOverlayProbe = params.get("fixedOverlay") === "1";
const malformedAnswer = params.get("malformedAnswer") === "1";
const malformedStoredMessage = params.get("malformedStoredMessage") === "1";
const boundaryCrash = params.get("boundaryCrash") === "1";
const failInvestigatorFirst = params.get("failInvestigatorFirst") === "1";
let attempts = 0;
let investigatorAttempts = 0;

window.sessionStorage.removeItem("serveflow.manager-copilot:tenant-a");
if (malformedStoredMessage) {
  window.sessionStorage.setItem(
    "serveflow.manager-copilot:tenant-a",
    JSON.stringify([
      null,
      { id: "bad-manager", role: "manager", text: { unsafe: true } },
      { id: "safe-manager", role: "manager", text: "Recovered question" },
      { id: "bad-answer", role: "copilot", answer: { conclusion: null } },
    ]),
  );
}

async function snapshotLoader() {
  attempts += 1;
  await new Promise((resolve) => window.setTimeout(resolve, delay));
  if (attempts <= failAttempts) throw new Error("private transport detail");
  return snapshot;
}

function investigate(question: string): CopilotAnswer {
  investigatorAttempts += 1;
  if (failInvestigatorFirst && investigatorAttempts === 1) {
    throw new Error("private investigator detail");
  }
  if (malformedAnswer) {
    return {
      conclusion: null,
      evidence: { unexpected: true },
      sources: undefined,
    } as unknown as CopilotAnswer;
  }
  return {
    conclusion: `Authorized answer for: ${question}`,
    evidence: ["Current Manager evidence was reviewed."],
    sources: ["Staff"],
  };
}

function CrashProbe() {
  const [crash, setCrash] = React.useState(false);
  if (crash) throw new TypeError("render probe detail");
  return <button type="button" onClick={() => setCrash(true)}>Trigger Copilot render crash</button>;
}

function BoundaryHarness() {
  const [recoveryKey, setRecoveryKey] = React.useState(0);
  const recover = () => setRecoveryKey((current) => current + 1);
  return (
    <main className="ml-shell" data-testid="manager-shell">
      <div>Manager shell remains mounted</div>
      <ManagerCopilotErrorBoundary
        key={recoveryKey}
        onRetry={recover}
        onClose={recover}
      >
        <CrashProbe />
      </ManagerCopilotErrorBoundary>
    </main>
  );
}

function Harness() {
  if (boundaryCrash) return <BoundaryHarness />;
  if (fullManagerShell) {
    return (
      <ManagerLayout
        restaurantId="tenant-a"
        restaurantName="Test Restaurant"
        managerName="Sada Manager"
        section="staff"
      >
        <div>Manager staff workspace</div>
        {fixedOverlayProbe && (
          <div
            className="manager-fixed-overlay-probe"
            style={{
              position: "fixed",
              zIndex: 950,
              right: 0,
              bottom: 0,
              left: 0,
              height: 120,
              pointerEvents: "auto",
            }}
          />
        )}
      </ManagerLayout>
    );
  }
  return (
    <main className="ml-shell" data-testid="manager-shell">
      <button
        data-testid="live-update"
        type="button"
        onClick={() => openManagerCopilotForUpdate(update)}
      >
        Staff activity changed
      </button>
      <button
        data-testid="unhandled-rejection"
        type="button"
        onClick={() => {
          void Promise.reject(new Error("rejection probe detail"));
        }}
      >
        Trigger unhandled rejection
      </button>
      <ManagerCopilot
        restaurantId="tenant-a"
        restaurantName="Test Restaurant"
        managerName="Sada Manager"
        section="staff"
        snapshotLoader={snapshotLoader}
        questionInvestigator={investigate}
        realtimeEnabled={false}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
