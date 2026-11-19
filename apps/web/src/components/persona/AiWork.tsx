import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Bot, Check, CircleSlash, HelpCircle, Pencil, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, get, post } from "../../api/client";
import type {
  AnswerKind,
  DecisionOut,
  Interview,
  PassportSchema,
  PersonaDetail,
  Proposal,
  VersionDetail,
} from "../../api/types";
import { fmtDateTime, plural } from "../../lib/format";
import { EmptyState, ErrorState, Spinner } from "../ui";

/*
 * Итерация 2: ИИ-интервью и очередь предложений (ТЗ §3).
 * ИИ ничего не пишет в паспорт сам — всё проходит через решение редактора на сервере.
 */

export function fieldMeta(sch: PassportSchema, path: string) {
  const [sk, fk] = path.split(".");
  const sec = sch.sections.find((s) => s.key === sk);
  if (fk === "narrative") return { section: sec?.title ?? sk, label: "Описание раздела", type: "longtext" as const };
  const f = sec?.fields.find((x) => x.key === fk);
  return { section: sec?.title ?? sk, label: f?.label ?? fk, type: f?.type ?? "text" };
}

function ValueView({ value, muted }: { value: string | string[] | null; muted?: boolean }) {
  if (value === null || (Array.isArray(value) && value.length === 0) || value === "")
    return <span className="italic text-muted">неизвестно</span>;
  if (Array.isArray(value))
    return (
      <span className="flex flex-wrap gap-1.5">
        {value.map((x) => (
          <span key={x} className={clsx("chip", muted ? "text-muted" : "border-fg/25 text-fg")}>
            {x}
          </span>
        ))}
      </span>
    );
  return <span className={clsx("whitespace-pre-wrap", muted && "text-muted")}>{value}</span>;
}

const CERT_LABEL = { defined: "Определено", hypothesis: "Гипотеза" } as const;
const STATUS_LABEL = { pending: "Ожидает решения", accepted: "Принято", rejected: "Отклонено", stale: "Устарело" } as const;

function errText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "revision_conflict") return "Черновик изменился — обновите страницу и повторите.";
    return e.message;
  }
  return "Не удалось выполнить действие";
}

/* ---------------- Предложения ---------------- */

