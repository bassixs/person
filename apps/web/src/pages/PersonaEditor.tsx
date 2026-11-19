import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  FlaskConical,
  GitBranchPlus,
  History,
  PanelLeft,
  PanelRight,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { ApiError, get, post, put } from "../api/client";
import type {
  ActivationCheck,
  AuditEvent,
  Passport,
  PassportField,
  PassportSchema,
  PersonaDetail,
  VersionDetail,
} from "../api/types";
import { useAmbient } from "../components/Ambient";
import { FieldEditor } from "../components/passport/FieldEditor";
import { InterviewTab, ProposalsTab } from "../components/persona/AiWork";
import { FinalCheckBlock, issuesBySection, latest, SignalChip, useStartValidation, useValidations, ValidationCard } from "../components/persona/Validation";
import { EmptyState, ErrorState, Modal, PersonaAvatar, Spinner, StatusBadge } from "../components/ui";
import { sectionStats } from "../lib/passport";
import { ACTION_LABEL, fmtDateTime, VERSION_STATE_LABEL } from "../lib/format";

type Tab = "passport" | "interview" | "proposals" | "tests" | "versions";
const TABS: { key: Tab; label: string }[] = [
  { key: "passport", label: "Паспорт" },
  { key: "interview", label: "Интервью" },
  { key: "proposals", label: "Предложения" },
  { key: "tests", label: "Тесты" },
  { key: "versions", label: "Версии и история" },
];

function AiPanel({
  p,
  sectionTitle,
  legend,
  canRun,
  onDeepen,
  deepening,
  deepenError,
  onOpenProposals,
  children,
}: {
  p: PersonaDetail;
  sectionTitle: string;
  legend?: string;
  canRun: boolean;
  onDeepen: () => void;
  deepening: boolean;
  deepenError: string | null;
  onOpenProposals: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Bot className="h-4 w-4 text-accent" /> ИИ-ассистент
        </div>
        {!p.ai_configured && (
          <div className="mt-3 rounded-ui border border-line-strong px-3 py-2 text-xs text-muted">
            ИИ не подключён: интервью и предложения появятся после настройки LLM-провайдера на сервере.
          </div>
        )}
        {p.pending_proposals > 0 && (
          <button className="mt-3 flex w-full items-center gap-2 rounded-ui border border-accent/40 bg-accent/10 px-3 py-2 text-left text-sm text-fg" onClick={onOpenProposals}>
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="flex-1">Ждут решения: {p.pending_proposals}</span>
            <span className="text-xs text-muted">открыть</span>
          </button>
        )}
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 rounded-ui border border-line-strong bg-elevated/50 px-3 py-2 text-sm text-fg">
            <CheckCircle2 className="h-4 w-4 text-success" /> Редактировать вручную
          </div>
          <button
            className="btn-secondary w-full justify-start"
            disabled={!p.ai_configured || !canRun || deepening}
            onClick={onDeepen}
            title={!p.ai_configured ? "ИИ не подключён" : !canRun ? "Доступно для черновика тем, кто правит паспорт" : `ИИ предложит углубление раздела «${sectionTitle}»`}
          >
            <Sparkles className="h-4 w-4" /> {deepening ? "ИИ готовит предложения…" : "Предложить углубление"}
          </button>
          {deepenError && <p className="text-xs text-danger">{deepenError}</p>}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          ИИ никогда не сохраняет изменения напрямую: только предложения «было / станет», которые вы принимаете,
          правите или отклоняете.
        </p>
      </div>
      {children}
      {legend && (
        <div className="panel p-4">
          <div className="label-mono">Исходная легенда · неизменяема</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-soft">{legend}</p>
        </div>
      )}
    </div>
  );
}

