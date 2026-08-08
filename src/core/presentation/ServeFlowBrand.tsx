import { useState } from "react";
import "./serveFlowBrand.css";

export type ServeFlowBrandVariant = "full" | "compact" | "icon-only";

export const SERVEFLOW_LOGO_ASSET = "/serveflowlogo.png";

type ServeFlowBrandProps = {
  variant?: ServeFlowBrandVariant;
  tenantName?: string | null;
  theme?: "light" | "dark";
};

export function ServeFlowBrandMark({ imageFailed, onImageError }: { imageFailed: boolean; onImageError?: () => void }) {
  return (
    <span className="sf-brand-mark" aria-hidden="true">
      {imageFailed ? <span className="sf-brand-fallback">S</span> : <img src={SERVEFLOW_LOGO_ASSET} alt="" onError={onImageError} />}
    </span>
  );
}

export function ServeFlowBrand({
  variant = "full",
  tenantName,
  theme = "light",
}: ServeFlowBrandProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconOnly = variant === "icon-only";

  return (
    <div className="sf-brand" data-theme={theme} data-variant={variant} role={iconOnly ? "img" : undefined} aria-label={iconOnly ? "ServeFlow" : undefined}>
      <ServeFlowBrandMark imageFailed={imageFailed} onImageError={() => setImageFailed(true)} />
      {!iconOnly ? <span className="sf-brand-copy">
        <span className="sf-brand-name">ServeFlow</span>
        {variant === "full" && tenantName ? <span className="sf-brand-tenant">{tenantName}</span> : null}
      </span> : null}
    </div>
  );
}
