import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PersonaListItem } from "../api/types";
import { initials, STATUS_LABEL } from "../lib/format";
import { portraitFor } from "../lib/portraits";

/**
 * Карточка персоны в формате игровой карты — как в отчёте /about (E-023).
 * Портрет на всю карту, затемнение снизу, имя, версия, заполненность паспорта. Клик — в рабочую карточку.
 */

// Цвет для персон без портрета — стабильно по имени
const PALETTE = ["#3d6bff", "#2fae64", "#a64dff", "#f2a516", "#13a8a0", "#ff5a1f", "#5b5ff0", "#d6457a"];
function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function tilt(e: PointerEvent<HTMLAnchorElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  e.currentTarget.style.setProperty("--rx", `${(x * 9).toFixed(2)}deg`);
  e.currentTarget.style.setProperty("--ry", `${(-y * 9).toFixed(2)}deg`);
}
function untilt(e: PointerEvent<HTMLAnchorElement>) {
  e.currentTarget.style.setProperty("--rx", "0deg");
  e.currentTarget.style.setProperty("--ry", "0deg");
}

export function PersonaGameCard({
  p,
  index,
  total,
  action,
}: {
  p: PersonaListItem;
  index: number;
  total: number;
  /** Кнопка в правом верхнем углу (например, архив) — не должна вести по ссылке. */
  action?: ReactNode;
}) {
  const portrait = portraitFor(p.display_name);
  const color = portrait?.color ?? colorFor(p.display_name);
  const version = [p.active_version && `v${p.active_version.label}`, p.draft_version && `черновик v${p.draft_version.label}`]
    .filter(Boolean)
    .join(" · ");
  const c = p.completeness;
  const pct = c && c.fields_total ? (c.fields_filled / c.fields_total) * 100 : 0;

  return (
    <Link
      to={`/personas/${p.id}`}
      className="pcard group"
      style={{ "--pc": color } as CSSProperties}
      onPointerMove={tilt}
      onPointerLeave={untilt}
      aria-label={`${p.display_name}: ${STATUS_LABEL[p.status]}${version ? `, ${version}` : ""}`}
    >
      <span className="pcard__inner">
        {portrait ? (
          <img src={portrait.src} alt="" aria-hidden loading="lazy" draggable={false} className="pcard__img" />
        ) : (
          <span className="pcard__blank" aria-hidden>
            {initials(p.display_name)}
          </span>
        )}
        <span className="pcard__shade" />
        <span className="absolute left-3.5 top-3.5 flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="font-display text-[10.5px] font-semibold tracking-[0.1em] text-white/85">
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <span className="pcard__status">{STATUS_LABEL[p.status]}</span>
        </span>
        <span className="absolute inset-x-4 bottom-4 text-left">
          {version && <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/75">{version}</span>}
          <span className="pcard__name mt-1.5 block">{p.display_name}</span>
          {p.short_context && <span className="mt-1.5 hidden text-[12.5px] leading-snug text-white/75 sm:line-clamp-2">{p.short_context}</span>}
          {c && (
            <span className="mt-3 flex items-center gap-2" title="Заполнено полей паспорта">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-[11px] font-bold text-white/85">
                {c.fields_filled}/{c.fields_total}
              </span>
            </span>
          )}
        </span>
      </span>
      {action && (
        <span className="pcard__action" onClick={(e) => e.preventDefault()}>
          {action}
        </span>
      )}
    </Link>
  );
}
