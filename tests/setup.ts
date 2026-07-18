import { vi } from "vitest";

vi.mock("../src/core/database", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));
