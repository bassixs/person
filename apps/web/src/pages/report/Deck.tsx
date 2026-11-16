import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { PersonaArt } from "./Avatar";
import type { Persona } from "./personas";

/**
 * Веер карточек персонажей. Активная — в центре; остальные расходятся дугой.
 * Управление: перетаскивание (мышь/палец), клик по карте, стрелки клавиатуры, кнопки.
 */
export function Deck({ personas, active, onChange }: { personas: Persona[]; active: number; onChange: (i: number) => void }) {
  const n = personas.length;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; base: number; moved: boolean; step: number } | null>(null);
  const [pos, setPos] = useState<number | null>(null); // дробная позиция во время перетаскивания

  const norm = useCallback((i: number) => ((i % n) + n) % n, [n]);
  const go = useCallback((d: number) => onChange(norm(active + d)), [active, norm, onChange]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 6) d.moved = true;
      if (d.moved) setPos(d.base - dx / d.step);
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (d.moved) {
        const p = d.base - (e.clientX - d.x) / d.step;
        onChange(norm(Math.round(p)));
        // клик после перетаскивания не должен выбирать карту
        setTimeout(() => setPos(null), 0);
      } else {
        setPos(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [norm, onChange]);

  const onDown = (e: RPointerEvent) => {
    const first = ref.current?.querySelector<HTMLElement>(".rp-deck__card");
    const step = first ? first.offsetWidth * 0.6 : 180;
    drag.current = { x: e.clientX, base: active, moved: false, step };
  };

  const tilt = (e: RPointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.setProperty("--rx", `${(x * 10).toFixed(2)}deg`);
    e.currentTarget.style.setProperty("--ry", `${(-y * 10).toFixed(2)}deg`);
  };
  const untilt = (e: RPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.style.setProperty("--rx", "0deg");
    e.currentTarget.style.setProperty("--ry", "0deg");
  };

  const center = pos ?? active;
  return (
    <div>
      <div
        ref={ref}
        className="rp-deck rp-deck-in"
        data-dragging={pos !== null}
        onPointerDown={onDown}
        role="group"
        aria-roledescription="карусель"
        aria-label="Персонажи: выберите карточку"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        {personas.map((p, i) => {
          let off = i - center;
          off = ((((off + n / 2) % n) + n) % n) - n / 2; // по кругу
          const abs = Math.abs(off);
          const isActive = i === active && pos === null;
          return (
            <button
              key={p.id}
              type="button"
              className="rp-deck__card"
              data-active={isActive}
              aria-pressed={i === active}
              aria-label={`Выбрать персонажа: ${p.name}`}
              style={
                {
                  "--off": off.toFixed(3),
                  "--abs": abs.toFixed(3),
                  "--n": i,
                  "--pc": p.look.c1,
                  zIndex: 100 - Math.round(abs * 10),
                  opacity: abs > 3.2 ? 0 : 1,
                } as CSSProperties
              }
              onClick={() => {
                if (drag.current?.moved || pos !== null) return;
                onChange(i);
              }}
              onPointerMove={isActive ? tilt : undefined}
              onPointerLeave={isActive ? untilt : undefined}
            >
              <span className="rp-deck__inner">
                <PersonaArt look={p.look} className="absolute inset-0 h-full w-full" />
                <span className="rp-deck__shade" />
                <span className="absolute left-4 top-4 font-[Unbounded] text-[11px] font-semibold tracking-[0.1em] text-white/85">
                  {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                </span>
                <span className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur">
                  <p.look.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="absolute inset-x-4 bottom-4 text-left">
                  <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-white/75">{p.look.role}</span>
                  <span className="rp-deck__name mt-1.5 block">{p.name}</span>
                  <span className="mt-3 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                      <span className="block h-full rounded-full bg-white" style={{ width: `${(p.known / p.total) * 100}%` }} />
                    </span>
                    <span className="text-[11px] font-bold text-white/85">
                      {p.known}/{p.total}
                    </span>
                  </span>
                </span>
                <span className="rp-deck__dim" />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <button type="button" className="rp-btn rp-btn--ghost rp-btn--icon" aria-label="Предыдущий персонаж" onClick={() => go(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex gap-1.5" aria-hidden>
          {personas.map((p, i) => (
            <span
              key={p.id}
              className="h-2 rounded-full transition-all duration-500"
              style={{ width: i === active ? 26 : 8, background: i === active ? p.look.c1 : "var(--line-strong)" }}
            />
          ))}
        </div>
        <button type="button" className="rp-btn rp-btn--ghost rp-btn--icon" aria-label="Следующий персонаж" onClick={() => go(1)}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
