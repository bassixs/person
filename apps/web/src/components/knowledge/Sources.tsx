import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ExternalLink, Globe, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { ApiError, get, patch, post } from "../../api/client";
import type { SourceFetchOut, SourceOut } from "../../api/types";
import { useAuth } from "../../lib/auth";
import { fmtBytes, fmtDateTime, SOURCE_KIND_LABEL } from "../../lib/format";
import { EmptyState, ErrorState, Field, Modal, Spinner } from "../ui";

const INTERVAL_LABEL: Record<string, string> = { none: "вручную", "4h": "каждые 4 часа", daily: "ежедневно", weekly: "еженедельно" };
const METHOD_LABEL: Record<string, string> = { manual: "вручную", web: "веб-страница", rss: "RSS", api: "API" };

type Form = Omit<SourceOut, "id" | "last_checked_at" | "last_ok_at" | "last_error" | "items_count" | "created_by" | "created_at" | "updated_at">;

const blank: Form = {
  name: "",
  url: "",
  kind: "official",
  geography: "",
  topics: "",
  access_method: "web",
  access_notes: "",
  priority: 3,
  check_interval: "none",
  status: "active",
};

function SourceDialog({ initial, onClose }: { initial: SourceOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(initial ? { ...initial } : blank);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({
    mutationFn: () => (initial ? patch(`/sources/${initial.id}`, f) : post("/sources", f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial ? "Источник" : "Новый источник"} description="Приоритет помогает расставить порядок проверки, но не заменяет установление достоверности." wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Название" htmlFor="sn">
            <input id="sn" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={300} autoFocus />
          </Field>
          <Field label="Ссылка" htmlFor="su">
            <input id="su" className="input" value={f.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" maxLength={2000} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Тип" htmlFor="sk">
            <select id="sk" className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
              {Object.entries(SOURCE_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Способ получения" htmlFor="sm">
            <select id="sm" className="input" value={f.access_method} onChange={(e) => set("access_method", e.target.value)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Приоритет" htmlFor="sp">
            <select id="sp" className="input" value={f.priority} onChange={(e) => set("priority", Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="География" htmlFor="sg">
            <input id="sg" className="input" value={f.geography} onChange={(e) => set("geography", e.target.value)} maxLength={300} />
          </Field>
          <Field label="Тематика" htmlFor="st">
            <input id="st" className="input" value={f.topics} onChange={(e) => set("topics", e.target.value)} maxLength={1000} placeholder="дороги, ЖКХ" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Период проверки" hint="Плановые проверки — с мониторингом (итерация 4)" htmlFor="si">
            <select id="si" className="input" value={f.check_interval} onChange={(e) => set("check_interval", e.target.value)}>
              {Object.entries(INTERVAL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Состояние" htmlFor="ss">
            <select id="ss" className="input" value={f.status} onChange={(e) => set("status", e.target.value as "active" | "disabled")}>
              <option value="active">активен</option>
              <option value="disabled">отключён</option>
            </select>
          </Field>
        </div>
        <Field label="Ограничения доступа" hint="Что разрешено и что нельзя: закрытые разделы, правила площадки" htmlFor="sa">
          <textarea id="sa" className="input min-h-[60px]" value={f.access_notes} onChange={(e) => set("access_notes", e.target.value)} maxLength={4000} />
        </Field>
        {m.error && (
          <p className="text-sm text-danger" role="alert">
            {(m.error as ApiError).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={f.name.trim().length < 2 || m.isPending}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FetchHistory({ id }: { id: string }) {
  const h = useQuery({ queryKey: ["sources", id, "fetches"], queryFn: () => get<SourceFetchOut[]>(`/sources/${id}/fetches`) });
  if (h.isLoading) return <Spinner />;
  if (!h.data?.length) return <p className="text-xs text-muted">Обращений ещё не было.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {h.data.map((r) => (
        <li key={r.id} className={r.ok ? "text-fg-soft" : "text-danger"}>
          <span className="font-mono text-muted">{fmtDateTime(r.created_at)}</span> · {r.purpose === "check" ? "проверка" : "импорт"} ·{" "}
          {r.ok ? `ответ ${r.http_status}, ${fmtBytes(r.bytes)}, ${r.duration_ms} мс` : r.error}
        </li>
      ))}
    </ul>
  );
}

export function SourcesRegistry() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("source.manage");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [editing, setEditing] = useState<SourceOut | null | "new">(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({ queryKey: ["sources", dq], queryFn: () => get<SourceOut[]>("/sources", { q: dq }) });
  const check = useMutation({
    mutationFn: (id: string) => post<SourceFetchOut>(`/sources/${id}/check`),
    onSettled: (_d, _e, id) => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      setExpanded(id);
    },
  });
  const items = list.data ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Название, ссылка, география" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск источников" />
        </div>
        {manage && (
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Источник
          </button>
        )}
      </div>
      {list.isLoading && <Spinner />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState icon={<Globe className="h-8 w-8" />} title={dq ? "Ничего не найдено" : "Реестр пуст"}>
          {dq ? "Измените запрос." : "Боевой список источников заполняет редактор. Фиктивные источники система не создаёт."}
        </EmptyState>
      )}
      {items.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line">
              <tr className="label-mono">
                <th className="px-4 py-3 font-normal">Источник</th>
                <th className="px-4 py-3 font-normal">Тип</th>
                <th className="px-4 py-3 font-normal">Приоритет</th>
                <th className="px-4 py-3 font-normal">Материалов</th>
                <th className="px-4 py-3 font-normal">Последняя проверка</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((s) => (
                <Fragment key={s.id}>
                  <tr className={clsx("transition-colors hover:bg-elevated/50", s.status === "disabled" && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <button className="text-left font-medium text-fg hover:text-accent" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                        {s.name}
                      </button>
                      <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-accent">
                            {s.url.replace(/^https?:\/\//, "").slice(0, 48)} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {s.geography && <span>{s.geography}</span>}
                        {s.status === "disabled" && <span className="text-warning">отключён</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {SOURCE_KIND_LABEL[s.kind] ?? s.kind}
                      <div>{METHOD_LABEL[s.access_method]}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{s.priority}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{s.items_count}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {s.last_checked_at ? (
                        <>
                          <span className="font-mono text-muted">{fmtDateTime(s.last_checked_at)}</span>
                          <div className={s.last_error ? "text-danger" : "text-success"}>{s.last_error ?? "доступен"}</div>
                        </>
                      ) : (
                        <span className="text-muted">не проверялся</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {manage && (
                        <div className="flex justify-end gap-1">
                          {s.url && s.status === "active" && (
                            <button className="btn-ghost btn-sm" onClick={() => check.mutate(s.id)} disabled={check.isPending && check.variables === s.id} title="Проверить соединение" aria-label="Проверить соединение">
                              <RefreshCw className={clsx("h-4 w-4", check.isPending && check.variables === s.id && "animate-spin")} />
                            </button>
                          )}
                          <button className="btn-ghost btn-sm" onClick={() => setEditing(s)} title="Править" aria-label="Править">
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expanded === s.id && (
                    <tr>
                      <td colSpan={6} className="bg-elevated/40 px-4 py-3">
                        {s.topics && <p className="mb-1 text-xs text-muted">Тематика: {s.topics}</p>}
                        {s.access_notes && <p className="mb-2 text-xs text-muted">Ограничения: {s.access_notes}</p>}
                        <FetchHistory id={s.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SourceDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
