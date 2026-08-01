import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";

export const OWNER_IMAGE_WIDTHS = [320, 512, 1024, 2048] as const;

export type PreparedOwnerImageVariant = {
  id: string;
  width: number;
  height: number;
  blob: Blob;
  checksumSha256: string;
};

async function decodeOwnerImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose a supported image file.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Images must be 15 MB or smaller.");
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This browser could not optimize the image.")), "image/webp", 0.86));
}

async function checksum(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareOwnerImageAsset(file: File): Promise<PreparedOwnerImageVariant[]> {
  const image = await decodeOwnerImage(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.max(0, (sourceWidth - cropSize) / 2);
  const sourceY = Math.max(0, (sourceHeight - cropSize) / 2);
  try {
    return await Promise.all(OWNER_IMAGE_WIDTHS.map(async (width) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = width;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Image optimization is unavailable.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, width, width);
      const blob = await canvasBlob(canvas);
      return { id: createBrowserUuid(), width, height: width, blob, checksumSha256: await checksum(blob) };
    }));
  } finally {
    image.close();
  }
}
