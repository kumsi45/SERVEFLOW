export const MENU_IMPORT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.docx,application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const DEFAULT_MENU_IMPORT_MAX_FILE_MB = 15;
export const MENU_IMPORT_STORAGE_LIMIT_MB = 50;

const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export type MenuImportFileLike = {
  name: string;
  size: number;
  type: string;
};

export function getMenuImportMaxFileBytes(configuredMb?: string) {
  const parsed = Number(configuredMb);
  const maxMb =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MENU_IMPORT_STORAGE_LIMIT_MB)
      : DEFAULT_MENU_IMPORT_MAX_FILE_MB;
  return Math.floor(maxMb * 1024 * 1024);
}

export function getMenuImportExtension(fileName: string) {
  return fileName.trim().toLowerCase().split(".").pop() ?? "";
}

export function normalizeMenuImportMime(file: MenuImportFileLike) {
  const extension = getMenuImportExtension(file.name);
  return MIME_BY_EXTENSION[extension]?.[0] ?? file.type.toLowerCase();
}

export function validateMenuImportFile(
  file: MenuImportFileLike,
  maxFileBytes: number,
) {
  const extension = getMenuImportExtension(file.name);
  const acceptedMimes = MIME_BY_EXTENSION[extension];
  const suppliedMime = file.type.trim().toLowerCase();

  if (
    !acceptedMimes ||
    (suppliedMime &&
      suppliedMime !== "application/octet-stream" &&
      !acceptedMimes.includes(suppliedMime))
  ) {
    return `${file.name || "This file"} is unsupported. Upload PDF, PNG, JPG, JPEG, WEBP, or DOCX.`;
  }

  if (file.size <= 0) {
    return `${file.name} is empty and cannot be uploaded.`;
  }

  if (file.size > maxFileBytes) {
    return `${file.name} is too large. The maximum file size is ${formatMenuImportFileSize(maxFileBytes)}.`;
  }

  return null;
}

export function formatMenuImportFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
