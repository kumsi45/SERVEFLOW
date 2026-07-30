import { memo, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  enabled: boolean;
  estimatedHeight: number;
  children: () => ReactNode;
};

export const VirtualizedCard = memo(function VirtualizedCard({ enabled, estimatedHeight, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(!enabled);

  useEffect(() => {
    if (!enabled || !ref.current) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setNearViewport(Boolean(entry?.isIntersecting));
    }, { rootMargin: "800px 0px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) return children();
  return (
    <div ref={ref} className="smart-virtual-card" style={{ minHeight: nearViewport ? undefined : estimatedHeight }}>
      {nearViewport ? children() : null}
    </div>
  );
});
