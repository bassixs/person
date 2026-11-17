import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, BookOpen, ClipboardList, Plug, Radar, UserPlus, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { Overview, PersonaListItem, Page } from "../api/types";
import { useAmbient } from "../components/Ambient";
import { ErrorState, Spinner, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
import { ACTION_LABEL, fmtDateTime } from "../lib/format";

function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon: ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <span className="label-mono">{label}</span>
        <span className="text-muted">{icon}</span>
      </div>
      <div className="mt-3 text-[28px] font-bold leading-none text-fg">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Pending({ label, iteration, icon }: { label: string; iteration: number; icon: ReactNode }) {
  return (
    <div className="panel border-dashed p-4">
      <div className="flex items-center justify-between">
        <span className="label-mono">{label}</span>
        <span className="text-muted/60">{icon}</span>
      </div>
      <div className="mt-3 text-sm font-medium text-muted">Модуль ещё не подключён</div>
      <div className="mt-1 font-mono text-[11px] text-muted/70">итерация {iteration}</div>
    </div>
  );
}

export function OverviewPage() {
  useAmbient("high");
  const { me, can } = useAuth();
  const ov = useQuery({ queryKey: ["overview"], queryFn: () => get<Overview>("/overview") });
  const drafts = useQuery({
    queryKey: ["personas", "attention"],
    queryFn: () => get<Page<PersonaListItem>>("/personas", { status: ["draft", "needs_revision"], page_size: 5 }),
    enabled: can("persona.read_all"),
  });

  const p = ov.data?.personas;
  const drafts_n = (p?.by_status.draft ?? 0) + (p?.by_status.needs_revision ?? 0);

  return (
    <div className="shell space-y-8">
      <section className="hero-glow relative overflow-hidden rounded-hero border border-line p-6 sm:p-10">
        <div className="label-mono text-accent/90">Рабочее пространство</div>
        <h1 className="mt-3 max-w-3xl text-[26px] font-bold leading-[1.1] text-fg sm:text-[34px]">
          Добрый день, {me?.display_name.split(" ")[0]}.
          <br />
          <span className="text-glow">Сайт настраивает, ИИ предлагает, редактор утверждает.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
          Аналитические персоны — вымышленные внутренние модели для поиска вопросов и различий восприятия. Они не
          заменяют реальных людей, источники фактов или опросы.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {can("persona.create") && (
            <Link to="/personas?new=1" className="btn-primary">
              <UserPlus className="h-4 w-4" /> Создать личность
            </Link>
          )}
          <Link to="/personas" className="btn-secondary">
            Каталог личностей <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/context" className="btn-secondary">
            Контекст
          </Link>
          <Link to="/tasks" className="btn-secondary">
            Задания
          </Link>
        </div>
      </section>

      {ov.isLoading && <Spinner />}
      {ov.error && <ErrorState error={ov.error} onRetry={() => ov.refetch()} />}

      {ov.data && (
        <>
          <section aria-label="Показатели" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
            <Stat
              label="Активные персоны"
              value={p?.with_active_version ?? "—"}
              hint="с утверждённой версией"
              icon={<Users className="h-4 w-4" />}
            />
            <Stat
              label="Черновики"
              value={p ? drafts_n : "—"}
              hint={p ? `всего в работе: ${p.total}` : "нет доступа"}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <Stat
              label="На согласовании"
              value={p?.by_status.pending_approval ?? 0}
              icon={<ClipboardList className="h-4 w-4" />}
            />
            <Pending label="Темы" iteration={ov.data.topics.iteration} icon={<BookOpen className="h-4 w-4" />} />
            <Pending label="Задания" iteration={ov.data.tasks.iteration} icon={<ClipboardList className="h-4 w-4" />} />
            <Pending label="Мониторинг" iteration={ov.data.monitoring.iteration} icon={<Radar className="h-4 w-4" />} />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="panel p-5 lg:col-span-2" aria-labelledby="attn">
              <h2 id="attn" className="text-base font-semibold text-fg">
                Требует внимания
              </h2>
              <p className="mt-1 text-sm text-muted">Черновики паспортов, ожидающие доработки.</p>
              <div className="mt-4 divide-y divide-line">
                {drafts.data?.items.map((d) => (
                  <Link
                    key={d.id}
                    to={`/personas/${d.id}`}
                    className="flex items-center gap-3 py-3 transition-colors hover:text-fg"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-fg-soft">{d.display_name}</div>
                      <div className="truncate text-xs text-muted">
                        Заполнено {d.completeness?.fields_filled ?? 0} из {d.completeness?.fields_total ?? 0} полей ·
                        проверка не запускалась
                      </div>
                    </div>
                    <StatusBadge status={d.status} />
                  </Link>
                ))}
                {drafts.data && drafts.data.items.length === 0 && (
                  <p className="py-6 text-sm text-muted">
                    Ничего не ждёт. Создайте первую личность или импортируйте семь исходных легенд как черновики
                    (см. README, команда seed-personas).
                  </p>
                )}
                {!can("persona.read_all") && (
                  <p className="py-6 text-sm text-muted">Вашей роли доступны только утверждённые персоны.</p>
                )}
              </div>
            </section>

            <section className="panel p-5" aria-labelledby="integr">
              <h2 id="integr" className="flex items-center gap-2 text-base font-semibold text-fg">
                <Plug className="h-4 w-4 text-muted" /> Подключения
              </h2>
              <ul className="mt-4 space-y-3">
                {ov.data.integrations.map((i) => (
                  <li key={i.name} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-fg-soft">{i.title}</span>
                    <span className={i.status === "configured" ? "text-warning" : "text-muted"}>
                      {i.status === "configured" ? "настроен, не проверен" : "не подключён"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">
                Без подключения ИИ-функции честно недоступны — система не показывает выдуманных результатов.
              </p>
            </section>
          </div>

          {ov.data.recent_events.length > 0 && (
            <section className="panel p-5" aria-labelledby="events">
              <h2 id="events" className="flex items-center gap-2 text-base font-semibold text-fg">
                <Activity className="h-4 w-4 text-muted" /> Последние события
              </h2>
              <ul className="mt-3 divide-y divide-line text-sm">
                {ov.data.recent_events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 py-2.5">
                    <span className="font-medium text-fg-soft">{e.actor?.display_name ?? "Система"}</span>
                    <span className="text-muted">{ACTION_LABEL[e.action] ?? e.action}</span>
                    {e.entity_version && <span className="font-mono text-xs text-muted">v{e.entity_version}</span>}
                    <span className="ml-auto font-mono text-xs text-muted">{fmtDateTime(e.occurred_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
