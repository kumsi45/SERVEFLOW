import { useEffect, useMemo } from "react";
import type { MenuItemImageInput } from "./menuItemImage";
import { prefetchSmartImages, resolveSmartImage, type SmartImageUsage } from "./smartImageDelivery";

export function useSmartImagePrefetch(inputs: readonly MenuItemImageInput[], usage: SmartImageUsage = "card") {
  const resolutions = useMemo(
    () => inputs.map((input) => resolveSmartImage(input, usage)),
    [inputs, usage],
  );
  useEffect(() => {
    prefetchSmartImages(resolutions);
  }, [resolutions]);
}
