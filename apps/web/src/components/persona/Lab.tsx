import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, FlaskConical, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { ApiError, get, post } from "../../api/client";
import type { LabOverview, LabResult, LabRun, PersonaDetail, Verdict } from "../../api/types";
import { fmtDateTime } from "../../lib/format";
import { EmptyState, ErrorState, Spinner } from "../ui";

/*
 * Лаборатория персоны (PROJECT_CONTEXT §7.3): 6 групп испытаний, вердикт pass / warning / critical
 * с объяснением по каждому тесту. Без «процента качества». Прогон действует только для своего content_hash.
 */

const busy = (r?: LabRun) => r?.status === "queued" || r?.status === "running";

export function useLab(personaId: string) {
  return useQuery({
    queryKey: ["lab", personaId],
    queryFn: () => get<LabOverview>(`/personas/${personaId}/lab`),
    refetchInterval: (q) => (busy(q.state.data?.runs[0]) ? 3000 : false),
  });
}

export function useStartLab(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<LabRun>(`/personas/${personaId}/lab/runs`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab", personaId] }),
  });
}

const V: Record<Verdict, { label: string; cls: string; dot: string }> = {
  pass: { label: "pass", cls: "border-success/40 bg-success/10 text-success", dot: "bg-success" },
  warning: { label: "warning", cls: "border-warning/50 bg-warning/10 text-warning", dot: "bg-warning" },
  critical: { label: "critical", cls: "border-danger/40 bg-danger/10 text-danger", dot: "bg-danger" },
};

function VerdictChip({ v, small }: { v: Verdict; small?: boolean }) {
  return <span className={clsx("chip font-semibold", small ? "text-[10.5px]" : "text-[11px]", V[v].cls)}>{V[v].label}</span>;
}

function ResultRow({ r, baseline }: { r: LabResult; baseline?: LabResult }) {
  const [open, setOpen] = useState(r.verdict !== "pass");
  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", V[r.verdict].dot)} />
        <span className="min-w-0 flex-1 text-sm text-fg-soft">{r.prompt}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {baseline && baseline.verdict !== r.verdict && (
            <span className="text-[11px] text-muted" title="Вердикт в утверждённой версии">
              было <VerdictChip v={baseline.verdict} small />
            </span>
          )}
          <VerdictChip v={r.verdict} />
          <ChevronDown className={clsx("h-4 w-4 text-muted transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="ml-5 mt-2 space-y-2 text-[13px]">
          <div className="rounded-ui bg-elevated/60 p-3">
            <div className="label-mono mb-1">Ответ модели персоны · служебный тест</div>
            <p className="whitespace-pre-wrap text-fg-soft">{r.response}</p>
          </div>
          {r.explanation && <p className="text-fg-soft">{r.explanation}</p>}
          {r.suggestion && <p className="text-muted">Что поправить в паспорте: {r.suggestion}</p>}
          {r.confidence != null && <p className="text-[11px] text-muted">уверенность оценки {Math.round(r.confidence * 100)}%</p>}
        </div>
      )}
    </li>
  );
}

