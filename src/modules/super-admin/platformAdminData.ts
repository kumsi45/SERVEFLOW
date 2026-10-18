import { adminMutation, readAdmin, type AdminCursor, type AdminResult, type AdminSection } from "./platformAdminService";

export type AdminResource = AdminSection | "invitations";
export type AdminQuery = {
  resource: AdminResource;
  search: string;
  status: string;
  cursor: AdminCursor | null;
  from: string;
  through: string;
};
export type AdminMutationName = Parameters<typeof adminMutation>[0];
export type AdminMutationRequest = { name: AdminMutationName; values: Record<string, unknown>; requestId: string };
export type AdminMutationResult = { ok: true; id?: string; actor?: string; decidedAt?: string };
export interface AdminDataSource {
  read(query: AdminQuery): Promise<AdminResult>;
  mutate(request: AdminMutationRequest): Promise<AdminMutationResult>;
}

export const privateAdminDataSource: AdminDataSource = {
  read: ({ resource, search, status, cursor, from, through }) => readAdmin(resource, search, status, cursor, from, through),
  mutate: async ({ name, values, requestId }) => adminMutation(name, values, requestId) as Promise<AdminMutationResult>,
};
