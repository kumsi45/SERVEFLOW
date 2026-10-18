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

// Multiple explicit fixture rows exercise review states and bounded pagination.
const names = ["Synthetic Riverside Cafe", "Synthetic Acacia Lodge", "Synthetic Juniper Kitchen", "Synthetic Market Bistro", "Synthetic Lakeside Lounge", "Synthetic Cedar Coffee", "Synthetic Garden Table"];
for (const section of Object.keys(rows) as Array<keyof typeof rows>) {
  const template = rows[section]?.[0];
  if (!template) continue;
  rows[section] = names.map((name, index) => ({
    ...template, id: syntheticId(String(10000 + Object.keys(rows).indexOf(section) * 100 + index)),
    created_at: `2026-01-${String(15 - index).padStart(2, "0")}T09:30:00.000Z`,
    ...(template.business_name ? { business_name: name } : {}),
    ...(template.name ? { name, slug: `synthetic-business-${index + 1}`, classification: ["demo", "live", "unclassified"][index % 3] } : {}),
    ...(section === "applications" ? { status: ["pending", "approved", "rejected"][index % 3], decision_reason: index % 3 ? "Synthetic review decision" : null } : {}),
    ...(section === "payments" ? { status: index % 2 ? "rejected" : "pending", reference: `SYNTHETIC-REFERENCE-${index + 1}`, amount: String(1250 + index * 250) } : {}),
    ...(section === "contracts" ? { kind: index < 2 ? "trial" : "annual", starts_at: index < 2 ? "2026-01-13T00:00:00Z" : index === 6 ? "2025-01-01T00:00:00Z" : "2026-01-01T00:00:00Z", ends_at: index < 2 ? "2026-01-20T00:00:00Z" : index === 6 ? "2026-01-01T00:00:00Z" : "2027-01-01T00:00:00Z" } : {}),
    ...(section === "users" ? { display_name: `Synthetic Team Member ${index + 1}`, role: ["owner", "manager", "cashier"][index % 3], active: index !== 2 } : {}),
    ...(section === "administrators" ? { display_name: `Synthetic Administrator ${index + 1}`, active: index !== 2, can_sensitive: index === 0 } : {}),
    ...(section === "audit-logs" ? { outcome: index % 2 ? "rejected" : "succeeded" } : {}),
  }));
}

export function previewRead(section: AdminSection | "invitations", search: string, status: string, cursor: AdminCursor | null, from = "", through = ""): AdminResult {
  const common = { asOf, source };
  if (section === "overview") return { ...common, totalBusinesses: 7, pendingApplications: 3, rejectedApplications: 2, pendingPayments: 4, operationalBusinesses: 4, activeTrials: 2, activeContracts: 4, expiringContracts: 2, expiredContracts: 1,
    previewActivity: [
      { actor: "Synthetic reviewer", action: "Application reviewed", target: "Synthetic Acacia Lodge", at: "2026-01-14T10:00:00Z" },
      { actor: "Synthetic reviewer", action: "Payment evidence rejected", target: "Synthetic Market Bistro", at: "2026-01-14T09:00:00Z" },
      { actor: "Synthetic reviewer", action: "Business classification reviewed", target: "Synthetic Riverside Cafe", at: "2026-01-13T15:30:00Z" },
    ] };
  if (section === "system-health") return { ...common, database: { status: "Not verified", meaning: "No service check runs in preview mode." }, frontend: "Local preview", auth: "Not contacted", storage: "Not contacted", realtime: "Not contacted", edgeFunctions: "Not contacted" };
  if (section === "security") return { ...common, mfa: "Private access requires named authorization, verified recovery and authenticator verification. Preview grants none of these." };
  if (["integrations", "backups"].includes(section)) return common;
  const query = search.toLocaleLowerCase();
  const filtered = (rows[section] ?? []).filter(item => (!query || JSON.stringify(item).toLocaleLowerCase().includes(query)) && (!status || item.status === status || item.classification === status || item.outcome === status) && (!from || item.created_at >= `${from}T00:00:00.000Z`) && (!through || item.created_at < new Date(Date.parse(`${through}T00:00:00Z`) + 86400000).toISOString()));
  const offset = cursor ? Math.max(0, filtered.findIndex(item => item.id === cursor.id) + 1) : 0;
  const page = filtered.slice(offset, offset + 4);
  const last = page[page.length - 1];
  return { ...common, items: page, nextCursor: last && offset + page.length < filtered.length ? { at: last.created_at, id: last.id } : null };
}

const preview: PlatformAdminPreviewConfig = {
  read: previewRead,
  pathFor: section => `/platform-admin/preview/${section}`,
};

export function PlatformAdminPreviewPage({ section }: { section: AdminSection }) {
  return <PlatformAdminPage section={section} preview={preview} />;
}
