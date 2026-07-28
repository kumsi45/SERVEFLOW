import {
  memo,
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";

type ResilientImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "onError" | "src"
> & {
  src?: string | null;
  fallback: ReactNode;
  fallbackClassName: string;
  fallbackLabel?: string;
};

export const ResilientImage = memo(function ResilientImage({
  src,
  fallback,
  fallbackClassName,
  fallbackLabel,
  className,
  onLoad,
  ...imageProps
}: ResilientImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  if (!src || failed) {
    return (
      <span
        className={fallbackClassName}
        role={fallbackLabel ? "img" : undefined}
        aria-label={fallbackLabel}
        aria-hidden={fallbackLabel ? undefined : true}
      >
        {fallback}
      </span>
    );
  }

  return (
    <img
      {...imageProps}
      src={src}
      className={["resilient-image", loaded ? "is-loaded" : "is-loading", className].filter(Boolean).join(" ")}
      data-image-state={loaded ? "loaded" : "loading"}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={() => setFailed(true)}
    />
  );
});
