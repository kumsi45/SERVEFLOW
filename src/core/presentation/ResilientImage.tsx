import { memo, type ImgHTMLAttributes, type ReactNode } from "react";
import { SmartImage } from "./SmartImage";
import type { MenuImageCandidate } from "./menuItemImage";
import { resolveSmartImage, type SmartImageUsage } from "./smartImageDelivery";

type ResilientImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "onError" | "src"
> & {
  src?: string | null;
  fallback: ReactNode;
  fallbackClassName: string;
  fallbackLabel?: string;
  itemId?: string;
  resolvedSource?: "CUSTOM" | "MASTER" | "PLACEHOLDER";
  usage?: SmartImageUsage;
};

export const ResilientImage = memo(function ResilientImage({
  src,
  fallback,
  fallbackClassName,
  fallbackLabel,
  itemId,
  resolvedSource,
  usage = "card",
  className,
  onLoad,
  ...imageProps
}: ResilientImageProps) {
  const candidate: MenuImageCandidate | null = src ? { source: resolvedSource ?? "MASTER", status: "APPROVED", url: src, thumbnailUrl: src, version: 1 } : null;
  const resolution = resolveSmartImage({ itemId: itemId ?? src ?? "image", master: candidate, placeholderUrl: "" }, usage, "owner-review");
  return <SmartImage resolution={resolution} alt={imageProps.alt ?? ""} className={["resilient-image", className].filter(Boolean).join(" ")} fallback={fallback} fallbackClassName={fallbackClassName} fallbackLabel={fallbackLabel} eager={imageProps.loading === "eager"} fetchPriority={imageProps.fetchPriority} onLoad={onLoad} />;
});
