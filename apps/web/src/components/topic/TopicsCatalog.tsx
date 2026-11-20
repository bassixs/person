import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BookOpen, Plus, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, get, post } from "../../api/client";
import type { Page, TopicDetail, TopicListItem, TopicStatus } from "../../api/types";
import { useAuth } from "../../lib/auth";
import { fmtDate, TOPIC_STATUS_LABEL } from "../../lib/format";
import { EmptyState, ErrorState, Field, Modal, Spinner } from "../ui";

const TONE: Record<TopicStatus, string> = {
  draft: "border-line-strong text-fg-soft",
  under_review: "border-info/40 text-info",
  active: "border-success/40 text-success",
  needs_update: "border-warning/40 text-warning",
  suspended: "border-warning/40 text-warning",
  archived: "border-line text-muted",
};

export function TopicStatusBadge({ status }: { status: TopicStatus }) {
  return (
    <span className={clsx("chip font-medium", TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {TOPIC_STATUS_LABEL[status]}
    </span>
  );
}

const FILTERS: TopicStatus[] = ["draft", "under_review", "active", "needs_update", "suspended", "archived"];

function CreateTopic({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [geo, setGeo] = useState("");
  const [cat, setCat] = useState("");
  const [summary, setSummary] = useState("");
  const m = useMutation({
    mutationFn: () => post<TopicDetail>("/topics", { title, geography: geo, category: cat, summary }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["topics"] });
      onOpenChange(false);
      nav(`/context/topics/${t.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Новая тема" description="Создаётся черновик досье v1.0. Утверждает редактор.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Название события или вопроса" htmlFor="tt">
          <input id="tt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={300} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="География" htmlFor="tg">
            <input id="tg" className="input" value={geo} onChange={(e) => setGeo(e.target.value)} maxLength={300} placeholder="район, населённый пункт" />
          </Field>
          <Field label="Категория" htmlFor="tc">
            <input id="tc" className="input" value={cat} onChange={(e) => setCat(e.target.value)} maxLength={100} placeholder="дороги, ЖКХ, транспорт…" />
          </Field>
        </div>
        <Field label="Суть" hint="Коротко, своими словами. Можно заполнить позже." htmlFor="ts">
          <textarea id="ts" className="input min-h-[90px]" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={8000} />
        </Field>
        {m.error && (
          <p className="text-sm text-danger" role="alert">
            {(m.error as ApiError).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={title.trim().length < 3 || m.isPending}>
            {m.isPending ? "Создание…" : "Создать черновик"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TopicsCatalog() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState<TopicStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ["topics", dq, status],
    queryFn: () => get<Page<TopicListItem>>("/topics", { q: dq, status: status || undefined, page_size: 200 }),
  });
  const items = list.data?.items ?? [];
  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Название, география, категория" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск тем" />
          </div>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as TopicStatus | "")} aria-label="Статус">
            <option value="">Все, кроме архива</option>
            {FILTERS.map((s) => (
              <option key={s} value={s}>
                {TOPIC_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {can("topic.create") && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Новая тема
          </button>
        )}
      </div>

      {list.isLoading && <Spinner />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title={dq || status ? "Ничего не найдено" : "Пока нет ни одной темы"}
          action={
            !dq && !status && can("topic.create") ? (
              <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Создать первую
              </button>
            ) : undefined
          }
        >
          {dq || status
            ? "Измените запрос или фильтр."
            : "Тема — досье реального события: суть, утверждения с источниками, вопросы жителей, неизвестное. Понимание ИИ не равно проверке фактов: подтверждает редактор."}
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line">
              <tr className="label-mono">
                <th className="px-4 py-3 font-normal">Тема</th>
                <th className="px-4 py-3 font-normal">Статус</th>
                <th className="px-4 py-3 font-normal">Версия</th>
                <th className="px-4 py-3 font-normal">Утверждения</th>
                <th className="px-4 py-3 font-normal">Неизвестно</th>
                <th className="px-4 py-3 font-normal">Изменена</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-elevated/50">
                  <td className="px-4 py-2.5">
                    <Link to={`/context/topics/${t.id}`} className="font-medium text-fg hover:text-accent">
                      {t.title}
                    </Link>
                    <div className="text-xs text-muted">{[t.geography, t.category].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <TopicStatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">
                    {t.active_version ? `v${t.active_version.label}` : ""}
                    {t.active_version && t.draft_version ? " · " : ""}
                    {t.draft_version ? `черновик v${t.draft_version.label}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {t.counts ? (
                      <span className="text-muted">
                        <span className="text-success">{t.counts.verified}</span> из {t.counts.claims} подтверждено
                        {t.counts.unsafe > 0 && <span className="ml-1.5 text-warning">· {t.counts.unsafe} небезопасно</span>}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{t.counts?.open_questions ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{fmtDate(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {can("topic.create") && <CreateTopic open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  );
}
