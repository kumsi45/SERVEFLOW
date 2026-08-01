import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TableHTMLAttributes } from "react";
import "./ownerDesignSystem.css";

export function SfCard({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`sf-card ${className}`.trim()} {...props}>{children}</section>;
}

export function SfCardHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="sf-card-header"><div>{eyebrow ? <span className="sf-eyebrow">{eyebrow}</span> : null}<h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header>;
}

export function SfPageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="sf-page-header"><div>{eyebrow ? <span className="sf-eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action}</header>;
}

export function SfChartFrame({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <SfCard className="sf-chart-card"><SfCardHeader title={title} description={description} /><div className="sf-chart">{children}</div></SfCard>;
}

export function SfButton({ variant = "primary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`sf-button ${variant} ${className}`.trim()} {...props}>{children}</button>;
}

export function SfInput({ label, hint, error, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  return <label className={`sf-field ${error ? "invalid" : ""} ${className}`.trim()}><span>{label}</span><input aria-invalid={Boolean(error)} {...props} />{error ? <small role="alert">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}

export function SfSelect({ label, children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return <label className={`sf-field ${className}`.trim()}><span>{label}</span><select {...props}>{children}</select></label>;
}

export function SfTable({ children, className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="sf-table-wrap"><table className={`sf-table ${className}`.trim()} {...props}>{children}</table></div>;
}

export function SfIcon({ children, label, tone = "neutral" }: { children: ReactNode; label?: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span className={`sf-icon ${tone}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{children}</span>;
}

export function SfStack({ children, gap = "md", className = "" }: { children: ReactNode; gap?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  return <div className={`sf-stack gap-${gap} ${className}`.trim()}>{children}</div>;
}

export function SfSkeleton({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return <div className={`sf-skeleton-group ${className}`.trim()} aria-label="Loading" aria-busy="true">{Array.from({ length: lines }).map((_, index) => <span key={index} className="sf-skeleton" />)}</div>;
}

export function SfEmptyState({ icon = "◇", title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="sf-state sf-empty-state"><SfIcon>{icon}</SfIcon><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function SfErrorState({ title = "Something went wrong", description, retry }: { title?: string; description: string; retry?: () => void }) {
  return <div className="sf-state sf-error-state" role="alert"><SfIcon tone="danger">!</SfIcon><h3>{title}</h3><p>{description}</p>{retry ? <SfButton variant="secondary" onClick={retry}>Try again</SfButton> : null}</div>;
}

export function SfDialog({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  if (!open) return null;
  return <div className="sf-overlay" role="presentation"><button className="sf-overlay-dismiss" aria-label="Close dialog" onClick={onClose} /><section className="sf-dialog" role="dialog" aria-modal="true" aria-labelledby="sf-dialog-title"><header><h2 id="sf-dialog-title">{title}</h2><button aria-label="Close dialog" onClick={onClose}>×</button></header>{children}</section></div>;
}

export function SfSidePanel({ open, title, eyebrow, children, onClose, className = "" }: { open: boolean; title: string; eyebrow?: string; children: ReactNode; onClose: () => void; className?: string }) {
  if (!open) return null;
  return <div className="sf-overlay"><button className="sf-overlay-dismiss" aria-label="Close panel" onClick={onClose} /><aside className={`sf-side-panel ${className}`.trim()} aria-label={title}><header><div>{eyebrow ? <span className="sf-eyebrow">{eyebrow}</span> : null}<h2>{title}</h2></div><button aria-label="Close panel" onClick={onClose}>×</button></header><div className="sf-side-panel-body">{children}</div></aside></div>;
}
