import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { supabase } from "../../../core/database";
import { normalizeMenuImportMime } from "./menuImportFileValidation";

const MENU_IMPORT_BUCKET = "menu-import-drafts";
const SIGNED_PREVIEW_SECONDS = 60 * 30;

export type MenuImportDraft = {
  id: string;
  restaurantId: string;
  fileName: string;
  objectPath: string;
  mimeType: string;
  fileSize: number;
  status: "uploaded";
  createdAt: string;
  updatedAt: string;
  previewUrl: string | null;
};

type MenuImportDraftRow = {
  id: string;
  restaurant_id: string;
  file_name: string;
  object_path: string;
  mime_type: string;
  file_size: number | string;
  status: "uploaded";
  created_at: string;
  updated_at: string;
};

function mapDraft(row: MenuImportDraftRow, previewUrl: string | null) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    fileName: row.file_name,
    objectPath: row.object_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    previewUrl,
  } satisfies MenuImportDraft;
}

async function createPreviewUrl(objectPath: string) {
  const { data, error } = await supabase.storage
    .from(MENU_IMPORT_BUCKET)
    .createSignedUrl(objectPath, SIGNED_PREVIEW_SECONDS);
  if (error) return null;
  return data.signedUrl;
}

export async function listMenuImportDrafts(restaurantId: string) {
  const { data, error } = await supabase
    .from("menu_import_drafts")
    .select(
      "id,restaurant_id,file_name,object_path,mime_type,file_size,status,created_at,updated_at",
    )
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return Promise.all(
    ((data ?? []) as MenuImportDraftRow[]).map(async (row) =>
      mapDraft(row, await createPreviewUrl(row.object_path)),
    ),
  );
}

async function uploadObject(
  objectPath: string,
  file: File,
  replace: boolean,
  onProgress: (progress: number) => void,
) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!session?.access_token) {
    throw new Error("Your session expired. Sign in again before uploading.");
  }

  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${MENU_IMPORT_BUCKET}/${encodedPath}`;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", endpoint);
    request.setRequestHeader(
      "Authorization",
      `Bearer ${session.access_token}`,
    );
    request.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);
    request.setRequestHeader("Content-Type", normalizeMenuImportMime(file));
    request.setRequestHeader("x-upsert", replace ? "true" : "false");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 95));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(96);
        resolve();
        return;
      }
      let message = `Upload failed (${request.status}).`;
      try {
        const payload = JSON.parse(request.responseText) as {
          message?: string;
          error?: string;
        };
        message = payload.message ?? payload.error ?? message;
      } catch {
        // The status message above is safe when Storage returns non-JSON.
      }
      reject(new Error(message));
    });
    request.addEventListener("error", () => {
      reject(new Error("The upload was interrupted. Check your connection."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The upload was cancelled."));
    });
    request.send(file);
  });
}

export async function uploadMenuImportDraft(
  restaurantId: string,
  file: File,
  onProgress: (progress: number) => void,
  existing?: MenuImportDraft,
) {
  const draftId = existing?.id ?? createBrowserUuid();
  const objectPath =
    existing?.objectPath ?? `${restaurantId}/${draftId}/source`;
  const mimeType = normalizeMenuImportMime(file);

  onProgress(1);
  await uploadObject(objectPath, file, Boolean(existing), onProgress);

  const values = {
    id: draftId,
    restaurant_id: restaurantId,
    file_name: file.name,
    object_path: objectPath,
    mime_type: mimeType,
    file_size: file.size,
    status: "uploaded" as const,
    updated_at: new Date().toISOString(),
  };
  const query = existing
    ? supabase
        .from("menu_import_drafts")
        .update(values)
        .eq("id", draftId)
        .eq("restaurant_id", restaurantId)
    : supabase.from("menu_import_drafts").insert(values);
  const { data, error } = await query
    .select(
      "id,restaurant_id,file_name,object_path,mime_type,file_size,status,created_at,updated_at",
    )
    .single();

  if (error) {
    if (!existing) {
      await supabase.storage.from(MENU_IMPORT_BUCKET).remove([objectPath]);
    }
    throw new Error(error.message);
  }

  onProgress(100);
  return mapDraft(
    data as MenuImportDraftRow,
    await createPreviewUrl(objectPath),
  );
}

export async function deleteMenuImportDraft(draft: MenuImportDraft) {
  const { error: storageError } = await supabase.storage
    .from(MENU_IMPORT_BUCKET)
    .remove([draft.objectPath]);
  if (storageError) throw new Error(storageError.message);

  const { error } = await supabase
    .from("menu_import_drafts")
    .delete()
    .eq("id", draft.id)
    .eq("restaurant_id", draft.restaurantId);
  if (error) throw new Error(error.message);
}
