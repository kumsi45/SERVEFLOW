import { describe, expect, it } from "vitest";
import { createPreviewAdminDataSource } from "../../src/modules/super-admin/PlatformAdminPreviewPage";

const query = (resource: "applications" | "businesses") => ({ resource, search: "", status: "", cursor: null, from: "", through: "" });

describe("platform admin demo data boundary", () => {
  it("leaves a pending application unchanged when a mutation fails", async () => {
    const source = createPreviewAdminDataSource({ latencyMs: 0 });
    const first = (await source.read(query("applications"))).items![0];
    source.setMode("error");
    await expect(source.mutate({ name: "platform_admin_decide_application", values: { application_id: first.id, decision: "approved", reason: "Reviewed documents" }, requestId: "failed-request" })).rejects.toMatchObject({ code: "DEMO_ERROR" });
    source.setMode("populated");
    expect((await source.read(query("applications"))).items!.find(row => row.id === first.id)?.status).toBe("pending");
  });
  it("exposes empty, error, partial, and large datasets without changing private data", async () => {
    const source = createPreviewAdminDataSource({ latencyMs: 0 });
    source.setMode("empty");
    expect((await source.read(query("applications"))).items).toEqual([]);
    source.setMode("error");
    await expect(source.read(query("applications"))).rejects.toMatchObject({ code: "DEMO_ERROR" });
    source.setMode("partial");
    expect((await source.read({ ...query("applications"), resource: "overview" })).totalBusinesses).toBeNull();
    source.setMode("large");
    let result = await source.read(query("applications"));
    let count = 0;
    while (result.items?.length) {
      count += result.items.length;
      if (!result.nextCursor) break;
      result = await source.read({ ...query("applications"), cursor: result.nextCursor });
    }
    expect(count).toBe(525);
  });

  it("saves application decisions with actor and time and rejects stale or short decisions", async () => {
    const source = createPreviewAdminDataSource({ latencyMs: 0 });
    const first = (await source.read(query("applications"))).items?.find(row => row.status === "pending");
    expect(first).toBeDefined();
    const values = { application_id: first!.id, decision: "rejected", reason: "Too short" };
    await expect(source.mutate({ name: "platform_admin_decide_application", values, requestId: "one" })).rejects.toMatchObject({ code: "22023" });
    const result = await source.mutate({ name: "platform_admin_decide_application", values: { ...values, reason: "Missing documents" }, requestId: "two" });
    expect(result).toMatchObject({ ok: true, actor: "Demo administrator" });
    expect(result.decidedAt).toEqual(expect.any(String));
    await expect(source.mutate({ name: "platform_admin_decide_application", values: { ...values, reason: "Missing documents" }, requestId: "three" })).rejects.toMatchObject({ code: "PT409" });
    const updated = (await source.read(query("applications"))).items?.find(row => row.id === first!.id);
    expect(updated?.status).toBe("rejected");
    expect(updated?.decided_by_name).toBe("Demo administrator");
  });
});
