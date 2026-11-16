import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Construction, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { PersonaStatus } from "../api/types";
import { initials, STATUS_LABEL } from "../lib/format";

const STATUS_TONE: Record<PersonaStatus, string> = {
  draft: "border-line-strong text-fg-soft",
  pending_approval: "border-info/40 text-info",
  active: "border-success/40 text-success",
  needs_revision: "border-warning/40 text-warning",
  suspended: "border-warning/40 text-warning",
  archived: "border-line text-muted",
};

export function StatusBadge({ status }: { status: PersonaStatus }) {
  return (
    <span className={clsx("chip font-medium", STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-ui border border-line-strong bg-gradient-to-br from-garnet/50 to-elevated font-semibold text-fg"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ label = "Загрузка…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center px-6 py-14 text-center fade-in">
      {icon && <div className="mb-4 text-accent">{icon}</div>}
      <h3 className="text-lg font-semibold text-fg">{title}</h3>
      {children && <div className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Неизвестная ошибка";
  return (
    <div className="panel flex items-start gap-3 border-danger/30 p-4 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <div className="font-semibold text-fg">Не удалось загрузить данные</div>
        <div className="text-muted">{msg}</div>
      </div>
      {onRetry && (
        <button className="btn-secondary btn-sm" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

/** Честная метка модуля следующей итерации — без выдуманных данных. */
export function NotYet({ iteration, title, children }: { iteration: number; title: string; children?: ReactNode }) {
  return (
    <EmptyState icon={<Construction className="h-8 w-8" />} title={title}>
      <p>{children}</p>
      <p className="mt-3 label-mono">Запланировано: итерация {iteration}</p>
    </EmptyState>
  );
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="label-mono mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Локальные вкладки раздела (не глобальная навигация). */
export function LocalTabs({ items }: { items: { to: string; label: string; end?: boolean }[] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" aria-label="Подразделы">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) =>
            clsx(
              "relative whitespace-nowrap px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
              isActive ? "text-fg" : "text-muted hover:text-fg-soft",
            )
          }
        >
          {({ isActive }) => (
            <>
              {it.label}
              {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--accent))]" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm fade-in" />
        <Dialog.Content
          className={clsx(
            "panel-elevated fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-surface p-6 shadow-2xl modal-in",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-fg">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="btn-ghost btn-sm -mr-2" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg-soft">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
