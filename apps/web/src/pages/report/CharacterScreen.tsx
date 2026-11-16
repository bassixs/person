import clsx from "clsx";
import { FlaskConical, Lock, MessagesSquare, Network, Power } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { PersonaArt } from "./Avatar";
import { SECTION_ICONS, type Persona } from "./personas";

/**
 * «Экран персонажа»: девять разделов паспорта — как слоты снаряжения.
 * Заполненный слот — сведения из легенды; пустой — честное «неизвестно», которое заполнят интервью и редактор.
 */

const ABILITIES = [
  { icon: MessagesSquare, t: "ИИ-интервью", d: "Раунды по 3–5 вопросов о пробелах" },
  { icon: Network, t: "Проверка целостности", d: "Противоречия между разделами" },
  { icon: FlaskConical, t: "Лаборатория", d: "Шесть групп испытаний" },
  { icon: Power, t: "Активация", d: "Только без critical-замечаний" },
];

export function CharacterScreen({ p }: { p: Persona }) {
  const firstFilled = p.slots.findIndex((s) => s.filled > 0);
  const [slot, setSlot] = useState(Math.max(0, firstFilled));
  useEffect(() => setSlot(Math.max(0, p.slots.findIndex((s) => s.filled > 0))), [p]);
  const cur = p.slots[slot]!;
  const style = { "--pc": p.look.c1 } as CSSProperties;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]" style={style}>
      {/* Карточка персонажа */}
      <div key={`card-${p.id}`} className="rp-card rp-swap overflow-hidden">
        <div className="relative aspect-[3/3.2] overflow-hidden">
          <PersonaArt look={p.look} focus="50% 12%" className="absolute inset-0 h-full w-full" />
          <span className="absolute left-4 top-4 rp-tag border-white/40 bg-black/25 text-white backdrop-blur">Черновик v1.0</span>
        </div>
        <div className="p-5">
          <div className="rp-kicker">{p.look.role}</div>
          <h3 className="rp-display mt-2 text-[28px]">{p.name}</h3>
          <p className="rp-small mt-2">{p.context}</p>
          <div className="mt-5 flex items-baseline justify-between">
            <span className="text-[13px] font-bold">Паспорт заполнен</span>
            <span className="font-[Unbounded] text-[15px] font-bold">
              {p.known}
              <span className="text-[color:var(--muted)]">/{p.total}</span>
            </span>
          </div>
          <div className="rp-seg mt-2" style={{ "--total": p.total } as CSSProperties} aria-hidden>
            {p.slots.flatMap((s) => s.fields).map((f, i) => (
              <span key={i} data-on={f.value !== null} style={{ "--i": i } as CSSProperties} />
            ))}
          </div>
          <p className="rp-small mt-3">
            Остальные {p.total - p.known} полей — «неизвестно». Система не дорисовывает их сама: их заполнят интервью и
            редактор.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Слоты */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="rp-kicker">Паспорт · 9 разделов</span>
            <span className="rp-small">нажмите на раздел</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {p.slots.map((s, i) => {
              const Icon = SECTION_ICONS[s.key] ?? Lock;
              return (
                <button
                  key={s.key}
                  type="button"
                  className="rp-slot"
                  data-filled={s.filled > 0}
                  aria-pressed={i === slot}
                  onClick={() => setSlot(i)}
                >
                  <span className="flex items-center justify-between">
                    <Icon className={clsx("h-5 w-5", s.filled ? "text-[color:var(--pc)]" : "text-[color:var(--muted)]")} />
                    <span className="flex gap-1">
                      {s.fields.map((f) => (
                        <span key={f.key} className="rp-pip" data-on={f.value !== null} />
                      ))}
                    </span>
                  </span>
                  <span className="text-[13.5px] font-bold leading-tight">{s.title}</span>
                  <span className="rp-small mt-auto !text-[12px]">{s.filled ? `${s.filled} из ${s.fields.length}` : "пусто — неизвестно"}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Содержимое слота */}
        <div key={`${p.id}-${slot}`} className="rp-card rp-swap p-5">
          <div className="rp-h3">{cur.title}</div>
          <dl className="mt-4 divide-y divide-[color:var(--line)]">
            {cur.fields.map((f) => (
              <div key={f.key} className="grid gap-1 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4">
                <dt className="text-[13px] font-semibold text-[color:var(--muted)]">{f.label}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-[15px]">
                  {f.value ? (
                    <>
                      <span>{f.value}</span>
                      {f.fromLegend && <span className="rp-tag !h-6 !text-[11px]">из легенды</span>}
                    </>
                  ) : (
                    <span className="italic text-[color:var(--muted)]">неизвестно</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Способности — откроются на этапе 2 */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="rp-kicker">Способности персонажа</span>
            <span className="rp-tag rp-tag--now" title="Запланировано, в разработке">
              Этап 2
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {ABILITIES.map((a) => (
              <div key={a.t} className="rp-locked p-4">
                <div className="flex items-center justify-between">
                  <a.icon className="h-5 w-5 text-[color:var(--muted)]" />
                  <Lock className="h-4 w-4 text-[color:var(--muted)]" />
                </div>
                <div className="mt-3 text-[13.5px] font-bold">{a.t}</div>
                <div className="rp-small mt-1 !text-[12.5px]">{a.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
