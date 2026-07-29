import { memo } from "react";

type Props = {
  src: string;
  alt: string;
  srcSet?: string;
  sizes?: string;
  className?: string;
};

export const SmartMenuImage = memo(function SmartMenuImage({ src, alt, srcSet, sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px", className }: Props) {
  return <img src={src} srcSet={srcSet} sizes={srcSet ? sizes : undefined} alt={alt} className={className} loading="lazy" decoding="async" fetchPriority="low" />;
});
