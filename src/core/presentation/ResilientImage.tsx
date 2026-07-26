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
  ...imageProps
}: ResilientImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
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
      onError={() => setFailed(true)}
    />
  );
});
