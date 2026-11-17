import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, ArchiveRestore, LayoutGrid, List, Plus, Search, Sparkles, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, get, post } from "../api/client";
import type { IntegrationStatus, Page, PersonaDetail, PersonaListItem, PersonaStatus } from "../api/types";
import { useAmbient } from "../components/Ambient";
import { EmptyState, ErrorState, Field, Modal, PageHeader, PersonaAvatar, PersonaCover, Spinner, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
import { fmtDate, STATUS_LABEL } from "../lib/format";

type Scope = "catalog" | "pending" | "archive";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "catalog", label: "Каталог" },
  { key: "pending", label: "Ожидают проверки" },
  { key: "archive", label: "Архив" },
];
const FILTERABLE: PersonaStatus[] = ["draft", "needs_revision", "pending_approval", "active", "suspended"];

function readView(): "cards" | "table" {
  try {
    return localStorage.getItem("personas.view") === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function VersionLabel({ p }: { p: PersonaListItem }) {
  return (
    <span className="font-mono text-xs text-muted">
      {p.active_version ? `v${p.active_version.label}` : ""}
      {p.active_version && p.draft_version ? " · " : ""}
      {p.draft_version ? `черновик v${p.draft_version.label}` : ""}
    </span>
  );
}

function Completeness({ p }: { p: PersonaListItem }) {
  if (!p.completeness) return null;
  const { fields_filled: f, fields_total: t } = p.completeness;
  return (
    <div className="flex items-center gap-2" title="Поля с определённым или гипотетическим значением">
      <div className="h-1 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-accent/80" style={{ width: `${(f / t) * 100}%` }} />
      </div>
      <span className="font-mono text-[11px] text-muted">
        {f}/{t}
      </span>
    </div>
  );
}

function ArchiveButton({ p }: { p: PersonaListItem }) {
  const qc = useQueryClient();
  const archived = p.status === "archived";
  const m = useMutation({
    mutationFn: () => post(`/personas/${p.id}/${archived ? "unarchive" : "archive"}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personas"] }),
  });
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={(e) => {
        e.preventDefault();
        if (archived || window.confirm(`Отправить «${p.display_name}» в архив? Действие обратимо.`)) m.mutate();
      }}
      disabled={m.isPending}
      aria-label={archived ? "Вернуть из архива" : "В архив"}
      title={archived ? "Вернуть из архива" : "В архив"}
    >
      {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
    </button>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"manual" | "legend" | "ai_draft">("manual");
  const [name, setName] = useState("");
  const [ctx, setCtx] = useState("");
  const [legend, setLegend] = useState("");
  const integ = useQuery({ queryKey: ["integrations"], queryFn: () => get<IntegrationStatus[]>("/integrations/status") });
  const llm = integ.data?.find((i) => i.name === "llm");
  const m = useMutation({
    mutationFn: () =>
      post<PersonaDetail>("/personas", {
        display_name: name,
        short_context: ctx,
        mode,
        legend_text: mode === "legend" ? legend : undefined,
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["personas"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      onOpenChange(false);
      nav(`/personas/${p.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const modes = [
    { key: "manual" as const, title: "Вручную", text: "Пустой гибридный паспорт: всё неизвестно, пока вы не заполните." },
    { key: "legend" as const, title: "Из легенды", text: "Краткая легенда сохраняется неизменяемым исходным материалом." },
    {
      key: "ai_draft" as const,
      title: "ИИ-черновик",
      text: llm?.status === "configured" ? "Предложения ИИ появятся в итерации 2." : "LLM не подключён — недоступно.",
      disabled: true,
    },
  ];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Новая личность" description="Создаётся черновик версии 1.0. Активация — только после проверок." wide>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Способ создания">
          {modes.map((md) => (
            <button
              key={md.key}
              type="button"
              role="radio"
              aria-checked={mode === md.key}
              disabled={md.disabled}
              onClick={() => setMode(md.key)}
              className={clsx(
                "rounded-ui border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === md.key ? "border-accent/70 bg-accent/10" : "border-line-strong hover:border-muted/60",
              )}
            >
              <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                {md.key === "ai_draft" && <Sparkles className="h-3.5 w-3.5 text-accent" />}
                {md.title}
              </div>
              <div className="mt-1 text-xs leading-snug text-muted">{md.text}</div>
            </button>
          ))}
        </div>
        <Field label="Имя вымышленной персоны" htmlFor="pn">
          <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus />
        </Field>
        <Field label="Краткий контекст" hint="Строка для каталога. Можно изменить позже." htmlFor="pc">
          <input id="pc" className="input" value={ctx} onChange={(e) => setCtx(e.target.value)} maxLength={2000} />
        </Field>
        {mode === "legend" && (
          <Field label="Исходная легенда" hint="Будет сохранена как неизменяемый материал. Неизвестное не домысливается." htmlFor="pl">
            <textarea id="pl" className="input min-h-[120px]" value={legend} onChange={(e) => setLegend(e.target.value)} required />
          </Field>
        )}
        {m.error && (
          <p className="text-sm text-danger" role="alert">
            {(m.error as ApiError).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || m.isPending || (mode === "legend" && !legend.trim())}>
            {m.isPending ? "Создание…" : "Создать черновик"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PersonasPage() {
  useAmbient("low");
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q);
  const scope = (params.get("scope") as Scope) || "catalog";
  const statusFilter = params.getAll("status") as PersonaStatus[];
  const sort = params.get("sort") ?? "updated_desc";
  const [view, setView] = useState<"cards" | "table">(readView);
  const [createOpen, setCreateOpen] = useState(params.get("new") === "1" && can("persona.create"));

  // Синхронизация с URL (например, переход из глобального поиска), не мешая набору текста.
  useEffect(() => {
    const fromUrl = params.get("q") ?? "";
    if (fromUrl !== dq) setQ(fromUrl);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (dq) next.set("q", dq);
    else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveStatus =
    scope === "archive" ? ["archived"] : scope === "pending" ? ["pending_approval"] : statusFilter.length ? statusFilter : undefined;

  const list = useQuery({
    queryKey: ["personas", "list", dq, scope, statusFilter.join(","), sort],
    queryFn: () => get<Page<PersonaListItem>>("/personas", { q: dq, status: effectiveStatus, sort, page_size: 200 }),
    placeholderData: (prev) => prev,
  });

  const setParam = (k: string, v: string | string[] | null) => {
    const next = new URLSearchParams(params);
    next.delete(k);
    if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
    else if (v) next.set(k, v);
    setParams(next, { replace: true });
  };
  const toggleStatus = (s: PersonaStatus) =>
    setParam("status", statusFilter.includes(s) ? statusFilter.filter((x) => x !== s) : [...statusFilter, s]);
  const switchView = (v: "cards" | "table") => {
    setView(v);
    try {
      localStorage.setItem("personas.view", v);
    } catch {
      /* хранилище недоступно — вид не запоминается */
    }
  };

  const items = list.data?.items ?? [];

  return (
    <div className="shell">
      <PageHeader
        eyebrow="Личности"
        title="Аналитические персоны"
        description="Вымышленные внутренние модели. Каждая проходит цикл: легенда → паспорт → интервью → проверки → активация редактором."
        actions={
          can("persona.create") && (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Создать личность
            </button>
          )
        }
      />

      <nav className="mb-5 flex gap-1 border-b border-line" aria-label="Подразделы личностей">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setParam("scope", s.key === "catalog" ? null : s.key)}
            aria-current={scope === s.key ? "page" : undefined}
            className={clsx("relative px-3 pb-2.5 pt-1 text-sm font-medium", scope === s.key ? "text-fg" : "text-muted hover:text-fg-soft")}
          >
            {s.label}
            {scope === s.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </nav>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input pl-9" placeholder="Имя или контекст…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по каталогу" />
        </div>
        {scope === "catalog" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по статусу">
            {FILTERABLE.map((s) => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                aria-pressed={statusFilter.includes(s)}
                className={clsx(
                  "chip transition-colors",
                  statusFilter.includes(s) ? "border-accent/60 bg-accent/10 text-fg" : "text-muted hover:text-fg-soft",
                )}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 lg:ml-auto">
          <select className="input h-9 w-auto py-1" value={sort} onChange={(e) => setParam("sort", e.target.value)} aria-label="Сортировка">
            <option value="updated_desc">Недавно изменённые</option>
            <option value="created_desc">Недавно созданные</option>
            <option value="name_asc">По имени</option>
          </select>
          <div className="flex rounded-ui border border-line-strong p-0.5" role="group" aria-label="Вид">
            <button className={clsx("btn-sm btn px-2", view === "cards" ? "bg-elevated text-fg" : "text-muted")} onClick={() => switchView("cards")} aria-pressed={view === "cards"} aria-label="Карточки">
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button className={clsx("btn-sm btn px-2", view === "table" ? "bg-elevated text-fg" : "text-muted")} onClick={() => switchView("table")} aria-pressed={view === "table"} aria-label="Таблица">
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {list.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-40" />
          ))}
        </div>
      )}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}

      {list.data && items.length === 0 && (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={dq || statusFilter.length ? "Ничего не найдено" : scope === "archive" ? "Архив пуст" : scope === "pending" ? "Нет персон на согласовании" : "Пока нет ни одной личности"}
          action={
            !dq && scope === "catalog" && can("persona.create") ? (
              <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Создать первую
              </button>
            ) : undefined
          }
        >
          {dq || statusFilter.length
            ? "Измените запрос или сбросьте фильтры."
            : scope === "catalog"
              ? can("persona.read_all")
                ? "Создайте личность вручную или из краткой легенды. Семь исходных легенд можно импортировать как черновики командой seed-personas."
                : "Утверждённых персон пока нет."
              : null}
        </EmptyState>
      )}

      {items.length > 0 && (
        <p className="mb-3 font-mono text-xs text-muted" aria-live="polite">
          Найдено: {list.data?.total}
        </p>
      )}

      {items.length > 0 && view === "cards" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <Link
              key={p.id}
              to={`/personas/${p.id}`}
              className="panel group flex flex-col overflow-hidden transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_20px_40px_-28px_rgb(20_20_20/0.45)]"
            >
              <PersonaCover name={p.display_name} className="h-44" />
              <div className="flex flex-1 flex-col p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-fg">{p.display_name}</div>
                  <VersionLabel p={p} />
                </div>
                {can("persona.archive") && <ArchiveButton p={p} />}
              </div>
              <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{p.short_context || "Без описания"}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <StatusBadge status={p.status} />
                {p.is_seed && <span className="chip border-line text-muted">исходная легенда</span>}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                <Completeness p={p} />
                <span title="Проверки согласованности появятся в итерации 2">
                  {p.open_issues === null ? "проверка не запускалась" : `замечаний: ${p.open_issues}`}
                </span>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted/80">
                <span>{p.created_by?.display_name ?? "—"}</span>
                <span>изм. {fmtDate(p.updated_at)}</span>
              </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {items.length > 0 && view === "table" && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line">
              <tr className="label-mono">
                <th className="px-4 py-3 font-normal">Имя</th>
                <th className="px-4 py-3 font-normal">Статус</th>
                <th className="px-4 py-3 font-normal">Версия</th>
                <th className="px-4 py-3 font-normal">Заполненность</th>
                <th className="px-4 py-3 font-normal">Замечания</th>
                <th className="px-4 py-3 font-normal">Автор</th>
                <th className="px-4 py-3 font-normal">Изменена</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-elevated/50">
                  <td className="px-4 py-2.5">
                    <Link to={`/personas/${p.id}`} className="flex items-center gap-2.5 font-medium text-fg hover:text-accent">
                      <PersonaAvatar name={p.display_name} size={28} />
                      {p.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <VersionLabel p={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Completeness p={p} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{p.open_issues === null ? "не проверялась" : p.open_issues}</td>
                  <td className="px-4 py-2.5 text-muted">{p.created_by?.display_name ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{fmtDate(p.updated_at)}</td>
                  <td className="px-2 py-2.5">{can("persona.archive") && <ArchiveButton p={p} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.isFetching && !list.isLoading && (
        <div className="fixed bottom-4 right-4 z-30">
          <Spinner label="Обновление…" />
        </div>
      )}

      {can("persona.create") && <CreateDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  );
}
