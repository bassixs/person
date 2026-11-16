/**
 * Оригинальный заменяемый знак «Личности» (финальный логотип не утверждён — PROJECT_CONTEXT §20):
 * два смещённых контура-«грани» одной персоны вокруг светящейся точки.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="lm-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(var(--accent))" />
          <stop offset="100%" stopColor="rgb(var(--garnet))" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="rgb(var(--surface))" stroke="rgb(var(--line-strong))" />
      <path d="M11 8.5a7.5 7.5 0 0 0 0 15" fill="none" stroke="rgb(var(--fg-soft))" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M21 8.5a7.5 7.5 0 0 1 0 15" fill="none" stroke="rgb(var(--accent))" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.2" fill="url(#lm-core)" />
      <circle cx="16" cy="16" r="6" fill="rgb(var(--accent))" opacity="0.14" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-fg">ЛИЧНОСТИ</span>
    </span>
  );
}
