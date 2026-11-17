/**
 * Знак «Личности»: веер из трёх карточек персонажей — главный образ продукта (отчёт /about, E-021/E-022).
 * Передняя карточка — персона с оранжевой «искрой»; задние — оранжевая и графитовая. Финальный логотип не утверждён (§20).
 * Та же геометрия — в public/mark.svg (фавикон).
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g transform="rotate(-21 32 60)">
        <rect x="20.5" y="16" width="23" height="33" rx="6.5" fill="rgb(var(--accent))" />
      </g>
      <g transform="rotate(19 32 60)">
        <rect x="20.5" y="16" width="23" height="33" rx="6.5" fill="#55534c" />
      </g>
      <g transform="rotate(-4 32 60)">
        <rect x="19" y="13" width="26" height="38" rx="7" fill="rgb(var(--fg))" />
        <circle cx="32" cy="27.5" r="5.6" fill="rgb(var(--accent))" />
        <path d="M22.5 45a9.5 7.6 0 0 1 19 0z" fill="rgb(var(--canvas))" />
      </g>
    </svg>
  );
}

/** Название — как в шапке отчёта: только текст, Unbounded 800. */
export function Wordmark() {
  return <span className="font-display text-[15px] font-extrabold tracking-[0.04em] text-fg">ЛИЧНОСТИ</span>;
}
