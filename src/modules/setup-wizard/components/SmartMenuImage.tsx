import { memo } from "react";
import { SmartImage } from "../../../core/presentation/SmartImage";
import { resolveSmartImage } from "../../../core/presentation/smartImageDelivery";

type Props = {
  src: string;
  alt: string;
  srcSet?: string;
  sizes?: string;
  className?: string;
};

export const SmartMenuImage = memo(function SmartMenuImage({ src, alt, srcSet, sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px", className }: Props) {
  void srcSet;
  void sizes;
  const resolution = resolveSmartImage({ itemId: src, master: { source: "MASTER", status: "APPROVED", url: src, version: 1 }, placeholderUrl: "" }, "card", "owner-review");
  return <SmartImage resolution={resolution} alt={alt} className={className} fallback={null} fallbackClassName="smart-menu-image-fallback" />;
});
