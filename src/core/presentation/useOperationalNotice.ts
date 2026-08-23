import { useEffect } from "react";

export const OPERATIONAL_NOTICE_DURATION_MS = 4000;

export function useOperationalNotice(
  message: string | null,
  clear: (value: null) => void,
  duration = OPERATIONAL_NOTICE_DURATION_MS,
) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => clear(null), duration);
    return () => window.clearTimeout(timer);
  }, [clear, duration, message]);
}
