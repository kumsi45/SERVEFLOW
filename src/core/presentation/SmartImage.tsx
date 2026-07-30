import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  isSmartImageMemoryCached,
  markSmartImageCached,
  reportSmartImageFailure,
  type SmartImageResolution,
} from "./smartImageDelivery";

type Props = {
  resolution: SmartImageResolution;
  alt: string;
  className?: string;
  fallback: ReactNode;
  fallbackClassName: string;
  fallbackLabel?: string;
  eager?: boolean;
  fetchPriority?: "high" | "low" | "auto";
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
};

export const SmartImage = memo(function SmartImage({
  resolution,
  alt,
  className,
  fallback,
  fallbackClassName,
  fallbackLabel,
  eager = false,
  fetchPriority = "low",
  onLoad,
}: Props) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(eager || isSmartImageMemoryCached(resolution.url));
  const [stage, setStage] = useState<"skeleton" | "preview" | "final" | "failed">(
    isSmartImageMemoryCached(resolution.url) ? "final" : "skeleton",
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setVisible(eager || isSmartImageMemoryCached(resolution.url));
    setStage(isSmartImageMemoryCached(resolution.url) ? "final" : "skeleton");
    setAttempt(0);
  }, [eager, resolution.cacheKey, resolution.url]);

  useEffect(() => {
    if (visible || !hostRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "240px 0px" });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [visible]);

  if (!resolution.url || stage === "failed") {
    return <span className={fallbackClassName} role={fallbackLabel ? "img" : undefined} aria-label={fallbackLabel} aria-hidden={fallbackLabel ? undefined : true}>{fallback}</span>;
  }

  const showPreview = visible && resolution.previewUrl && resolution.previewUrl !== resolution.url && stage !== "final";
  return (
    <span ref={hostRef} className={["smart-image-shell", stage === "final" ? "is-loaded" : "is-loading", className].filter(Boolean).join(" ")} data-image-state={stage}>
      <span className="smart-image-skeleton" aria-hidden="true" />
      {showPreview ? <img className="smart-image-preview" src={resolution.previewUrl ?? undefined} alt="" aria-hidden="true" decoding="async" onLoad={() => setStage("preview")} /> : null}
      {visible ? <img key={`${resolution.cacheKey}:${attempt}`} className="smart-image-final" src={resolution.url} alt={alt} decoding="async" loading={eager ? "eager" : "lazy"} fetchPriority={fetchPriority} onLoad={(event) => { markSmartImageCached(resolution.url!); setStage("final"); onLoad?.(event); }} onError={() => { if (attempt === 0) { setAttempt(1); return; } reportSmartImageFailure(resolution); setStage("failed"); }} /> : null}
    </span>
  );
});
