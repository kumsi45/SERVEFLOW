import type { AdminCursor, AdminResult, AdminRow, AdminSection } from "./platformAdminService";
import { PlatformAdminPage, type PlatformAdminPreviewConfig } from "./PlatformAdminPage";

const asOf = "2026-01-15T09:30:00.000Z";
const source = "Synthetic preview fixture — not platform data";
const syntheticId = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const row = (suffix: string, values: Record<string, unknown>): AdminRow => ({ id: syntheticId(suffix), created_at: asOf, ...values });

const rows: Partial<Record<AdminSection | "invitations", AdminRow[]>> = {
  applications: [row("101", { business_name: "Synthetic Riverside Café", business_type: "Café", contact_name: "Preview Applicant", contact_email: "applicant@example.invalid", status: "pending", decision_reason: null })],
  businesses: [
    row("201", { name: "Synthetic Sunrise Bistro", slug: "synthetic-sunrise", classification: "demo", owners: [{ name: "Preview Owner" }], entitlement: "Unavailable in preview", version: 3 }),
    row("202", { name: "Synthetic Empty Plate", slug: "synthetic-empty", classification: "unclassified", owners: [], entitlement: null, version: 1 }),
  ],
  users: [row("301", { display_name: "Synthetic Team Member", business_name: "Synthetic Sunrise Bistro", role: "manager", active: true })],
  invitations: [row("302", { business_name: "Synthetic Sunrise Bistro", application_id: syntheticId("101"), delivery_status: "disabled-preview" })],
  contracts: [row("401", { business_name: "Synthetic Sunrise Bistro", kind: "annual-preview", starts_at: "2026-01-01T00:00:00.000Z", ends_at: "2027-01-01T00:00:00.000Z" })],
  payments: [row("501", { business_name: "Synthetic Sunrise Bistro", amount: "1250.00", currency: "ETB", channel: "preview-channel", reference: "SYNTHETIC-REFERENCE", paid_at: "2026-01-14T08:00:00.000Z", status: "pending", reason: "Synthetic review fixture" })],
  notifications: [row("601", { contract_id: syntheticId("401"), milestone: 30, due_at: "2026-12-02T00:00:00.000Z", status: "delivery-disabled-preview" })],
  diagnostics: [row("701", { code: "SYNTHETIC_PREVIEW_ERROR", source: "preview-ui", environment: "local-preview", request_id: syntheticId("702") })],
  "audit-logs": [row("801", { actor_id: syntheticId("901"), action: "synthetic.preview.review", target_id: syntheticId("201"), outcome: "succeeded", reason: "Visual fixture only", request_id: syntheticId("802") })],
  administrators: [row("901", { display_name: "Synthetic Preview Administrator", active: true, can_manage: true, can_sensitive: true, recovery_verified: true })],
};

function previewRead(section: AdminSection | "invitations", search: string, status: string, cursor: AdminCursor | null): AdminResult {
  const common = { asOf, source };
  if (section === "overview") return { ...common, pendingApplications: 2, rejectedApplications: 1, pendingPayments: 1, approvedBusinesses: 8, operationalBusinesses: 6, activeTrials: 2, activeContracts: 4, expiredContracts: 1, suspendedBusinesses: 0, limitation: "Synthetic fixture totals for layout review." };
  if (section === "system-health") return { ...common, database: { status: "Synthetic — not probed", meaning: "No service check runs in preview mode." }, frontend: "Synthetic preview", auth: "Not contacted", storage: "Not contacted", realtime: "Not contacted", edgeFunctions: "Not contacted" };
  if (section === "security") return { ...common, mfa: "Synthetic explanation: production access still requires private authorization, verified recovery and AAL2 MFA." };
  if (["integrations", "backups"].includes(section)) return common;
  const query = search.toLocaleLowerCase();
  const filtered = (rows[section] ?? []).filter(item => (!query || JSON.stringify(item).toLocaleLowerCase().includes(query)) && (!status || item.status === status || item.classification === status || item.outcome === status));
  const page = cursor ? filtered.slice(1) : filtered.slice(0, 1);
  return { ...common, items: page, nextCursor: !cursor && filtered.length > 1 ? { at: page[0].created_at, id: page[0].id } : null };
}

const preview: PlatformAdminPreviewConfig = {
  context: { userId: syntheticId("999"), displayName: "Synthetic Preview Operator", recoveryVerified: true, mfaRequired: false, canManage: true, canSensitive: true },
  read: (section, search, status, cursor) => previewRead(section, search, status, cursor),
  pathFor: section => `/platform-admin/preview/${section}`,
};

export function PlatformAdminPreviewPage({ section }: { section: AdminSection }) {
  return <PlatformAdminPage section={section} preview={preview} />;
}
