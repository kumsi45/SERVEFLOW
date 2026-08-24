import React from "react";
import { createRoot } from "react-dom/client";
import { ManagerCopilot } from "../../../src/modules/manager/components/ManagerCopilot";
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
let attempts = 0;

window.sessionStorage.removeItem("serveflow.manager-copilot:tenant-a");

async function snapshotLoader() {
  attempts += 1;
  await new Promise((resolve) => window.setTimeout(resolve, delay));
  if (failFirst && attempts === 1) throw new Error("private transport detail");
  return snapshot;
}

function investigate(question: string): CopilotAnswer {
  return {
    conclusion: `Authorized answer for: ${question}`,
    evidence: ["Current Manager evidence was reviewed."],
    sources: ["Staff"],
  };
}

function Harness() {
  return (
    <main>
      <button
        data-testid="live-update"
        type="button"
        onClick={() => openManagerCopilotForUpdate(update)}
      >
        Staff activity changed
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