function ProposalCard({
  pr,
  sch,
  persona,
  version,
  canDecide,
  blockedReason,
}: {
  pr: Proposal;
  sch: PassportSchema;
  persona: PersonaDetail;
  version: VersionDetail;
  canDecide: boolean;
  blockedReason: string | null;
}) {
  const qc = useQueryClient();
  const meta = fieldMeta(sch, pr.field_path);
  const isList = meta.type === "tags";
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [val, setVal] = useState(Array.isArray(pr.proposed_value) ? pr.proposed_value.join(", ") : pr.proposed_value);
  const [cert, setCert] = useState<"defined" | "hypothesis">(pr.proposed_certainty);
  const [note, setNote] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["proposals", persona.id] });
    qc.invalidateQueries({ queryKey: ["persona", persona.id] });
    qc.invalidateQueries({ queryKey: ["persona-version", version.id] });
    qc.invalidateQueries({ queryKey: ["persona-history", persona.id] });
    qc.invalidateQueries({ queryKey: ["personas"] });
  };
  const accept = useMutation({
    mutationFn: (edited: boolean) =>
      post<DecisionOut>(`/personas/${persona.id}/proposals/${pr.id}/accept`, {
        expected_revision: version.revision,
        ...(edited
          ? {
              value: isList
                ? val
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                : val,
              certainty: cert,
              note: note || undefined,
            }
          : {}),
      }),
    onSuccess: refresh,
    onError: refresh,
  });
  const reject = useMutation({
    mutationFn: () => post<Proposal>(`/personas/${persona.id}/proposals/${pr.id}/reject`, { note: note || undefined }),
    onSuccess: refresh,
  });
  const busy = accept.isPending || reject.isPending;
  const open = pr.status === "pending" || pr.status === "stale";

  return (
    <article className={clsx("panel overflow-hidden", pr.status === "pending" && "border-line-strong")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="label-mono">{meta.section}</div>
          <div className="mt-0.5 font-semibold text-fg">{meta.label}</div>
        </div>
        <span className="chip border-line-strong text-xs text-fg-soft">
          {pr.origin === "interview" ? "из интервью" : pr.origin === "deepen" ? "углубление" : pr.origin}
        </span>
        <span
          className={clsx(
            "chip text-xs",
            pr.status === "pending" && "border-accent/50 bg-accent/10 text-accent",
            pr.status === "accepted" && "border-success/40 bg-success/10 text-success",
            pr.status === "rejected" && "text-muted",
            pr.status === "stale" && "border-warning/50 bg-warning/10 text-warning",
          )}
        >
          {STATUS_LABEL[pr.status]}
        </span>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
        <div className="rounded-ui bg-elevated/60 p-3">
          <div className="label-mono mb-1.5">Было</div>
          <ValueView value={pr.before_value} muted />
        </div>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-muted md:mt-8 md:block" aria-hidden />
        <div className="rounded-ui border border-success/30 bg-success/5 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label-mono">Станет</span>
            <span className={clsx("chip text-[11px]", pr.proposed_certainty === "hypothesis" ? "border-warning/50 text-warning" : "border-success/40 text-success")}>
              {CERT_LABEL[pr.proposed_certainty]}
            </span>
          </div>
          <ValueView value={pr.proposed_value} />
          {pr.edited_value !== null && (
            <div className="mt-3 border-t border-line pt-2 text-sm">
              <div className="label-mono mb-1">Принято с правкой редактора</div>
              <ValueView value={pr.edited_value} />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <p className="text-sm text-fg-soft">
          <span className="font-semibold text-fg">Почему: </span>
          {pr.rationale}
        </p>
        {pr.related_paths.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Связанные поля: {pr.related_paths.map((x) => fieldMeta(sch, x).label).join(", ")}
          </p>
        )}
        {pr.status === "stale" && pr.stale_reason && <p className="mt-2 text-sm text-warning">{pr.stale_reason}. Его нельзя принять — только отклонить.</p>}
        {pr.decision_note && <p className="mt-2 text-sm text-muted">Комментарий: {pr.decision_note}</p>}
        <p className="mt-2 text-[11px] text-muted">
          {pr.generator.model ? `модель ${pr.generator.model} · ` : ""}
          создано {fmtDateTime(pr.created_at)}
          {pr.decided_at && ` · решение ${pr.decided_by?.display_name ?? ""} ${fmtDateTime(pr.decided_at)}`}
        </p>

        {editing && (
          <div className="mt-4 space-y-3 rounded-ui border border-line-strong p-3">
            <label className="block text-sm font-semibold text-fg" htmlFor={`v-${pr.id}`}>
              Ваша правка {isList && <span className="font-normal text-muted">(через запятую)</span>}
            </label>
            <textarea id={`v-${pr.id}`} className="input min-h-[80px]" value={val} onChange={(e) => setVal(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              <select className="input h-9 w-auto" value={cert} onChange={(e) => setCert(e.target.value as "defined" | "hypothesis")} aria-label="Определённость">
                <option value="hypothesis">Гипотеза</option>
                <option value="defined">Определено</option>
              </select>
              <input className="input h-9 min-w-[180px] flex-1" placeholder="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
        {rejecting && (
          <input className="input mt-4" placeholder="Почему отклоняем (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
        )}

        {(accept.error || reject.error) && <p className="mt-3 text-sm text-danger">{errText(accept.error ?? reject.error)}</p>}

        {open && canDecide && (
          <div className="mt-4 flex flex-wrap gap-2">
            {blockedReason && <p className="w-full text-sm text-warning">{blockedReason}</p>}
            {pr.status === "pending" && !rejecting && (
              <>
                <button className="btn-primary" disabled={busy || !!blockedReason} onClick={() => accept.mutate(editing)}>
                  <Check className="h-4 w-4" /> {editing ? "Принять с правкой" : "Принять"}
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => setEditing((x) => !x)}>
                  <Pencil className="h-4 w-4" /> {editing ? "Без правки" : "Изменить"}
                </button>
              </>
            )}
            {!editing && (
              <button
                className={rejecting ? "btn-primary" : "btn-ghost"}
                disabled={busy}
                onClick={() => (rejecting ? reject.mutate() : setRejecting(true))}
              >
                <X className="h-4 w-4" /> {rejecting ? "Подтвердить отклонение" : "Отклонить"}
              </button>
            )}
            {rejecting && (
              <button className="btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>
                Отмена
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function ProposalsTab({
  persona,
  sch,
  version,
  dirty,
}: {
  persona: PersonaDetail;
  sch: PassportSchema;
  version: VersionDetail | undefined;
  dirty: boolean;
}) {
  const [filter, setFilter] = useState<"open" | "decided">("open");
  const list = useQuery({
    queryKey: ["proposals", persona.id],
    queryFn: () => get<Proposal[]>(`/personas/${persona.id}/proposals`, { status: "all" }),
  });
  const items = useMemo(() => {
    const all = list.data ?? [];
    return filter === "open"
      ? all.filter((x) => x.status === "pending" || x.status === "stale").sort((a, b) => (a.status === b.status ? 0 : a.status === "pending" ? -1 : 1))
      : all.filter((x) => x.status === "accepted" || x.status === "rejected");
  }, [list.data, filter]);
  const pending = (list.data ?? []).filter((x) => x.status === "pending").length;

  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const isDraft = version?.state === "draft" && version.id === persona.draft_version?.id;
  const canDecide = persona.capabilities.can_edit && !!version && isDraft;
  const blocked = dirty ? "Сначала сохраните ручные правки паспорта — иначе они конфликтуют с принятием." : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["open", `Ожидают решения${pending ? ` · ${pending}` : ""}`],
            ["decided", "Решённые"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={clsx("rounded-xl px-3 py-2 text-sm font-semibold", filter === k ? "bg-fg/[0.07] text-fg" : "text-fg-soft hover:bg-fg/5")} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
        <p className="ml-auto text-xs text-muted">ИИ только предлагает. В паспорт попадает лишь то, что вы примете.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-8 w-8" />} title={filter === "open" ? "Нет предложений, ожидающих решения" : "Решённых предложений пока нет"}>
          {filter === "open"
            ? persona.ai_configured
              ? "Запустите интервью или «Предложить углубление» раздела — предложения появятся здесь."
              : "ИИ не подключён: предложения появятся после настройки LLM-провайдера на сервере."
            : "Здесь будут принятые и отклонённые предложения с историей решений."}
        </EmptyState>
      ) : (
        items.map((pr) => (
          <ProposalCard key={pr.id} pr={pr} sch={sch} persona={persona} version={version!} canDecide={canDecide} blockedReason={blocked} />
        ))
      )}
    </div>
  );
}

/* ---------------- Интервью ---------------- */

type Draft = Record<string, { kind: AnswerKind | null; text: string }>;

export function InterviewTab({
  persona,
  sch,
  onProposals,
}: {
  persona: PersonaDetail;
  sch: PassportSchema;
  onProposals: () => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["interviews", persona.id],
    queryFn: () => get<Interview[]>(`/personas/${persona.id}/interviews`),
  });
  const active = list.data?.find((i) => i.status === "active" && i.version_id === persona.draft_version?.id);
  const [draft, setDraft] = useState<Draft>({});
  const [created, setCreated] = useState<number | null>(null);
  const canRun = persona.capabilities.can_edit && !!persona.draft_version;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["interviews", persona.id] });
    qc.invalidateQueries({ queryKey: ["proposals", persona.id] });
    qc.invalidateQueries({ queryKey: ["persona", persona.id] });
    qc.invalidateQueries({ queryKey: ["persona-history", persona.id] });
  };
  const start = useMutation({ mutationFn: () => post<Interview>(`/personas/${persona.id}/interviews`), onSuccess: refresh });
  const submit = useMutation({
    mutationFn: ({ finish }: { finish: boolean }) => {
      const qs = active!.questions.filter((q) => q.round_no === active!.rounds);
      return post<{ interview: Interview; proposals_created: number }>(`/personas/${persona.id}/interviews/${active!.id}/rounds`, {
        finish,
        answers: qs.map((q) => ({
          question_id: q.id,
          kind: draft[q.id]?.kind ?? "skipped",
          text: draft[q.id]?.kind === "answered" ? draft[q.id]?.text : undefined,
        })),
      });
    },
    onSuccess: (r) => {
      setDraft({});
      setCreated(r.proposals_created);
      refresh();
    },
  });
  const complete = useMutation({
    mutationFn: () => post<Interview>(`/personas/${persona.id}/interviews/${active!.id}/complete`),
    onSuccess: refresh,
  });

  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const current = active?.questions.filter((q) => q.round_no === active.rounds) ?? [];
  const previous = active?.questions.filter((q) => q.round_no < active.rounds) ?? [];
  const ready = current.every((q) => {
    const d = draft[q.id];
    return d?.kind && (d.kind !== "answered" || d.text.trim());
  });
  const set = (id: string, patch: Partial<Draft[string]>) => setDraft((d) => ({ ...d, [id]: { kind: d[id]?.kind ?? null, text: d[id]?.text ?? "", ...patch } }));
  const busy = submit.isPending || start.isPending || complete.isPending;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {created !== null && (
          <div className="flex flex-wrap items-center gap-3 rounded-ui border border-success/40 bg-success/10 px-4 py-3 text-sm text-fg-soft">
            <Check className="h-4 w-4 text-success" />
            <span className="flex-1">
              Ответы обработаны: {created} {plural(created, "предложение", "предложения", "предложений")} в очереди.
            </span>
            {created > 0 && (
              <button className="btn-secondary btn-sm" onClick={onProposals}>
                К предложениям
              </button>
            )}
          </div>
        )}

        {!active && (
          <div className="panel p-6">
            <div className="flex items-center gap-2 text-lg font-semibold text-fg">
              <Bot className="h-5 w-5 text-accent" /> ИИ-интервью
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              ИИ задаёт 3–5 вопросов о самых важных пробелах паспорта. Отвечайте свободно, отмечайте «неизвестно» или
              пропускайте вопрос; завершить можно в любой момент. Из ответов получаются только предложения — паспорт сам
              не меняется.
            </p>
            {!persona.ai_configured ? (
              <p className="mt-4 rounded-ui border border-line-strong bg-elevated/60 px-3 py-2 text-sm text-muted">
                ИИ не подключён: задайте LLM-провайдера на сервере. Пока паспорт можно заполнять вручную.
              </p>
            ) : !canRun ? (
              <p className="mt-4 text-sm text-muted">Интервью проводится по черновику и доступно тем, кто правит паспорт.</p>
            ) : (
              <button className="btn-primary mt-5" onClick={() => start.mutate()} disabled={busy}>
                {start.isPending ? "ИИ готовит вопросы…" : "Начать интервью"}
              </button>
            )}
            {start.error && <p className="mt-3 text-sm text-danger">{errText(start.error)}</p>}
          </div>
        )}

        {active && (
          <>
            {previous.length > 0 && (
              <details className="panel p-4">
                <summary className="cursor-pointer text-sm font-semibold text-fg">
                  Предыдущие раунды · {previous.length} {plural(previous.length, "вопрос", "вопроса", "вопросов")}
                </summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {previous.map((q) => (
                    <li key={q.id} className="border-t border-line pt-2">
                      <div className="font-medium text-fg-soft">{q.question}</div>
                      <div className="text-muted">
                        {q.answer_kind === "answered" ? q.answer_text : q.answer_kind === "unknown" ? "Неизвестно" : "Пропущен"}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-fg">Раунд {active.rounds}</h2>
              <span className="text-xs text-muted">отвечайте, отмечайте «неизвестно» или пропускайте</span>
            </div>

            {current.map((q, i) => {
              const d = draft[q.id];
              return (
                <div key={q.id} className="panel p-4">
                  <div className="flex gap-3">
                    <span className="font-display text-sm font-bold text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-fg">{q.question}</p>
                      {q.why && <p className="mt-1 text-xs text-muted">{q.why}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {q.field_paths.map((fp) => (
                          <span key={fp} className="chip text-[11px] text-muted">
                            {fieldMeta(sch, fp).label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <textarea
                    className="input mt-3 min-h-[72px]"
                    placeholder="Ваш ответ…"
                    value={d?.kind === "answered" ? d.text : ""}
                    disabled={!canRun || busy}
                    onChange={(e) => set(q.id, { kind: e.target.value.trim() ? "answered" : null, text: e.target.value })}
                    aria-label={`Ответ на вопрос ${i + 1}`}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className={clsx("btn-sm", d?.kind === "unknown" ? "btn-primary" : "btn-secondary")}
                      disabled={!canRun || busy}
                      onClick={() => set(q.id, { kind: d?.kind === "unknown" ? null : "unknown", text: "" })}
                    >
                      <HelpCircle className="h-3.5 w-3.5" /> Неизвестно
                    </button>
                    <button
                      className={clsx("btn-sm", d?.kind === "skipped" ? "btn-primary" : "btn-secondary")}
                      disabled={!canRun || busy}
                      onClick={() => set(q.id, { kind: d?.kind === "skipped" ? null : "skipped", text: "" })}
                    >
                      <CircleSlash className="h-3.5 w-3.5" /> Пропустить
                    </button>
                  </div>
                </div>
              );
            })}

            {(submit.error || complete.error) && <p className="text-sm text-danger">{errText(submit.error ?? complete.error)}</p>}
            {canRun && (
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={!ready || busy} onClick={() => submit.mutate({ finish: false })}>
                  {submit.isPending ? "ИИ обрабатывает ответы…" : "Отправить и продолжить"}
                </button>
                <button className="btn-secondary" disabled={!ready || busy} onClick={() => submit.mutate({ finish: true })}>
                  Отправить и завершить
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => complete.mutate()}>
                  Завершить без ответов
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <aside className="space-y-3">
        <div className="panel p-4 text-sm">
          <div className="label-mono mb-2">Как это работает</div>
          <ul className="space-y-2 text-muted">
            <li>· Раунд — 3–5 вопросов о пробелах паспорта.</li>
            <li>· «Неизвестно» — честный ответ: ИИ не будет его додумывать.</li>
            <li>· Ответы становятся предложениями во вкладке «Предложения».</li>
            <li>· Решает редактор: принять, изменить или отклонить.</li>
          </ul>
        </div>
        {(list.data ?? []).filter((i) => i.status === "completed").length > 0 && (
          <div className="panel p-4 text-sm">
            <div className="label-mono mb-2">Завершённые интервью</div>
            <ul className="space-y-1.5 text-muted">
              {list.data!
                .filter((i) => i.status === "completed")
                .map((i) => (
                  <li key={i.id}>
                    {fmtDateTime(i.created_at)} · {i.rounds} {plural(i.rounds, "раунд", "раунда", "раундов")}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