function ActivationDialog({ persona, version, open, onOpenChange }: { persona: PersonaDetail; version: VersionDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const runs = useValidations(persona.id);
  const fin = latest(runs.data, "final");
  const check = useQuery({
    queryKey: ["activation-check", version.id, version.content_hash, fin?.id, fin?.status],
    queryFn: () => get<ActivationCheck>(`/personas/${persona.id}/activation-check`, { version_id: version.id }),
    enabled: open,
  });
  const act = useMutation({ mutationFn: () => post(`/personas/${persona.id}/activate`, { version_id: version.id }) });
  const blockers = check.data?.blockers ?? [];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Активация версии ${version.label}`} description="Решение принимает сервер: критические проблемы и отсутствие актуальных проверок блокируют активацию." wide>
      {check.isLoading && <Spinner label="Проверяем условия…" />}
      {check.error && <ErrorState error={check.error} />}
      {check.data && (
        <div className="space-y-4">
          <div className="font-mono text-xs text-muted">content_hash {check.data.content_hash.slice(0, 16)}…</div>
          {blockers.length > 0 ? (
            <ul className="space-y-2">
              {blockers.map((b) => (
                <li key={b.code} className="flex gap-2 rounded-ui border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-fg-soft">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  {b.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-success">Блокирующих условий нет.</p>
          )}
          <FinalCheckBlock persona={persona} canRun={persona.capabilities.can_edit && version.state === "draft"} />
          <p className="text-xs text-muted">
            Лаборатория из шести групп испытаний — следующий шаг итерации 2. До неё активация невозможна — это честное
            ограничение, а не ошибка.
          </p>
          {act.error && <p className="text-sm text-danger">{(act.error as ApiError).message}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => onOpenChange(false)}>
              Закрыть
            </button>
            <button className="btn-primary" disabled={blockers.length > 0 || act.isPending} onClick={() => act.mutate()}>
              Активировать
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function PersonaEditorPage() {
  useAmbient("low");
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("passport");
  const [section, setSection] = useState("legend");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [local, setLocal] = useState<Passport | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);
  const [drawer, setDrawer] = useState<"nav" | "ai" | null>(null);

  const persona = useQuery({ queryKey: ["persona", id], queryFn: () => get<PersonaDetail>(`/personas/${id}`) });
  const schema = useQuery({ queryKey: ["passport-schema"], queryFn: () => get<PassportSchema>("/personas/schema"), staleTime: Infinity });
  const vid = versionId ?? persona.data?.draft_version?.id ?? persona.data?.active_version?.id ?? persona.data?.versions.at(-1)?.id;
  const version = useQuery({
    queryKey: ["persona-version", vid],
    queryFn: () => get<VersionDetail>(`/personas/${id}/versions/${vid}`),
    enabled: !!vid,
  });
  const history = useQuery({
    queryKey: ["persona-history", id],
    queryFn: () => get<AuditEvent[]>(`/personas/${id}/history`),
    enabled: tab === "versions",
  });

  // Загружаем серверную версию в локальное состояние, только если нет несохранённых правок.
  useEffect(() => {
    if (version.data && !dirty) setLocal(version.data.passport);
  }, [version.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = version.data;
  const p = persona.data;
  const readOnly = !p?.capabilities.can_edit || v?.state !== "draft";

  const save = useMutation({
    mutationFn: () => put<VersionDetail>(`/personas/${id}/versions/${v!.id}`, { passport: local, expected_revision: v!.revision }),
    onSuccess: (data) => {
      qc.setQueryData(["persona-version", data.id], data);
      setLocal(data.passport);
      setDirty(false);
      setSaveError(null);
      setSavedAt(data.updated_at);
      qc.invalidateQueries({ queryKey: ["persona", id] });
      qc.invalidateQueries({ queryKey: ["personas"] });
      qc.invalidateQueries({ queryKey: ["persona-history", id] });
    },
    onError: (e: ApiError) => {
      if (e.code === "revision_conflict") setConflict(e.message);
      else if (e.code === "validation_error" && Array.isArray(e.details))
        setSaveError(`${e.message}: ${(e.details as { message: string }[]).map((d) => d.message).join("; ")}`);
      else setSaveError(e.message);
    },
  });

  const newVersion = useMutation({
    mutationFn: () => post<VersionDetail>(`/personas/${id}/versions`),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["persona", id] });
      setVersionId(d.id);
    },
  });

  const validations = useValidations(id);
  const startCheck = useStartValidation(id);
  const deepen = useMutation({
    mutationFn: (sectionKey: string) => post(`/personas/${id}/proposals/deepen`, { section: sectionKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals", id] });
      qc.invalidateQueries({ queryKey: ["persona", id] });
      setTab("proposals");
    },
  });

  const doSave = useCallback(() => {
    if (dirty && !readOnly && !save.isPending) save.mutate();
  }, [dirty, readOnly, save]);

  // Ctrl/Cmd+S — сохранить.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  // Защита от потери несохранённых правок: закрытие вкладки и уход со страницы.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  const stats = useMemo(() => (local && schema.data ? sectionStats(local, schema.data) : null), [local, schema.data]);
  const secIssues = useMemo(() => issuesBySection(latest(validations.data)), [validations.data]);
  const checkBusy = ["queued", "running"].includes(latest(validations.data)?.status ?? "");

  if (persona.isLoading || schema.isLoading)
    return (
      <div className="shell">
        <Spinner />
      </div>
    );
  if (persona.error)
    return (
      <div className="shell">
        <ErrorState error={persona.error} onRetry={() => persona.refetch()} />
      </div>
    );
  if (!p || !schema.data) return null;

  const sch = schema.data;
  const sec = sch.sections.find((s) => s.key === section) ?? sch.sections[0];
  const legend = p.source_materials.find((m) => m.kind === "original_legend")?.content;

  const updateField = (fkey: string, f: PassportField) => {
    if (!local) return;
    setLocal({
      ...local,
      sections: { ...local.sections, [sec.key]: { ...local.sections[sec.key], fields: { ...local.sections[sec.key].fields, [fkey]: f } } },
    });
    setDirty(true);
  };
  const updateNarrative = (text: string) => {
    if (!local) return;
    setLocal({ ...local, sections: { ...local.sections, [sec.key]: { ...local.sections[sec.key], narrative: text } } });
    setDirty(true);
  };

  const SectionNav = (
    <nav aria-label="Разделы паспорта" className="space-y-1">
      <div className="label-mono mb-2 px-2">Разделы паспорта</div>
      {sch.sections.map((s, i) => {
        const st = stats?.[s.key];
        return (
          <button
            key={s.key}
            onClick={() => {
              setSection(s.key);
              setDrawer(null);
            }}
            aria-current={section === s.key ? "true" : undefined}
            className={clsx(
              "flex w-full items-center gap-2.5 rounded-ui px-2.5 py-2 text-left text-sm transition-colors",
              section === s.key ? "bg-elevated text-fg shadow-[inset_2px_0_0_rgb(var(--accent))]" : "text-muted hover:bg-elevated/50 hover:text-fg-soft",
            )}
          >
            <span className="w-4 font-mono text-[11px] text-muted">{i + 1}</span>
            <span className="flex-1 truncate">{s.title}</span>
            {(secIssues[s.key] ?? 0) > 0 && (
              <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning" title="Замечания актуальной проверки целостности">
                {`!${secIssues[s.key]}`}
              </span>
            )}
            {st && (
              <span className={clsx("font-mono text-[11px]", st.filled === st.total ? "text-success" : "text-muted")} title={`Заполнено ${st.filled} из ${st.total}; гипотез: ${st.hypotheses}`}>
                {st.filled}/{st.total}
                {st.hypotheses > 0 && <span className="text-warning"> ·{st.hypotheses}г</span>}
              </span>
            )}
          </button>
        );
      })}
      <p className="px-2 pt-3 text-[11px] leading-relaxed text-muted">
        «!N» — замечания актуальной проверки целостности в разделе. После правок проверку нужно повторить.
      </p>
    </nav>
  );

  return (
    <div className="shell">
      {/* Шапка карточки */}
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/personas" className="btn-ghost h-9 w-9 shrink-0 px-0" aria-label="К каталогу">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <PersonaAvatar name={p.display_name} size={56} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-fg sm:text-2xl">{p.display_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} />
              <select
                className="input h-7 w-auto py-0 font-mono text-xs"
                value={vid}
                onChange={(e) => {
                  if (dirty && !window.confirm("Есть несохранённые правки. Переключить версию и потерять их?")) return;
                  setDirty(false);
                  setVersionId(e.target.value);
                }}
                aria-label="Версия"
              >
                {p.versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    v{x.label} · {VERSION_STATE_LABEL[x.state]}
                  </option>
                ))}
              </select>
              {v && (
                <span className="font-mono text-[11px] text-muted" title="Хэш содержимого: проверки привязываются к нему">
                  #{v.content_hash.slice(0, 8)} · rev {v.revision}
                </span>
              )}
              <SignalChip personaId={id} contentHash={v?.state === "draft" ? v.content_hash : undefined} aiConfigured={p.ai_configured} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <span className="mr-1 text-xs text-muted" aria-live="polite">
            {save.isPending ? "Сохранение…" : dirty ? "Есть несохранённые правки" : savedAt ? `Сохранено ${fmtDateTime(savedAt)}` : readOnly ? "Только чтение" : ""}
          </span>
          {!readOnly && (
            <button className="btn-primary" onClick={doSave} disabled={!dirty || save.isPending} title="Ctrl+S">
              <Save className="h-4 w-4" /> Сохранить
            </button>
          )}
          {p.capabilities.can_create_version && (
            <button className="btn-secondary" onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>
              <GitBranchPlus className="h-4 w-4" /> Новая версия
            </button>
          )}
          <button
            className="btn-secondary"
            disabled={!p.ai_configured || readOnly || dirty || startCheck.isPending || checkBusy}
            onClick={() => startCheck.mutate("check")}
            title={!p.ai_configured ? "ИИ не подключён" : dirty ? "Сначала сохраните правки" : "Проверить весь паспорт на противоречия (в фоне)"}
          >
            <ShieldCheck className="h-4 w-4" /> {checkBusy ? "Проверка идёт…" : "Проверить"}
          </button>
          <button className="btn-secondary" disabled title="Лаборатория из 6 групп испытаний — итерация 2">
            <FlaskConical className="h-4 w-4" /> Лаборатория
          </button>
          <button className="btn-secondary" disabled title="Доступно после проверок (итерация 2)">
            <Send className="h-4 w-4" /> На согласование
          </button>
          {p.capabilities.can_activate && v?.state === "draft" && (
            <button className="btn-secondary" onClick={() => setActivateOpen(true)} disabled={dirty} title={dirty ? "Сначала сохраните правки" : undefined}>
              <CheckCircle2 className="h-4 w-4" /> Активировать
            </button>
          )}
        </div>
      </div>

      {conflict && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-ui border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg-soft" role="alert">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="flex-1">{conflict}</span>
          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              setConflict(null);
              setDirty(false);
              version.refetch();
            }}
          >
            Загрузить актуальную версию
          </button>
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-ui border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-fg-soft" role="alert">
          {saveError}
        </div>
      )}
      {p.status === "archived" && (
        <div className="mb-4 rounded-ui border border-line-strong bg-elevated px-4 py-3 text-sm text-muted">Личность в архиве — редактирование недоступно.</div>
      )}

      {/* Вкладки рабочей карточки */}
      <div className="mb-5 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx("relative whitespace-nowrap px-3 pb-2.5 pt-1 text-sm font-medium", tab === t.key ? "text-fg" : "text-muted hover:text-fg-soft")}
          >
            {t.label}
            {t.key === "proposals" && p.pending_proposals > 0 && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">{p.pending_proposals}</span>
            )}
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === "passport" && (
        <div className="mb-4 flex gap-2 xl:hidden">
          <button className="btn-secondary min-w-0 flex-1 justify-start lg:hidden" onClick={() => setDrawer("nav")}>
            <PanelLeft className="h-4 w-4 shrink-0" />
            <span className="truncate">{sec.title}</span>
          </button>
          <button className="btn-secondary shrink-0" onClick={() => setDrawer("ai")} aria-label="ИИ-ассистент">
            <PanelRight className="h-4 w-4" />
            <span className="hidden sm:inline">ИИ-ассистент</span>
            <span className="sm:hidden">ИИ</span>
          </button>
        </div>
      )}

      {tab === "passport" && (
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
          <aside className="hidden lg:block">
            <div className="sticky" style={{ top: "calc(var(--nav-height) + 20px)" }}>
              {SectionNav}
            </div>
          </aside>

          <section aria-labelledby="sec-title" className="min-w-0 space-y-4">
            {!local || version.isLoading ? (
              <Spinner />
            ) : (
              <>
                <div>
                  <h2 id="sec-title" className="text-lg font-semibold text-fg">
                    {sec.title}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{sec.description}</p>
                </div>
                {sec.fields.map((f) => (
                  <FieldEditor
                    key={`${sec.key}.${f.key}`}
                    sectionKey={sec.key}
                    meta={f}
                    schema={sch}
                    field={local.sections[sec.key].fields[f.key]}
                    onChange={(nf) => updateField(f.key, nf)}
                    readOnly={readOnly}
                  />
                ))}
                <div className="rounded-ui border border-line bg-canvas/40 p-4">
                  <label htmlFor="narrative" className="text-sm font-semibold text-fg">
                    Развёрнутое описание раздела
                  </label>
                  <p className="mb-2 mt-0.5 text-xs text-muted">Нарратив дополняет структурированные поля. Не превращайте неизвестное в факт.</p>
                  <textarea
                    id="narrative"
                    className="input min-h-[180px] resize-y leading-relaxed"
                    value={local.sections[sec.key].narrative}
                    onChange={(e) => updateNarrative(e.target.value)}
                    readOnly={readOnly}
                  />
                </div>
              </>
            )}
          </section>

          <aside className="hidden xl:block">
            <div className="sticky" style={{ top: "calc(var(--nav-height) + 20px)" }}>
              <AiPanel
                p={p}
                sectionTitle={sec.title}
                legend={legend}
                canRun={p.capabilities.can_edit && v?.state === "draft"}
                onDeepen={() => deepen.mutate(sec.key)}
                deepening={deepen.isPending}
                deepenError={deepen.error ? (deepen.error as ApiError).message : null}
                onOpenProposals={() => setTab("proposals")}
              >
                <ValidationCard
                  persona={p}
                  sch={sch}
                  canRun={p.capabilities.can_edit && v?.state === "draft"}
                  onOpenSection={(k) => setSection(k)}
                  onOpenProposals={() => setTab("proposals")}
                />
              </AiPanel>
            </div>
          </aside>
        </div>
      )}

      {tab === "interview" && <InterviewTab persona={p} sch={sch} onProposals={() => setTab("proposals")} />}
      {tab === "proposals" && <ProposalsTab persona={p} sch={sch} version={v} dirty={dirty} />}
      {tab === "tests" && (
        <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Тесты не запускались">
          Лаборатория из шести групп: биографическая согласованность, устойчивость характера, границы компетенций,
          модель восприятия, языковая устойчивость, работа с неопределённостью. Результат — pass / warning / critical с
          объяснением, без «процента качества». Итерация 2.
        </EmptyState>
      )}
      {tab === "versions" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="panel p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-fg">
              <GitBranchPlus className="h-4 w-4 text-muted" /> Версии
            </h2>
            <ul className="divide-y divide-line text-sm">
              {p.versions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="font-mono font-semibold text-fg">v{x.label}</span>
                  <span className="chip border-line-strong text-xs text-fg-soft">{VERSION_STATE_LABEL[x.state]}</span>
                  <span className="font-mono text-[11px] text-muted">#{x.content_hash.slice(0, 10)}</span>
                  <span className="ml-auto text-xs text-muted">{fmtDateTime(x.updated_at)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Активная версия неизменна; правки идут в новый черновик.</p>
            {p.source_materials.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="label-mono mb-2">Исходные материалы</div>
                {p.source_materials.map((m) => (
                  <p key={m.id} className="whitespace-pre-wrap text-sm text-fg-soft">
                    {m.content}
                  </p>
                ))}
              </div>
            )}
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-fg">
              <History className="h-4 w-4 text-muted" /> Журнал
            </h2>
            {history.isLoading && <Spinner />}
            {history.error && <ErrorState error={history.error} />}
            <ul className="divide-y divide-line text-sm">
              {history.data?.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-fg-soft">{e.actor?.display_name ?? "Система"}</span>
                    <span className="text-muted">{ACTION_LABEL[e.action] ?? e.action}</span>
                    {e.entity_version && <span className="font-mono text-xs text-muted">v{e.entity_version}</span>}
                    <span className="ml-auto font-mono text-[11px] text-muted">{fmtDateTime(e.occurred_at)}</span>
                  </div>
                  {Array.isArray(e.details.changed) && (
                    <div className="mt-1 font-mono text-[11px] text-muted">{(e.details.changed as string[]).join(", ")}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Drawer для узких экранов */}
      <Modal open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)} title={drawer === "nav" ? "Разделы паспорта" : "ИИ-ассистент"}>
        {drawer === "nav" ? SectionNav : <AiPanel
                p={p}
                sectionTitle={sec.title}
                legend={legend}
                canRun={p.capabilities.can_edit && v?.state === "draft"}
                onDeepen={() => deepen.mutate(sec.key)}
                deepening={deepen.isPending}
                deepenError={deepen.error ? (deepen.error as ApiError).message : null}
                onOpenProposals={() => {
                  setDrawer(null);
                  setTab("proposals");
                }}
              >
                <ValidationCard
                  persona={p}
                  sch={sch}
                  canRun={p.capabilities.can_edit && v?.state === "draft"}
                  onOpenSection={(k) => {
                    setSection(k);
                    setDrawer(null);
                  }}
                  onOpenProposals={() => {
                    setDrawer(null);
                    setTab("proposals");
                  }}
                />
              </AiPanel>}
      </Modal>

      {v && activateOpen && <ActivationDialog persona={p} version={v} open={activateOpen} onOpenChange={setActivateOpen} />}

      <Modal open={blocker.state === "blocked"} onOpenChange={(o) => !o && blocker.reset?.()} title="Несохранённые правки">
        <p className="text-sm text-muted">Если уйти со страницы, изменения паспорта будут потеряны.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => blocker.proceed?.()}>
            Уйти без сохранения
          </button>
          <button className="btn-primary" onClick={() => blocker.reset?.()}>
            Остаться
          </button>
        </div>
      </Modal>
    </div>
  );
}