export function LabTab({ persona, dirty }: { persona: PersonaDetail; dirty: boolean }) {
  const q = useLab(persona.id);
  const start = useStartLab(persona.id);
  const [runIdx, setRunIdx] = useState(0);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data!;
  const run = data.runs[runIdx];
  const running = busy(data.runs[0]);
  const canRun = persona.capabilities.can_edit && !!persona.draft_version && persona.ai_configured;
  const base = data.baseline && data.baseline.id !== run?.id ? Object.fromEntries(data.baseline.results.map((r) => [r.case_key, r])) : {};

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <FlaskConical className="h-5 w-5 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-fg">Лаборатория · набор тестов {data.suite_version}</div>
            <div className="text-xs text-muted">
              Шесть групп испытаний. Critical блокирует активацию, warning — нет. Прогон действует только для текущего содержимого.
            </div>
          </div>
          {canRun && (
            <button className="btn-primary" disabled={running || start.isPending || dirty} onClick={() => start.mutate()} title={dirty ? "Сначала сохраните правки" : undefined}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Прогон идёт… 1–2 мин" : "Запустить лабораторию"}
            </button>
          )}
          {!persona.ai_configured && <span className="text-xs text-muted">ИИ не подключён</span>}
          {start.error && <p className="w-full text-sm text-danger">{(start.error as ApiError).message}</p>}
        </div>

        {!run && (
          <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Лаборатория ещё не запускалась">
            Модель персоны ответит на {data.groups.reduce((a, g) => a + g.cases.length, 0) || 12} стандартных тест-кейсов, затем каждый ответ
            получит вердикт по рубрике своей группы, а для warning и critical — объяснение и рекомендацию.
          </EmptyState>
        )}

        {run?.status === "failed" && <div className="panel border-danger/40 p-4 text-sm text-danger">Прогон не удался: {run.error}</div>}
        {run && busy(run) && (
          <div className="panel flex items-center gap-2 p-4 text-sm text-fg-soft">
            <Loader2 className="h-4 w-4 animate-spin text-accent" /> Модель персоны отвечает на тесты, затем идёт оценка…
          </div>
        )}

        {run?.status === "done" && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={clsx("chip", run.is_current ? "border-success/40 text-success" : "border-warning/50 text-warning")}>
                {run.is_current ? "актуален" : `устарел: v${run.version_label ?? "?"} менялась`}
              </span>
              <VerdictChip v="pass" /> {run.pass_count}
              <VerdictChip v="warning" /> {run.warning_count}
              <VerdictChip v="critical" /> {run.critical_count}
              {data.baseline && data.baseline.id !== run.id && (
                <span className="text-xs text-muted">· сравнение с утверждённой v{data.baseline.version_label}</span>
              )}
            </div>
            {data.groups.map((g) => {
              const rows = run.results.filter((r) => r.lab_group === g.key);
              const worst = rows.some((r) => r.verdict === "critical") ? "critical" : rows.some((r) => r.verdict === "warning") ? "warning" : "pass";
              return (
                <section key={g.key} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold text-fg">{g.title}</h3>
                      <p className="text-xs text-muted">{g.goal}</p>
                    </div>
                    <VerdictChip v={worst} />
                  </div>
                  <ul className="mt-2">
                    {rows.map((r) => (
                      <ResultRow key={r.id} r={r} baseline={base[r.case_key]} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>

      <aside className="space-y-3">
        <div className="panel p-4 text-sm">
          <div className="label-mono mb-2">Прогоны</div>
          {data.runs.length === 0 && <p className="text-muted">Пока нет.</p>}
          <ul className="space-y-1">
            {data.runs.map((r, i) => (
              <li key={r.id}>
                <button
                  className={clsx("w-full rounded-xl px-2.5 py-2 text-left", i === runIdx ? "bg-fg/[0.07]" : "hover:bg-fg/5")}
                  onClick={() => setRunIdx(i)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-fg">v{r.version_label}</span>
                    {r.status === "done" ? (
                      <span className="text-[11px] text-muted">
                        {r.critical_count ? `${r.critical_count} critical` : r.warning_count ? `${r.warning_count} warning` : "всё pass"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">{r.status === "failed" ? "ошибка" : "идёт…"}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted">
                    {fmtDateTime(r.created_at)} {r.is_current ? "· актуален" : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {run?.models && (
          <div className="panel p-4 text-xs text-muted">
            <div className="label-mono mb-2">Модели прогона</div>
            <div>ответы: {run.models.simulator}</div>
            <div>оценка: {run.models.judge}</div>
            <div>объяснения: {run.models.explainer}</div>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Статус лаборатории для диалога активации. */
export function LabStatusBlock({ persona }: { persona: PersonaDetail }) {
  const q = useLab(persona.id);
  const run = q.data?.runs.find((r) => r.status === "done" && r.is_current) ?? q.data?.runs[0];
  return (
    <div className="rounded-ui border border-line p-3">
      <div className="text-sm font-semibold text-fg">Лаборатория</div>
      {!run && <p className="mt-1 text-xs text-muted">Не запускалась. Откройте вкладку «Тесты».</p>}
      {run && busy(run) && (
        <p className="mt-1 flex items-center gap-2 text-sm text-fg-soft">
          <Loader2 className="h-4 w-4 animate-spin text-accent" /> Идёт прогон…
        </p>
      )}
      {run?.status === "done" && (
        <p className={clsx("mt-1 text-sm", !run.is_current ? "text-warning" : run.critical_count ? "text-danger" : "text-success")}>
          {!run.is_current
            ? "Последний прогон устарел — паспорт менялся"
            : run.critical_count
              ? `Critical: ${run.critical_count}`
              : `Critical нет · warning: ${run.warning_count}`}
        </p>
      )}
    </div>
  );
}
