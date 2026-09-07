"use client";

import Link from "next/link";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/* ---------- buttons ---------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-95 border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2",
  danger: "bg-danger text-white border-transparent hover:brightness-95",
};
const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium transition ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    >
      {children}
    </Link>
  );
}

/* ---------- fields ---------- */

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; required: boolean };
const FieldContext = createContext<FieldCtx | null>(null);

/**
 * Label + control + hint/error. The control is *not* wrapped in the <label>: the label targets the
 * control by id (via FieldContext), so clicks on the label never activate nested buttons (chips).
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  const hasMsg = Boolean(error || hint);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
        {required && (
          <span aria-hidden className="text-accent">
            {" "}
            *
          </span>
        )}
      </label>
      <FieldContext.Provider value={{ id, describedBy: hasMsg ? msgId : undefined, invalid: Boolean(error), required }}>
        {children}
      </FieldContext.Provider>
      {error ? (
        <span id={msgId} role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={msgId} className="text-xs text-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function useFieldProps() {
  const ctx = useContext(FieldContext);
  if (!ctx) return {};
  return {
    id: ctx.id,
    "aria-describedby": ctx.describedBy,
    "aria-invalid": ctx.invalid || undefined,
    "aria-required": ctx.required || undefined,
  };
}

/** Expose the field's control id to custom controls (ChipInput, uploads). */
export function useFieldId(): string | undefined {
  return useContext(FieldContext)?.id;
}

const controlClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:bg-surface-2 disabled:text-muted aria-invalid:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...rest },
  ref,
) {
  const field = useFieldProps();
  return <input ref={ref} {...field} className={`${controlClass} h-10 ${className}`} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...rest }, ref) {
    const field = useFieldProps();
    return <textarea ref={ref} {...field} className={`${controlClass} min-h-24 py-2 leading-relaxed ${className}`} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = "", children, ...rest },
  ref,
) {
  const field = useFieldProps();
  return (
    <select ref={ref} {...field} className={`${controlClass} h-10 ${className}`} {...rest}>
      {children}
    </select>
  );
});

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  hideLabel = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Keep the accessible name but don't render it (dense table cells). */
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50 ${
          checked ? "bg-accent border-accent" : "bg-surface-2 border-line-strong"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
      {!hideLabel && (
        <label htmlFor={id} className="cursor-pointer select-none">
          <span className="block text-sm font-medium text-ink">{label}</span>
          {description && <span className="block text-xs text-muted">{description}</span>}
        </label>
      )}
    </div>
  );
}

/* ---------- layout ---------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`rounded-card border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent" | "gold";
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2 border-line",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    danger: "bg-danger/10 text-danger border-danger/30",
    accent: "bg-accent/10 text-accent border-accent/30",
    gold: "bg-gold/15 text-[#8a6a14] border-gold/40",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "accent" | "gold" {
  switch (status) {
    case "published":
    case "paid":
    case "ready":
    case "active":
    case "resolved":
    case "complete":
      return "success";
    case "review":
    case "pending":
    case "queued":
    case "running":
    case "transcoding":
    case "uploaded":
    case "open":
      return "warning";
    case "failed":
    case "banned":
    case "deleted":
    case "refunded":
      return "danger";
    case "archived":
    case "dismissed":
    default:
      return "neutral";
  }
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      role="progressbar"
      aria-label="Loading"
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
      style={{ width: size, height: size }}
    />
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-base font-medium text-danger">Couldn&apos;t load</p>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Compact banner for a failed refetch while stale data is still on screen. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ---------- tables ---------- */

export function Table({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="scroll-x">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`border-b border-line bg-surface-2/60 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <td className={`border-b border-line px-4 py-2.5 align-middle ${className}`} title={title}>
      {children}
    </td>
  );
}

/**
 * Previous/Next pager. Pages fetch `limit + 1` rows and pass `hasNext` from the extra row,
 * so there is no "guess" when a page happens to be exactly full.
 */
export function Pagination({
  offset,
  limit,
  count,
  hasNext,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  count: number;
  hasNext: boolean;
  total?: number;
  onChange: (offset: number) => void;
}) {
  const from = count === 0 ? 0 : offset + 1;
  const to = offset + count;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
      <span>
        {count === 0 ? "No rows on this page" : `${from}–${to}`}
        {total != null ? ` of ${total}` : ""}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button size="sm" disabled={!hasNext} onClick={() => onChange(offset + limit)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

/* ---------- tabs ---------- */

/**
 * Accessible tab list: roving tabindex, arrow/Home/End move focus and selection, and each tab
 * points at a panel id (`tabPanelId(id, value)`) that consumers render with <TabPanel>.
 */
export function Tabs<T extends string>({
  id,
  tabs,
  value,
  onChange,
  label = "Tabs",
}: {
  id: string;
  tabs: { value: T; label: string; badge?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const move = (next: T) => {
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="scroll-x flex gap-1 border-b border-line">
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              if (el) refs.current.set(t.value, el);
              else refs.current.delete(t.value);
            }}
            id={tabId(id, t.value)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={tabPanelId(id, t.value)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              let next: number | null = null;
              if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
              else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = tabs.length - 1;
              if (next != null) {
                e.preventDefault();
                move(tabs[next].value);
              }
            }}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

export function tabId(base: string, value: string) {
  return `${base}-tab-${value}`;
}
export function tabPanelId(base: string, value: string) {
  return `${base}-panel-${value}`;
}

export function TabPanel({
  tabsId,
  value,
  children,
  className = "",
}: {
  tabsId: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="tabpanel" id={tabPanelId(tabsId, value)} aria-labelledby={tabId(tabsId, value)} tabIndex={0} className={className}>
      {children}
    </div>
  );
}

/* ---------- dialogs ---------- */

/**
 * Modal on a native <dialog>: focus trap and Escape come for free. Initial focus goes to
 * `[data-autofocus]` or the first form control (never the × button). Backdrop click closes only
 * when both pointerdown and pointerup land on the backdrop, so a drag out of a text field doesn't
 * dismiss the dialog. `dismissible={false}` blocks Escape/backdrop (e.g. while saving).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
  side = false,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  side?: boolean;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      const target =
        el.querySelector<HTMLElement>("[data-autofocus]") ??
        el.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-dialog-close])',
        );
      target?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault();
      }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        if (dismissible && downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
      className={
        side
          ? "fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-xl bg-surface p-0 shadow-none open:flex open:flex-col"
          : `m-auto w-[94vw] rounded-card border border-line bg-surface p-0 open:flex open:flex-col ${width}`
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          data-dialog-close
          aria-label="Close"
          disabled={!dismissible}
          onClick={onClose}
          className="rounded-md px-2 text-lg text-muted hover:text-ink disabled:opacity-40"
        >
          ×
        </button>
      </div>
      <div className={`px-5 py-4 ${side ? "flex-1 overflow-y-auto" : "max-h-[75vh] overflow-y-auto"}`}>{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  destructive = true,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="max-w-md"
      dismissible={!loading}
      footer={
        <>
          <Button onClick={onCancel} disabled={loading} data-autofocus>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{message}</div>
    </Modal>
  );
}

/* ---------- misc ---------- */

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      type="search"
      aria-label={placeholder}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-xs"
    />
  );
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function ChipInput({
  values,
  onChange,
  placeholder = "Add and press Enter",
  label,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useFieldId();
  const commit = () => {
    const el = inputRef.current;
    if (!el) return;
    const v = el.value.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    el.value = "";
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="text-muted hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={fieldId}
        aria-label={label}
        placeholder={placeholder}
        className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && e.currentTarget.value === "" && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
