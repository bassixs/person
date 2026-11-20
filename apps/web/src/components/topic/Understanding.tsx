import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Brain, Check, CheckCircle2, CircleHelp, Plus, Quote } from "lucide-react";
import { useState } from "react";
import { ApiError, get, post } from "../../api/client";
import type { TopicDetail } from "../../api/types";
import { fmtDateTime, plural } from "../../lib/format";
import { EmptyState, Spinner } from "../ui";

interface Ref {
  item_id: string;
  title: string;
  quote: string;
  quote_found: boolean;
}
interface Card {
  summary: string;
  known_facts: { text: string; refs: Ref[] }[];
  unverified_claims: { text: string; reason: string }[];
  conflicts: { text: string; refs: Ref[] }[];
  open_questions: string[];
  gaps: string[];
  understood: boolean;
  understood_reason: string;
  sources: { ref: string; item_id: string; title: string; truncated: boolean }[];
}
interface Run {
  id: string;
  version_id: string;
  status: "queued" | "running" | "done" | "failed";
  model: string | null;
  card: Card | null;
  materials: { ref: string; item_id: string; title: string }[];
  error: string | null;
  is_current: boolean;
  started_by: { display_name: string } | null;
  created_at: string;
  finished_at: string | null;
}
interface Overview {
  available: boolean;
  materials_count: number;
  has_draft: boolean;
  latest: Run | null;
}

type Kind = "fact" | "unverified" | "conflict" | "question" | "gap";

