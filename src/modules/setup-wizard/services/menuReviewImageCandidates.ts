import type { MenuImageCandidate } from "../../../core/presentation/menuItemImage";
import type { MenuReviewImageDraft } from "./menuReviewTypes";

export function menuReviewImageCandidates(draft: MenuReviewImageDraft) {
  const selected = draft.versions.find((version) => version.id === draft.selectedVersionId)
    ?? draft.versions[draft.versions.length - 1]
    ?? null;
  if (!selected) return { custom: null, master: null };
  const ownerUpload = selected.source === "owner";
  const responsiveVariants = draft.versions
    .filter((version) => version.source === selected.source && version.version === selected.version && version.imageUrl)
    .map((version) => ({ width: version.width, publicUrl: version.imageUrl }));
  const candidate: MenuImageCandidate = {
    id: selected.id,
    source: ownerUpload ? "CUSTOM" : "MASTER",
    status: ownerUpload ? "APPROVED" : (draft.masterImageStatus ?? "PENDING_REVIEW"),
    url: selected.imageUrl,
    thumbnailUrl: selected.thumbnailUrl,
    version: selected.version,
    storagePath: selected.storagePath,
    width: selected.width,
    height: selected.height,
    mimeType: selected.mimeType,
    checksumSha256: selected.checksumSha256,
    metadata: { ...(selected.providerMetadata ?? {}), responsiveVariants },
  };
  return ownerUpload ? { custom: candidate, master: null } : { custom: null, master: candidate };
}
