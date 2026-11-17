/**
 * Знак «Личности» (финальный логотип не утверждён — PROJECT_CONTEXT §20): две «грани» одной персоны вокруг точки.
 * Светлый стиль (E-021): чернильная плашка, бумажная и оранжевая дуги.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="10" fill="rgb(var(--fg))" />
      <path d="M11 8.5a7.5 7.5 0 0 0 0 15" fill="none" stroke="rgb(var(--canvas))" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M21 8.5a7.5 7.5 0 0 1 0 15" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.2" fill="rgb(var(--accent))" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-[15px] font-bold tracking-[0.04em] text-fg">ЛИЧНОСТИ</span>
    </span>
  );
}
