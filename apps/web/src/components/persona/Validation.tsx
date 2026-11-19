import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, CircleCheck, Info, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { ApiError, get, post } from "../../api/client";
import type { ConsistencySignal, PassportSchema, PersonaDetail, Proposal, ValidationIssue, ValidationRun } from "../../api/types";
import { fmtDateTime } from "../../lib/format";
import { fieldMeta } from "./AiWork";

/*
 * Проверка целостности паспорта (ТЗ §3) и «светофор» согласованности (E-028).
 * Проверка действует только для своего content_hash; светофор — подсказка, на активацию не влияет.
 */

const busy = (r?: ValidationRun) => r?.status === "queued" || r?.status === "running";

export function useValidations(personaId: string) {
  return useQuery({
    queryKey: ["validations", personaId],
    queryFn: () => get<ValidationRun[]>(`/personas/${personaId}/validations`),
    refetchInterval: (q) => ((q.state.data ?? []).some(busy) ? 3000 : false),
  });
}

/** Последняя проверка данного вида для текущего содержимого черновика. */
export function latest(runs: ValidationRun[] | undefined, kind: "check" | "final" | "any" = "any") {
  return (runs ?? []).find((r) => kind === "any" || r.kind === kind);
}

/** Количество замечаний (без info) по разделам — для левой навигации. */
export function issuesBySection(run?: ValidationRun) {
  const out: Record<string, number> = {};
  if (!run || run.status !== "done" || !run.is_current) return out;
  for (const i of run.issues) {
    if (i.severity === "info") continue;
    for (const s of new Set(i.field_paths.map((f) => f.split(".")[0]!))) out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export function useStartValidation(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: "check" | "final") => post<ValidationRun>(`/personas/${personaId}/validations`, { kind }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["validations", personaId] }),
  });
}

/* ---------------- «Светофор» ---------------- */

const LIGHT = {
  green: { cls: "bg-success", label: "Противоречий не видно" },
  yellow: { cls: "bg-warning", label: "Возможна неуточнённость" },
  red: { cls: "bg-danger", label: "Похоже на противоречие" },
} as const;

export function SignalChip({ personaId, contentHash, aiConfigured }: { personaId: string; contentHash?: string; aiConfigured: boolean }) {
  const q = useQuery({
    queryKey: ["consistency", personaId, contentHash],
    queryFn: () => get<ConsistencySignal>(`/personas/${personaId}/consistency`),
    enabled: !!contentHash && aiConfigured,
    refetchInterval: (s) => (s.state.data?.status === "pending" ? 2000 : false),
  });
  if (!aiConfigured || !contentHash) return null;
  const d = q.data;
  if (!d || d.status === "pending")
    return (
      <span className="chip text-[11px] text-muted" title="Быстрая оценка согласованности считается">
        <Loader2 className="h-3 w-3 animate-spin" /> светофор…
      </span>
    );
  if (d.status === "unavailable" || !d.level || !(d.level in LIGHT)) return null;
  const l = LIGHT[d.level as keyof typeof LIGHT];
  return (
    <span
      className="chip text-[11px] text-fg-soft"
      title={`Быстрая подсказка (${d.model ?? "Decisions"}): вероятность противоречия ${Math.round((d.p_conflict ?? 0) * 100)}%. Это не проверка — для активации нужна финальная проверка целостности.`}
    >
      <span className={clsx("h-2 w-2 rounded-full", l.cls)} /> {l.label}
    </span>
  );
}

/* ---------------- Отчёт ---------------- */

const SEV = {
  critical: { icon: AlertTriangle, cls: "border-danger/40 bg-danger/5", text: "text-danger", label: "Критично" },
  warning: { icon: AlertTriangle, cls: "border-warning/40 bg-warning/5", text: "text-warning", label: "Уточнить" },
  info: { icon: Info, cls: "border-line bg-elevated/40", text: "text-muted", label: "Не проблема" },
} as const;
const KIND = { contradiction: "противоречие", unspecified: "неуточнённость", unusual_compatible: "необычно, но совместимо" } as const;

