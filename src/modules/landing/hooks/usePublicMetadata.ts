import { useEffect } from "react";

export function usePublicMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const setMeta = (attribute: "name" | "property", key: string, content: string) => {
      const meta = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
        ?? document.head.appendChild(document.createElement("meta"));
      meta.setAttribute(attribute, key);
      meta.content = content;
    };
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
  }, [title, description]);
}
