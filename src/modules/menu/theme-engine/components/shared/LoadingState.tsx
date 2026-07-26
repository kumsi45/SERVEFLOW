export function LoadingState({ label = "Loading menu" }: { label?: string }) {
  return <section className="menu-theme-loading" role="status" aria-live="polite"><span aria-hidden="true" /><p>{label}</p></section>;
}
