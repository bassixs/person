import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, CopyPlus, PauseCircle, Plus, Save, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, get, post, put } from "../api/client";
import type { AuditEvent, Claim, Dossier, TopicCheck, TopicDetail, TopicVersionDetail } from "../api/types";
import { ClaimsPanel } from "../components/topic/Claims";
import { TopicStatusBadge } from "../components/topic/TopicsCatalog";
import { ErrorState, Field, Modal, Spinner } from "../components/ui";
import { ACTION_LABEL, fmtDateTime, VERSION_STATE_LABEL } from "../lib/format";

type Tab = "dossier" | "claims" | "versions";

function ListEditor({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  return (
    <Field label={label} hint={hint ?? "По одному пункту в строке"}>
      <textarea
        className="input min-h-[84px]"
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        disabled={disabled}
        aria-label={label}
      />
    </Field>
  );
}

function cleanDossier(d: Dossier): Dossier {
  const strip = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);
  return {
    ...d,
    participants: strip(d.participants),
    residents_questions: strip(d.residents_questions),
    unknowns: strip(d.unknowns),
    conflicts: strip(d.conflicts),
    faq: d.faq.filter((f) => f.question.trim()),
  };
}

function DossierForm({ draft, setDraft, editable }: { draft: Dossier; setDraft: (d: Dossier) => void; editable: boolean }) {
  const set = <K extends keyof Dossier>(k: K, v: Dossier[K]) => setDraft({ ...draft, [k]: v });
  const dis = !editable;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4 lg:col-span-2">
        <Field label="Суть" hint="Что происходит — коротко и без оценок">
          <textarea className="input min-h-[90px]" value={draft.summary} onChange={(e) => set("summary", e.target.value)} disabled={dis} maxLength={8000} />
        </Field>
        <Field label="Предыстория">
          <textarea className="input min-h-[120px]" value={draft.background} onChange={(e) => set("background", e.target.value)} disabled={dis} maxLength={20000} />
        </Field>
      </div>
      <Field label="Территория">
        <input className="input" value={draft.territory} onChange={(e) => set("territory", e.target.value)} disabled={dis} maxLength={1000} />
      </Field>
      <Field label="Сроки">
        <input className="input" value={draft.timeframe} onChange={(e) => set("timeframe", e.target.value)} disabled={dis} maxLength={500} placeholder="с 1 октября по декабрь" />
      </Field>
      <ListEditor label="Участники" hint="Организации и роли, без персональных профилей жителей" value={draft.participants} onChange={(v) => set("participants", v)} disabled={dis} />
      <ListEditor label="Вопросы жителей" hint="Повторяющиеся вопросы, по одному в строке" value={draft.residents_questions} onChange={(v) => set("residents_questions", v)} disabled={dis} />
      <ListEditor label="Неизвестно" hint="Чего мы не знаем — не домысливать" value={draft.unknowns} onChange={(v) => set("unknowns", v)} disabled={dis} />
      <ListEditor label="Противоречия" value={draft.conflicts} onChange={(v) => set("conflicts", v)} disabled={dis} />
      <div className="space-y-2 lg:col-span-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-fg-soft">FAQ и пробелы в разъяснениях</span>
          {editable && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => set("faq", [...draft.faq, { question: "", answer: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Вопрос
            </button>
          )}
        </div>
        {draft.faq.length === 0 && <p className="text-xs text-muted">Пока пусто.</p>}
        {draft.faq.map((f, i) => (
          <div key={i} className="grid gap-2 rounded-ui border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
            <input className="input" placeholder="Вопрос" value={f.question} disabled={dis} aria-label="Вопрос" onChange={(e) => set("faq", draft.faq.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
            <input className="input" placeholder="Ответ (пусто — пробел в разъяснениях)" value={f.answer} disabled={dis} aria-label="Ответ" onChange={(e) => set("faq", draft.faq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
            {editable && (
              <button type="button" className="btn-ghost btn-sm" aria-label="Убрать вопрос" onClick={() => set("faq", draft.faq.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ApproveDialog({ topic, version, onClose }: { topic: TopicDetail; version: TopicVersionDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const check = useQuery({
    queryKey: ["topic-check", version.id, version.content_hash],
    queryFn: () => get<TopicCheck>(`/topics/${topic.id}/activation-check`, { version_id: version.id }),
  });
  const m = useMutation({
    mutationFn: () => post(`/topics/${topic.id}/activate`, { version_id: version.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["topic", topic.id] });
      qc.invalidateQueries({ queryKey: ["topic-version", topic.id] });
      qc.invalidateQueries({ queryKey: ["topics"] });
      qc.invalidateQueries({ queryKey: ["topic-history", topic.id] });
      onClose();
    },
  });
  const blockers = check.data?.blockers ?? [];
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Утвердить тему v${version.label}`} description="Версия станет активной и неизменной. Предыдущая активная — заменённой.">
      {check.isLoading && <Spinner label="Проверка условий…" />}
      {check.data && (
        <div className="space-y-3 text-sm">
          {blockers.length === 0 ? (
            <p className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" /> Блокирующих условий нет
            </p>
          ) : (
            <ul className="space-y-1">
              {blockers.map((b, i) => (
                <li key={i} className="text-danger">
                  • {b.message}
                </li>
              ))}
            </ul>
          )}
          {check.data.warnings.length > 0 && (
            <ul className="space-y-1">
              {check.data.warnings.map((w, i) => (
                <li key={i} className="text-warning">
                  • {w.message}
                </li>
              ))}
            </ul>
          )}
          <p className="font-mono text-[11px] text-muted">хэш содержимого {version.content_hash.slice(0, 12)}</p>
        </div>
      )}
      {m.error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {(m.error as ApiError).message}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn-primary" disabled={!check.data || blockers.length > 0 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Утверждение…" : "Утвердить"}
        </button>
      </div>
    </Modal>
  );
}

export function TopicEditorPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("dossier");
  const [viewId, setViewId] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const topic = useQuery({ queryKey: ["topic", id], queryFn: () => get<TopicDetail>(`/topics/${id}`) });
  const t = topic.data;
  const defaultVersion = t?.draft_version?.id ?? t?.active_version?.id ?? t?.versions[0]?.id ?? null;
  const versionId = viewId && t?.versions.some((v) => v.id === viewId) ? viewId : defaultVersion;
  const version = useQuery({
    queryKey: ["topic-version", id, versionId],
    queryFn: () => get<TopicVersionDetail>(`/topics/${id}/versions/${versionId}`),
    enabled: !!versionId,
  });
  const history = useQuery({
    queryKey: ["topic-history", id],
    queryFn: () => get<AuditEvent[]>(`/topics/${id}/history`),
    enabled: tab === "versions",
  });
  const v = version.data;
  const editable = !!t && !!v && v.state === "draft" && t.capabilities.can_edit;

  const [draft, setDraft] = useState<Dossier | null>(null);
  useEffect(() => {
    if (v) setDraft(v.dossier);
  }, [v]);
  const dirty = useMemo(() => !!v && !!draft && JSON.stringify(cleanDossier(draft)) !== JSON.stringify(cleanDossier(v.dossier)), [draft, v]);
  const [notes, setNotes] = useState<string[]>([]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["topic", id] });
    qc.invalidateQueries({ queryKey: ["topic-version", id] });
    qc.invalidateQueries({ queryKey: ["topic-history", id] });
    qc.invalidateQueries({ queryKey: ["topics"] });
  };
  const save = useMutation({
    mutationFn: (d: Dossier) => put<{ version: TopicVersionDetail; notes: string[] }>(`/topics/${id}/versions/${v!.id}`, { dossier: cleanDossier(d), expected_revision: v!.revision }),
    onSuccess: (r) => {
      setNotes(r.notes);
      qc.setQueryData(["topic-version", id, r.version.id], r.version);
      invalidate();
    },
  });
  const saveClaims = (claims: Claim[], done: () => void) => {
    if (!draft) return;
    save.mutate({ ...draft, claims }, { onSuccess: done });
  };
  const submit = useMutation({ mutationFn: () => post(`/topics/${id}/submit`, { version_id: v!.id }), onSuccess: invalidate });
  const newVersion = useMutation({
    mutationFn: () => post<TopicVersionDetail>(`/topics/${id}/versions`),
    onSuccess: (nv) => {
      setViewId(nv.id);
      invalidate();
    },
  });
  const suspend = useMutation({
    mutationFn: (reason: string) => post(`/topics/${id}/versions/${t!.active_version!.id}/suspend`, { reason }),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: () => post(`/topics/${id}/${t!.status === "archived" ? "unarchive" : "archive"}`),
    onSuccess: invalidate,
  });
  const actionError = (submit.error || newVersion.error || suspend.error || archive.error) as ApiError | null;

  if (topic.isLoading) return <div className="shell"><Spinner /></div>;
  if (topic.error || !t) return <div className="shell"><ErrorState error={topic.error} onRetry={() => topic.refetch()} /></div>;

  return (
    <div>
      <Link to="/context/topics" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Все темы
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TopicStatusBadge status={t.status} />
            <span className="font-mono text-xs text-muted">{[t.geography, t.category].filter(Boolean).join(" · ")}</span>
          </div>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight text-fg sm:text-2xl">{t.title}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.versions.map((x) => (
              <button
                key={x.id}
                onClick={() => setViewId(x.id)}
                className={clsx("chip font-mono", x.id === versionId ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}
              >
                v{x.label} · {VERSION_STATE_LABEL[x.state] ?? x.state}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && t.capabilities.can_submit && t.status !== "under_review" && (
            <button className="btn-ghost" onClick={() => submit.mutate()} disabled={submit.isPending || dirty} title={dirty ? "Сначала сохраните" : undefined}>
              <Send className="h-4 w-4" /> На согласование
            </button>
          )}
          {editable && t.capabilities.can_activate && (
            <button className="btn-primary" onClick={() => setApproveOpen(true)} disabled={dirty} title={dirty ? "Сначала сохраните" : undefined}>
              <CheckCircle2 className="h-4 w-4" /> Утвердить
            </button>
          )}
          {!t.draft_version && t.active_version && t.capabilities.can_edit && (
            <button className="btn-ghost" onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>
              <CopyPlus className="h-4 w-4" /> Новая версия
            </button>
          )}
          {t.active_version && t.capabilities.can_flag && (
            <button
              className="btn-ghost"
              onClick={() => {
                const r = window.prompt("Причина приостановки темы (попадёт в журнал):");
                if (r && r.trim().length >= 3) suspend.mutate(r.trim());
              }}
            >
              <PauseCircle className="h-4 w-4" /> Приостановить
            </button>
          )}
          {t.capabilities.can_archive && (
            <button
              className="btn-ghost"
              onClick={() => (t.status === "archived" || window.confirm("Отправить тему в архив? Действие обратимо.")) && archive.mutate()}
              aria-label={t.status === "archived" ? "Вернуть из архива" : "В архив"}
              title={t.status === "archived" ? "Вернуть из архива" : "В архив"}
            >
              {t.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
      {actionError && (
        <div className="mb-4 rounded-ui border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {actionError.message}
          {Array.isArray(actionError.details) && (
            <ul className="mt-1 list-disc pl-5">
              {(actionError.details as { message: string }[]).map((d, i) => (
                <li key={i}>{d.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <nav className="mb-5 flex gap-1 border-b border-line" aria-label="Разделы темы">
        {(
          [
            ["dossier", "Досье"],
            ["claims", `Утверждения${v ? ` · ${v.dossier.claims.length}` : ""}`],
            ["versions", "Версии и журнал"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx("relative px-3 pb-2.5 pt-1 text-sm font-medium", tab === k ? "text-fg" : "text-muted hover:text-fg-soft")}>
            {label}
            {tab === k && <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-accent" />}
          </button>
        ))}
      </nav>

      {version.isLoading && <Spinner />}
      {v && !editable && tab !== "versions" && (
        <p className="mb-4 text-sm text-muted">
          {v.state === "draft" ? "Только просмотр." : `Версия v${v.label} ${VERSION_STATE_LABEL[v.state] ?? v.state} и неизменна.`}
          {v.state !== "draft" && t.draft_version && " Правки — в черновике."}
        </p>
      )}
      {notes.length > 0 && (
        <div className="mb-4 rounded-ui border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
          {notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      {v && draft && tab === "dossier" && (
        <div className="panel p-5">
          <DossierForm draft={draft} setDraft={setDraft} editable={editable} />
          {editable && (
            <div className="mt-5 flex items-center justify-end gap-3">
              {save.error && <span className="text-sm text-danger">{(save.error as ApiError).message}</span>}
              {dirty && <span className="text-xs text-muted">Есть несохранённые изменения</span>}
              <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
                <Save className="h-4 w-4" /> {save.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          )}
        </div>
      )}

      {v && tab === "claims" && (
        <ClaimsPanel topic={t} version={v} editable={editable && !dirty} onSaveClaims={saveClaims} saving={save.isPending} saveError={save.error} />
      )}
      {v && tab === "claims" && editable && dirty && <p className="mt-3 text-sm text-warning">Сначала сохраните изменения досье.</p>}

      {tab === "versions" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="panel p-5">
            <h3 className="mb-3 text-base font-semibold text-fg">Версии</h3>
            <ul className="space-y-2 text-sm">
              {t.versions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <span>
                    <span className="font-mono">v{x.label}</span> · {VERSION_STATE_LABEL[x.state] ?? x.state}
                    {x.change_note && <span className="text-muted"> — {x.change_note}</span>}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {x.approved_at ? `утв. ${fmtDateTime(x.approved_at)}${x.approved_by ? ` · ${x.approved_by.display_name}` : ""}` : fmtDateTime(x.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel p-5">
            <h3 className="mb-3 text-base font-semibold text-fg">Журнал</h3>
            {history.isLoading && <Spinner />}
            <ul className="space-y-2 text-sm">
              {history.data?.map((e) => (
                <li key={e.id} className="border-b border-line pb-2 last:border-0">
                  <span className="text-fg">{e.actor?.display_name ?? "система"}</span> <span className="text-muted">{ACTION_LABEL[e.action] ?? e.action}</span>
                  {e.entity_version && <span className="font-mono text-xs text-muted"> v{e.entity_version}</span>}
                  {typeof e.details?.reason === "string" && <span className="text-muted"> — {e.details.reason}</span>}
                  <div className="font-mono text-[11px] text-muted">{fmtDateTime(e.occurred_at)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {approveOpen && v && <ApproveDialog topic={t} version={v} onClose={() => setApproveOpen(false)} />}
    </div>
  );
}
