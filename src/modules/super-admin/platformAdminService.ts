import { createBrowserUuid } from "../../core/browser/createBrowserUuid";
import { getPlatformAdminClient } from "./platformAdminClient";

export const adminSections = [
  ["overview", "Overview", "Platform Management"], ["applications", "Applications & Approvals", "Platform Management"],
  ["businesses", "Hospitality Businesses", "Platform Management"], ["users", "Users & Invitations", "Platform Management"],
  ["contracts", "Trials & Contracts", "Platform Management"], ["payments", "Payments & Renewals", "Platform Management"],
  ["notifications", "Notifications", "Platform Management"], ["system-health", "System Health", "Technical Operations"],
  ["diagnostics", "Errors & Diagnostics", "Technical Operations"], ["integrations", "Integrations", "Technical Operations"],
  ["backups", "Backups & Recovery", "Technical Operations"], ["audit-logs", "Audit Logs", "Security & Administration"],
  ["administrators", "Administrators & Access", "Security & Administration"], ["security", "Security & Recovery", "Security & Administration"],
] as const;
export type AdminSection = typeof adminSections[number][0];
export type AdminContext = { userId: string; displayName: string; recoveryVerified: boolean; mfaRequired: boolean; canManage: boolean; canSensitive: boolean };
export type AdminRow = Record<string, unknown> & { id: string; created_at: string };
export type AdminCursor = { at: string; id: string };
export type AdminResult = { items?: AdminRow[]; nextCursor?: AdminCursor | null; asOf: string; source: string; [key: string]: unknown };

export function isAdminSection(value: string): value is AdminSection { return adminSections.some(([key]) => key === value); }
export function metric(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : "Unavailable"; }
export function safeAdminError(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  if (code === "42501") return "Access denied. Verify your administrator authorization, recovery review and MFA. Sensitive actions require MFA from the last five minutes.";
  if (code === "40001" || code === "23505") return "This record changed or the request conflicts with an earlier decision. Refresh and review it again.";
  if (code === "22023" || code === "23514") return "The request contains invalid values. Check the fields and try again.";
  if (code === "P0002") return "The requested record is no longer available.";
  return "Platform service unavailable. The required migration or service may not be configured. No successful change is confirmed.";
}
export async function adminContext(): Promise<AdminContext> {
  const client = getPlatformAdminClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) throw new Error("Sign in with a privately provisioned administrator account.");
  const { data, error } = await client.rpc("get_platform_admin_context");
  if (error) throw error;
  if (!data || data.userId !== user.data.user.id || typeof data.recoveryVerified !== "boolean" || typeof data.mfaRequired !== "boolean") throw new Error("Invalid administrator context.");
  if (data.recoveryVerified && !data.mfaRequired) {
    const audit = await client.rpc("platform_admin_record_access", { request_id: createBrowserUuid() });
    if (audit.error) throw audit.error;
  }
  return data as AdminContext;
}
export async function readAdmin(section: AdminSection | "invitations", search = "", status = "", cursor: AdminCursor | null = null, from = "", through = ""): Promise<AdminResult> {
  const { data, error } = await getPlatformAdminClient().rpc("platform_admin_read", {
    section, search_text: search, status_filter: status, cursor_at: cursor?.at ?? null, cursor_id: cursor?.id ?? null,
    since_at: from ? new Date(`${from}T00:00:00Z`).toISOString() : null,
    before_at: through ? new Date(Date.parse(`${through}T00:00:00Z`) + 86400000).toISOString() : null,
  });
  if (error) throw error;
  if (!data || typeof data.asOf !== "string" || typeof data.source !== "string") throw new Error("Invalid platform response.");
  return data as AdminResult;
}
export async function adminMutation(name: "platform_admin_classify" | "platform_admin_decide_application" | "platform_admin_record_payment" | "platform_admin_reject_payment", values: Record<string, unknown>, requestId: string) {
  const { data, error } = await getPlatformAdminClient().rpc(name, { ...values, request_id: requestId });
  if (error) throw error;
  if (data?.ok !== true) throw new Error("No successful change confirmed.");
  return data;
}
export async function recordAdminDiagnostic(code: "ADMIN_READ_FAILED" | "ADMIN_ACTION_FAILED") {
  const { error } = await getPlatformAdminClient().rpc("platform_admin_record_diagnostic", {
    code, environment: import.meta.env.DEV ? "local" : "deployed", request_id: createBrowserUuid(),
  });
  return !error;
}
