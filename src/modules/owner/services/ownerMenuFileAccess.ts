import { supabase } from "../../../core/database";

// Never follow persisted public/external URLs or treat signed URLs as identity.
// Storage RLS is authoritative; this check also rejects stale/forged UI paths.
export function validateOwnerMenuFilePath(restaurantId: string, filePath: string) {
  const parts = filePath.split("/");
  if (!restaurantId || parts.length < 2 || parts[0] !== restaurantId ||
      parts.some(part => !part || part === "." || part === "..") ||
      /[\\%?#\u0000-\u001f\u007f]/.test(filePath)) {
    throw new Error("Menu file path is unavailable or belongs to another restaurant.");
  }
  return filePath;
}

export async function downloadOwnerMenuFile(restaurantId: string, filePath: string) {
  const path = validateOwnerMenuFilePath(restaurantId, filePath);
  const { data, error } = await supabase.storage.from("menu-files").download(path);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Menu file could not be downloaded.");
  return data;
}
