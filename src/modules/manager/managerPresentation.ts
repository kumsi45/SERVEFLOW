const TECHNICAL_ERROR_TERMS =
  /\b(?:rpc|rls|postgrest|schema cache|canonical|migration|backend|database function|uuid|tenant-scoped)\b/i;

export function managerFacingMessage(
  message: string | null | undefined,
  fallback: string,
) {
  if (!message || TECHNICAL_ERROR_TERMS.test(message)) return fallback;
  return message;
}