function IssueCard({
  issue,
  run,
  persona,
  sch,
  canEdit,
  onOpenSection,
  onOpenProposals,
}: {
  issue: ValidationIssue;
  run: ValidationRun;
  persona: PersonaDetail;
  sch: PassportSchema;
  canEdit: boolean;
  onOpenSection: (key: string) => void;
  onOpenProposals: () => void;
}) {
  const qc = useQueryClient();
  const s = SEV[issue.severity];
  const propose = useMutation({
    mutationFn: () => post<Proposal>(`/personas/${persona.id}/validations/${run.id}/issues/${issue.id}/propose`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validations", persona.id] });
      qc.invalidateQueries({ queryKey: ["proposals", persona.id] });
      qc.invalidateQueries({ queryKey: ["persona", persona.id] });
    },
  });
  return (
    <li className={clsx("rounded-ui border p-3", s.cls)}>
      <div className="flex items-start gap-2">
        <s.icon className={clsx("mt-0.5 h-4 w-4 shrink-0", s.text)} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg">{issue.title}</div>
          <div className={clsx("text-[11px] font-semibold", s.text)}>
            {s.label} · {KIND[issue.kind]}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-soft">{issue.explanation}</p>
      {issue.suggestion && <p className="mt-1.5 text-[13px] text-muted">Что сделать: {issue.suggestion}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {issue.field_paths.map((fp) => (
          <button key={fp} className="chip text-[11px] text-fg-soft hover:border-fg/40" onClick={() => onOpenSection(fp.split(".")[0]!)}>
            {fieldMeta(sch, fp).label}
          </button>
        ))}
      </div>
      {run.is_current && issue.fix_field_path && canEdit && (
        <div className="mt-2.5">
          {issue.proposal_id ? (
            <button className="btn-ghost btn-sm px-0 text-accent" onClick={onOpenProposals}>
              Предложение создано <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button className="btn-secondary btn-sm" onClick={() => propose.mutate()} disabled={propose.isPending}>
              <Sparkles className="h-3.5 w-3.5" /> Создать предложение
            </button>
          )}
          {propose.error && <p className="mt-1 text-xs text-danger">{(propose.error as ApiError).message}</p>}
        </div>
      )}
    </li>
  );
}

export function ValidationCard({
  persona,
  sch,
  canRun,
  onOpenSection,
  onOpenProposals,
}: {
  persona: PersonaDetail;
  sch: PassportSchema;
  canRun: boolean;
  onOpenSection: (key: string) => void;
  onOpenProposals: () => void;
}) {
  const runs = useValidations(persona.id);
  const start = useStartValidation(persona.id);
  const run = latest(runs.data);
  const running = busy(run);
  const problems = run?.issues.filter((i) => i.severity !== "info") ?? [];
  const infos = run?.issues.filter((i) => i.severity === "info") ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg">
        <ShieldCheck className="h-4 w-4 text-accent" /> Проверка целостности
      </div>
      {!run && <p className="mt-2 text-xs text-muted">Проверка ещё не запускалась. ИИ проверит весь паспорт на противоречия между разделами.</p>}
      {running && (
        <p className="mt-3 flex items-center gap-2 text-sm text-fg-soft">
          <Loader2 className="h-4 w-4 animate-spin text-accent" /> {run?.kind === "final" ? "Финальная проверка" : "Проверка"} идёт… обычно до минуты
        </p>
      )}
      {run?.status === "failed" && <p className="mt-3 text-sm text-danger">Проверка не удалась: {run.error}</p>}
      {run?.status === "done" && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={clsx("chip", run.is_current ? "border-success/40 text-success" : "border-warning/50 text-warning")}>
              {run.is_current ? "актуальна" : "устарела: паспорт менялся"}
            </span>
            <span className="chip text-muted">{run.kind === "final" ? "финальная" : "обычная"}</span>
            {run.finished_at && <span className="text-muted">{fmtDateTime(run.finished_at)}</span>}
          </div>
          {run.summary && <p className="text-[13px] text-fg-soft">{run.summary}</p>}
          {problems.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CircleCheck className="h-4 w-4" /> Противоречий не найдено
            </p>
          ) : (
            <ul className="space-y-2">
              {problems.map((i) => (
                <IssueCard key={i.id} issue={i} run={run} persona={persona} sch={sch} canEdit={canRun} onOpenSection={onOpenSection} onOpenProposals={onOpenProposals} />
              ))}
            </ul>
          )}
          {infos.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted">Учтено, но не проблема · {infos.length}</summary>
              <ul className="mt-2 space-y-2">
                {infos.map((i) => (
                  <IssueCard key={i.id} issue={i} run={run} persona={persona} sch={sch} canEdit={false} onOpenSection={onOpenSection} onOpenProposals={onOpenProposals} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {canRun && persona.ai_configured && (
        <button className="btn-secondary mt-3 w-full justify-start" disabled={running || start.isPending} onClick={() => start.mutate("check")}>
          <ShieldCheck className="h-4 w-4" /> {running ? "Проверка идёт…" : run ? "Проверить снова" : "Проверить целостность"}
        </button>
      )}
      {start.error && <p className="mt-2 text-xs text-danger">{(start.error as ApiError).message}</p>}
    </div>
  );
}

/** Блок финальной проверки в диалоге активации. */
export function FinalCheckBlock({ persona, canRun }: { persona: PersonaDetail; canRun: boolean }) {
  const runs = useValidations(persona.id);
  const start = useStartValidation(persona.id);
  const final = (runs.data ?? []).find((r) => r.kind === "final");
  const running = busy(final);
  const current = final?.status === "done" && final.is_current;
  return (
    <div className="rounded-ui border border-line p-3">
      <div className="text-sm font-semibold text-fg">Финальная проверка целостности</div>
      <p className="mt-1 text-xs text-muted">
        Самая тщательная модель проверяет весь паспорт. Нужна для активации и действует только для текущего содержимого.
      </p>
      {running && (
        <p className="mt-2 flex items-center gap-2 text-sm text-fg-soft">
          <Loader2 className="h-4 w-4 animate-spin text-accent" /> Идёт… обычно до минуты
        </p>
      )}
      {current && (
        <p className={clsx("mt-2 text-sm", final.critical_count ? "text-danger" : "text-success")}>
          {final.critical_count ? `Критических противоречий: ${final.critical_count}` : "Критических противоречий нет"}
          {final.warning_count > 0 && <span className="text-muted"> · уточнить: {final.warning_count}</span>}
        </p>
      )}
      {final?.status === "failed" && <p className="mt-2 text-sm text-danger">Не удалась: {final.error}</p>}
      {canRun && persona.ai_configured && !running && (
        <button className="btn-secondary btn-sm mt-2" onClick={() => start.mutate("final")} disabled={start.isPending}>
          <ShieldCheck className="h-3.5 w-3.5" /> {current ? "Повторить финальную проверку" : "Запустить финальную проверку"}
        </button>
      )}
      {!persona.ai_configured && <p className="mt-2 text-xs text-muted">ИИ не подключён — финальная проверка недоступна.</p>}
      {start.error && <p className="mt-2 text-xs text-danger">{(start.error as ApiError).message}</p>}
    </div>
  );
}