function Refs({ refs }: { refs: Ref[] }) {
  if (!refs.length) return <p className="mt-1 text-xs text-muted">Без ссылки на материал</p>;
  return (
    <ul className="mt-1.5 space-y-1">
      {refs.map((r, i) => (
        <li key={i} className="text-xs">
          <span className="inline-flex items-start gap-1 text-fg-soft">
            <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
            <span>
              «{r.quote}» — <span className="text-muted">{r.title}</span>{" "}
              {r.quote_found ? (
                <span className="text-success">цитата найдена</span>
              ) : (
                <span className="text-danger">цитата не найдена в материале</span>
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function UnderstandingPanel({ topic, draftId, editable }: { topic: TopicDetail; draftId: string | null; editable: boolean }) {
  const qc = useQueryClient();
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const ov = useQuery({
    queryKey: ["topic-understanding", topic.id],
    queryFn: () => get<Overview>(`/topics/${topic.id}/understanding`),
    refetchInterval: (q) => (q.state.data?.latest && ["queued", "running"].includes(q.state.data.latest.status) ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: () => post(`/topics/${topic.id}/understanding`),
    onSuccess: () => {
      setApplied(new Set());
      qc.invalidateQueries({ queryKey: ["topic-understanding", topic.id] });
    },
  });
  const apply = useMutation({
    mutationFn: ({ kind, index }: { kind: Kind; index: number }) => post(`/topics/${topic.id}/understanding/${ov.data!.latest!.id}/apply`, { kind, index }),
    onSuccess: (_d, v) => {
      setApplied((s) => new Set(s).add(`${v.kind}:${v.index}`));
      qc.invalidateQueries({ queryKey: ["topic-version", topic.id] });
      qc.invalidateQueries({ queryKey: ["topic", topic.id] });
      qc.invalidateQueries({ queryKey: ["topic-understanding", topic.id] });
      qc.invalidateQueries({ queryKey: ["topic-history", topic.id] });
    },
  });

  if (ov.isLoading) return <Spinner />;
  const o = ov.data;
  if (!o) return null;
  const run = o.latest;
  const busy = !!run && (run.status === "queued" || run.status === "running");
  const card = run?.status === "done" ? run.card : null;
  const canApply = editable && !!run && run.version_id === draftId;

  const ApplyBtn = ({ kind, index, label }: { kind: Kind; index: number; label: string }) => {
    if (!canApply) return null;
    const done = applied.has(`${kind}:${index}`);
    return (
      <button
        className={clsx("btn-ghost btn-sm shrink-0", done && "text-success")}
        disabled={done || apply.isPending}
        onClick={() => apply.mutate({ kind, index })}
        title={label}
      >
        {done ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {done ? "в черновике" : label}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="text-fg">
            ИИ читает досье и {o.materials_count} {plural(o.materials_count, "материал", "материала", "материалов")} темы и объясняет, что понял. Понимание не равно проверке фактов.
          </p>
          <p className="mt-1 text-xs text-muted">Цитаты сверяются с текстом материалов сервером. В досье ничего не попадает без вашего решения.</p>
        </div>
        {editable && o.has_draft && (
          <button className="btn-primary shrink-0" onClick={() => start.mutate()} disabled={!o.available || busy || start.isPending} title={o.available ? undefined : "ИИ не подключён"}>
            <Brain className="h-4 w-4" /> {busy ? "Разбор идёт…" : run ? "Разобрать заново" : "Разобрать тему"}
          </button>
        )}
      </div>
      {!o.available && <p className="text-sm text-warning">ИИ не подключён: карточка понимания недоступна.</p>}
      {start.error && <p className="text-sm text-danger">{(start.error as ApiError).message}</p>}
      {apply.error && <p className="text-sm text-danger">{(apply.error as ApiError).message}</p>}

      {!run && o.available && (
        <EmptyState icon={<Brain className="h-8 w-8" />} title="Карточки пока нет">
          Добавьте материалы во вкладке «Материалы» и запустите разбор. Можно и без материалов — тогда ИИ честно перечислит пробелы.
        </EmptyState>
      )}
      {busy && <Spinner label="ИИ разбирает тему… обычно до минуты" />}
      {run?.status === "failed" && <p className="text-sm text-danger">Разбор не удался: {run.error}</p>}

      {card && run && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={clsx("chip", run.is_current ? "border-success/40 text-success" : "border-warning/40 text-warning")}>
              {run.is_current ? "актуальна" : "устарела: досье или материалы изменились"}
            </span>
            <span className={clsx("chip", card.understood ? "border-success/40 text-success" : "border-warning/40 text-warning")}>
              {card.understood ? "суть понятна" : "суть не ясна"}
            </span>
            <span className="font-mono text-muted">
              {run.model} · {run.finished_at && fmtDateTime(run.finished_at)}
            </span>
          </div>
          <section className="panel p-4">
            <h3 className="mb-1.5 text-sm font-semibold text-fg">Суть</h3>
            <p className="text-sm leading-relaxed text-fg-soft">{card.summary || "—"}</p>
            {card.understood_reason && <p className="mt-2 text-xs text-muted">{card.understood_reason}</p>}
          </section>

          <section className="panel p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
              <CheckCircle2 className="h-4 w-4 text-success" /> Известные факты · {card.known_facts.length}
            </h3>
            <p className="mb-2 text-xs text-muted">Перенос создаёт утверждение «не проверено». Подтверждает редактор, сверив источник.</p>
            <ul className="space-y-3">
              {card.known_facts.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm text-fg">{f.text}</p>
                    <Refs refs={f.refs} />
                  </div>
                  <ApplyBtn kind="fact" index={i} label="в утверждения" />
                </li>
              ))}
            </ul>
          </section>

          {card.unverified_claims.length > 0 && (
            <section className="panel p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <CircleHelp className="h-4 w-4 text-warning" /> Не подтверждено материалами
              </h3>
              <ul className="space-y-2">
                {card.unverified_claims.map((u, i) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <div className="text-sm">
                      <p className="text-fg">{u.text}</p>
                      {u.reason && <p className="text-xs text-muted">{u.reason}</p>}
                    </div>
                    <ApplyBtn kind="unverified" index={i} label="в утверждения" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {card.conflicts.length > 0 && (
            <section className="panel border-warning/40 p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <AlertTriangle className="h-4 w-4 text-warning" /> Противоречия
              </h3>
              <ul className="space-y-3">
                {card.conflicts.map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-fg">{c.text}</p>
                      <Refs refs={c.refs} />
                    </div>
                    <ApplyBtn kind="conflict" index={i} label="в досье" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-4">
              <h3 className="mb-2 text-sm font-semibold text-fg">Открытые вопросы</h3>
              {card.open_questions.length === 0 && <p className="text-xs text-muted">Нет.</p>}
              <ul className="space-y-1.5">
                {card.open_questions.map((q, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-sm text-fg-soft">
                    <span>{q}</span>
                    <ApplyBtn kind="question" index={i} label="в вопросы" />
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel p-4">
              <h3 className="mb-2 text-sm font-semibold text-fg">Пробелы</h3>
              {card.gaps.length === 0 && <p className="text-xs text-muted">Нет.</p>}
              <ul className="space-y-1.5">
                {card.gaps.map((g, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-sm text-fg-soft">
                    <span>{g}</span>
                    <ApplyBtn kind="gap" index={i} label="в неизвестное" />
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {card.sources.length > 0 && (
            <section className="text-xs text-muted">
              Материалы разбора:{" "}
              {card.sources.map((s, i) => (
                <span key={s.item_id}>
                  {i > 0 && ", "}
                  {s.title}
                  {s.truncated && " (обрезан по объёму)"}
                </span>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
