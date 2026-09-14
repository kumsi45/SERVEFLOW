import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ download: vi.fn(), from: vi.fn() }));
vi.mock("../../src/core/database", () => ({ supabase: { storage: { from: storage.from } } }));
import { downloadOwnerMenuFile, validateOwnerMenuFilePath } from "../../src/modules/owner/services/ownerMenuFileAccess";

const tenant = "00000000-0000-4000-8000-000000000001";
const path = `${tenant}/source.pdf`;
const migration = readFileSync("supabase/migrations/262_owner_menu_files_private.sql", "utf8");
const page = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const fileSection = page.slice(page.indexOf("async function handleUploadMenuFile"), page.indexOf("async function handleSubmitMenuItem"));

describe("Owner Menu Phase 1A private source files", () => {
  beforeEach(() => { vi.clearAllMocks(); storage.from.mockReturnValue({ download: storage.download }); });
  it("makes only menu-files private and replaces public SELECT with existing Owner authority", () => {
    expect(migration).toContain("update storage.buckets set public = false where id = 'menu-files'");
    expect(migration).toContain("drop policy if exists menu_files_select_public");
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("public.has_staff_role");
    expect(migration).toContain("array['owner']::public.restaurant_staff_role[]");
    expect(migration).not.toMatch(/array\[.*manager|grant |disable row level security|delete from|update public\.menu_uploads/i);
    expect((migration.match(/create policy/g) || [])).toHaveLength(1);
  });
  it("uses stable file_path even when legacy file_url is public or external", async () => {
    const legacy = { file_path: path, file_url: "https://untrusted.invalid/public/file.pdf" };
    const blob = new Blob(["fixture"], { type: "application/pdf" });
    storage.download.mockResolvedValue({ data: blob, error: null });
    expect(await downloadOwnerMenuFile(tenant, legacy.file_path)).toBe(blob);
    expect(storage.from).toHaveBeenCalledWith("menu-files");
    expect(storage.download).toHaveBeenCalledWith(path);
  });
  it.each(["other/source.pdf", `${tenant}/../file.pdf`, `${tenant}/./file.pdf`, `${tenant}//file.pdf`, `${tenant}/%2e%2e/file.pdf`, `${tenant}/source.pdf?token=secret`, `${tenant}/source.pdf#x`, `${tenant}\\source.pdf`, `${tenant}/file\u0000.pdf`, `https://example.invalid/${path}`, `${tenant}/`])("rejects forged/malformed path %s before requesting storage", async value => {
    await expect(downloadOwnerMenuFile(tenant, value)).rejects.toThrow("Menu file path");
    expect(storage.from).not.toHaveBeenCalled();
  });
  it("preserves nested stable paths and optional photo separation", () => {
    expect(validateOwnerMenuFilePath(tenant, `${tenant}/archive/source.pdf`)).toBe(`${tenant}/archive/source.pdf`);
    expect(page).toContain('createSmartImagePublicUrl');
    expect(page).toContain('.from("menu-photos")');
  });
  it("does not conceal missing-file or authentication failures", async () => {
    storage.download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    await expect(downloadOwnerMenuFile(tenant, path)).rejects.toThrow("Object not found");
    storage.download.mockResolvedValue({ data: null, error: { message: "Access denied" } });
    await expect(downloadOwnerMenuFile(tenant, path)).rejects.toThrow("Access denied");
    storage.download.mockResolvedValue({ data: null, error: null });
    await expect(downloadOwnerMenuFile(tenant, path)).rejects.toThrow("could not be downloaded");
  });
  it("fetches fresh authenticated content on every view without persisted signed links", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["fixture"]), error: null });
    await downloadOwnerMenuFile(tenant, path); await downloadOwnerMenuFile(tenant, path);
    expect(storage.download).toHaveBeenCalledTimes(2);
    expect(fileSection).toContain("file_url: path");
    expect(fileSection).not.toContain("getPublicUrl");
    expect(fileSection).not.toContain("createSignedUrl");
    expect(page).not.toContain("href={upload.file_url}");
    expect(fileSection).toContain("viewer.opener = null");
    expect(fileSection).toContain("URL.revokeObjectURL(localUrl)");
    expect(fileSection).toContain('remove([path])');
  });
});
