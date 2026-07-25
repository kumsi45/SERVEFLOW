import { supabase } from "../../../core/database";
import type { InventoryIntegrityCheckResult } from "../types";

type Row = Record<string, unknown>;

export function mapInventoryIntegrityCheckRow(row: Row): InventoryIntegrityCheckResult {
  const rawDetails = row.details && typeof row.details === "object"
    ? row.details as Record<string, unknown>
    : {};
  const samples = Array.isArray(rawDetails.samples)
    ? rawDetails.samples.filter((sample): sample is { entity_id: string; detail: Record<string, unknown> } =>
      Boolean(sample) && typeof sample === "object" && typeof (sample as Row).entity_id === "string")
    : [];
  return {
    checkCode: typeof row.check_code === "string" ? row.check_code : "UNKNOWN_CHECK",
    checkName: typeof row.check_name === "string" ? row.check_name : "Inventory integrity check",
    checkStatus: row.check_status === "DETECTED_ISSUES" ? "DETECTED_ISSUES" : "PASS",
    issueCount: Number.isFinite(Number(row.issue_count)) ? Number(row.issue_count) : 0,
    details: { samples },
  };
}

export async function runInventoryIntegrityCheck(
  restaurantId: string,
): Promise<InventoryIntegrityCheckResult[]> {
  const { data, error } = await supabase.rpc("run_inventory_integrity_check", {
    target_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message || "Inventory integrity check failed.");
  return ((data ?? []) as Row[]).map(mapInventoryIntegrityCheckRow);
}
