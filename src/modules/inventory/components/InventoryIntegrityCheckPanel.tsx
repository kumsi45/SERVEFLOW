import { useState } from "react";
import type { InventoryIntegrityCheckResult } from "../types";
import { runInventoryIntegrityCheck } from "../services/inventoryIntegrityService";

type Props = { restaurantId: string };

export function InventoryIntegrityCheckPanel({ restaurantId }: Props) {
  const [results, setResults] = useState<InventoryIntegrityCheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issueCount = results?.reduce((total, result) => total + result.issueCount, 0) ?? 0;
  const passed = results !== null && issueCount === 0;

  async function runCheck() {
    try {
      setRunning(true);
      setError(null);
      const next = await runInventoryIntegrityCheck(restaurantId);
      setResults(next);
      setCheckedAt(new Date().toISOString());
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Inventory integrity check failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="ia-integrity-panel" aria-labelledby="inventory-integrity-title">
      <div className="ia-section-title">
        <div>
          <span>Owner Admin Tool</span>
          <h2 id="inventory-integrity-title">Inventory Integrity Check</h2>
        </div>
        {results && <span className={`ia-integrity-summary ${passed ? "pass" : "issues"}`}>
          {passed ? "PASS" : "Detected Issues"}
        </span>}
      </div>
      <p>Runs tenant-scoped, read-only diagnostics. It never changes or repairs inventory data.</p>
      <button type="button" onClick={() => void runCheck()} disabled={running}>
        {running ? "Checking Inventory..." : "Run Inventory Integrity Check"}
      </button>
      {error && <div className="ia-alert error">{error}</div>}
      {checkedAt && <small>Last checked {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkedAt))}</small>}
      {results && (
        <div className="ia-integrity-results">
          {results.map((result) => (
            <article key={result.checkCode} className={result.checkStatus === "PASS" ? "pass" : "issues"}>
              <div>
                <strong>{result.checkName}</strong>
                <span>{result.checkStatus === "PASS" ? "PASS" : `${result.issueCount} detected ${result.issueCount === 1 ? "issue" : "issues"}`}</span>
              </div>
              {result.details.samples.length > 0 && (
                <details>
                  <summary>View diagnostic samples</summary>
                  <ul>{result.details.samples.map((sample) => <li key={sample.entity_id}>{sample.entity_id}</li>)}</ul>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
