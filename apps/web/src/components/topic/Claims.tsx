import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ExternalLink, Flag, History, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, get, post } from "../../api/client";
import type { Claim, ClaimHistoryEntry, ClaimKind, ClaimSource, ClaimStatus, TopicDetail, TopicVersionDetail } from "../../api/types";
import { CLAIM_STATUS_LABEL, fmtDateTime } from "../../lib/format";
import { EmptyState, Field, Modal } from "../ui";

const TONE: Record<ClaimStatus, string> = {
  verified: "border-success/40 text-success",
  unverified: "border-line-strong text-fg-soft",
  disputed: "border-warning/40 text-warning",
  refuted: "border-danger/40 text-danger",
  stale: "border-warning/40 text-warning",
};

export function ClaimStatusChip({ status }: { status: ClaimStatus }) {
  return <span className={clsx("chip", TONE[status])}>{CLAIM_STATUS_LABEL[status]}</span>;
}

const emptySource = (): ClaimSource => ({ title: "", url: "", quote: "", location: "" });

function blankClaim(): Claim {
  return {
    id: crypto.randomUUID(),
    text: "",
    status: "unverified",
    kind: "stable",
    event_date: null,
    published_at: null,
    checked_at: null,
    valid_from: null,
    valid_until: null,
    sources: [],
    origin: "editor",
    note: "",
  };
}

function ClaimDialog({
  initial,
  canVerify,
  onClose,
  onSave,
  saving,
  error,
}: {
  initial: Claim;
  canVerify: boolean;
  onClose: () => void;
  onSave: (c: Claim) => void;
  saving: boolean;
  error: unknown;
}) {
  const [c, setC] = useState<Claim>({ ...initial, sources: initial.sources.length ? initial.sources : [emptySource()] });
  const set = <K extends keyof Claim>(k: K, v: Claim[K]) => setC((x) => ({ ...x, [k]: v }));
  const setSrc = (i: number, patch: Partial<ClaimSource>) =>
    setC((x) => ({ ...x, sources: x.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const statuses: ClaimStatus[] = ["unverified", "disputed", "stale", "verified", "refuted"];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const sources = c.sources
      .map((s) => ({ ...s, url: s.url?.trim() || null, quote: s.quote?.trim() || null, location: s.location?.trim() || null }))
      .filter((s) => s.title.trim() || s.url || s.quote);
    onSave({ ...c, text: c.text.trim(), sources });
  };
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial.text ? "Утверждение" : "Новое утверждение"} description="Одно проверяемое утверждение с источником. «Подтверждено» ставит только редактор." wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Текст утверждения" htmlFor="ct">
          <textarea id="ct" className="input min-h-[70px]" value={c.text} onChange={(e) => set("text", e.target.value)} required minLength={3} maxLength={2000} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Статус" htmlFor="cs">
            <select id="cs" className="input" value={c.status} onChange={(e) => set("status", e.target.value as ClaimStatus)}>
              {statuses.map((s) => (
                <option key={s} value={s} disabled={(s === "verified" || s === "refuted") && !canVerify && initial.status !== s}>
                  {CLAIM_STATUS_LABEL[s]}
                  {(s === "verified" || s === "refuted") && !canVerify ? " — только редактор" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тип" htmlFor="ck">
            <select id="ck" className="input" value={c.kind} onChange={(e) => set("kind", e.target.value as ClaimKind)}>
              <option value="stable">устойчивое</option>
              <option value="operational">оперативное (сроки, даты)</option>
            </select>
          </Field>
          <Field label="Дата события" htmlFor="ce">
            <input id="ce" className="input" value={c.event_date ?? ""} onChange={(e) => set("event_date", e.target.value || null)} placeholder="25 ноября" maxLength={100} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Опубликовано" htmlFor="cp">
            <input id="cp" type="date" className="input" value={c.published_at ?? ""} onChange={(e) => set("published_at", e.target.value || null)} />
          </Field>
          <Field label="Проверено" htmlFor="cc">
            <input id="cc" type="date" className="input" value={c.checked_at ?? ""} onChange={(e) => set("checked_at", e.target.value || null)} />
          </Field>
          <Field label="Пересмотреть до" hint="После даты не считается подтверждённым" htmlFor="cu">
            <input id="cu" type="date" className="input" value={c.valid_until ?? ""} onChange={(e) => set("valid_until", e.target.value || null)} />
          </Field>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg-soft">Источники</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setC((x) => ({ ...x, sources: [...x.sources, emptySource()] }))}>
              <Plus className="h-3.5 w-3.5" /> Источник
            </button>
          </div>
          {c.sources.map((s, i) => (
            <div key={i} className="space-y-2 rounded-ui border border-line p-3">
              <div className="flex gap-2">
                <input className="input" placeholder="Название источника" value={s.title} onChange={(e) => setSrc(i, { title: e.target.value })} aria-label="Название источника" />
                <button type="button" className="btn-ghost btn-sm" onClick={() => setC((x) => ({ ...x, sources: x.sources.filter((_, j) => j !== i) }))} aria-label="Убрать источник">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input className="input" placeholder="https://…" value={s.url ?? ""} onChange={(e) => setSrc(i, { url: e.target.value })} aria-label="Ссылка" />
              <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                <input className="input" placeholder="Цитата из источника" value={s.quote ?? ""} onChange={(e) => setSrc(i, { quote: e.target.value })} aria-label="Цитата" />
                <input className="input" placeholder="Где: стр., абзац" value={s.location ?? ""} onChange={(e) => setSrc(i, { location: e.target.value })} aria-label="Место в источнике" />
              </div>
            </div>
          ))}
        </div>
        <Field label="Примечание" htmlFor="cn">
          <input id="cn" className="input" value={c.note} onChange={(e) => set("note", e.target.value)} maxLength={2000} />
        </Field>
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {(error as ApiError).message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={saving || c.text.trim().length < 3}>
            {saving ? "Сохранение…" : "Сохранить в черновик"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FlagDialog({ topic, claim, onClose }: { topic: TopicDetail; claim: Claim; onClose: () => void }) {
  const qc = useQueryClient();
  const current = topic.flags.find((f) => f.claim_id === claim.id);
  const [flag, setFlag] = useState<"refuted" | "disputed" | "stale" | "cleared">(current ? "cleared" : "refuted");
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => post(`/topics/${topic.id}/claim-flags`, { claim_id: claim.id, flag, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["topic", topic.id] });
      qc.invalidateQueries({ queryKey: ["topic-version"] });
      qc.invalidateQueries({ queryKey: ["topics"] });
      onClose();
    },
  });
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Пометка утверждения" description="Срочно: утверждение перестаёт считаться подтверждённым, версия не переписывается. Тема остаётся активной.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="space-y-4"
      >
        <p className="rounded-ui bg-elevated p-3 text-sm text-fg">{claim.text}</p>
        <Field label="Пометка" htmlFor="ff">
          <select id="ff" className="input" value={flag} onChange={(e) => setFlag(e.target.value as typeof flag)}>
            <option value="refuted">опровергнуто — не использовать</option>
            <option value="disputed">спорно — нужна проверка</option>
            <option value="stale">устарело</option>
            {current && <option value="cleared">снять пометку</option>}
          </select>
        </Field>
        <Field label="Причина" hint="Попадёт в журнал и историю утверждения" htmlFor="fr">
          <textarea id="fr" className="input min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={2000} />
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
          <button type="submit" className="btn-primary" disabled={m.isPending || reason.trim().length < 3}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClaimHistory({ topicId, claimId }: { topicId: string; claimId: string }) {
  const h = useQuery({
    queryKey: ["claim-history", topicId, claimId],
    queryFn: () => get<ClaimHistoryEntry[]>(`/topics/${topicId}/claims/${claimId}/history`),
  });
  if (!h.data) return <p className="text-xs text-muted">Загрузка…</p>;
  return (
    <ol className="space-y-1.5 border-l border-line pl-3 text-xs">
      {h.data.map((e, i) => (
        <li key={i} className="text-muted">
          <span className="font-mono">{fmtDateTime(e.at)}</span>{" "}
          {e.kind === "version" ? (
            <>
              v{e.version_label} ({e.version_state}): <span className="text-fg-soft">{e.text}</span> — {e.status && CLAIM_STATUS_LABEL[e.status]}
            </>
          ) : (
            <>
              пометка «{e.flag === "cleared" ? "снята" : CLAIM_STATUS_LABEL[e.flag ?? ""]}»: {e.reason}
            </>
          )}
          {e.actor && <span> · {e.actor.display_name}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ClaimsPanel({
  topic,
  version,
  editable,
  onSaveClaims,
  saving,
  saveError,
}: {
  topic: TopicDetail;
  version: TopicVersionDetail;
  editable: boolean;
  onSaveClaims: (claims: Claim[], done: () => void) => void;
  saving: boolean;
  saveError: unknown;
}) {
  const [editing, setEditing] = useState<Claim | null>(null);
  const [flagging, setFlagging] = useState<Claim | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const claims = version.dossier.claims;
  const eff = new Map(version.claims_effective.map((e) => [e.id, e]));
  const canFlag = topic.capabilities.can_flag && version.state === "active";

  const save = (c: Claim) => {
    const exists = claims.some((x) => x.id === c.id);
    onSaveClaims(exists ? claims.map((x) => (x.id === c.id ? c : x)) : [...claims, c], () => setEditing(null));
  };
  const remove = (c: Claim) => {
    if (window.confirm(`Убрать утверждение из черновика?\n\n«${c.text}»`)) onSaveClaims(claims.filter((x) => x.id !== c.id), () => {});
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Подтверждённым в ответах считается только «подтверждено» — без пометки и в пределах срока. Понимание ИИ не равно проверке.
        </p>
        {editable && (
          <button className="btn-primary btn-sm" onClick={() => setEditing(blankClaim())}>
            <Plus className="h-4 w-4" /> Утверждение
          </button>
        )}
      </div>
      {claims.length === 0 && (
        <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="Утверждений пока нет">
          Добавьте проверяемые факты с источниками: что, когда, кто сообщил, где это сказано.
        </EmptyState>
      )}
      {claims.map((c) => {
        const e = eff.get(c.id);
        const status = (e?.effective_status ?? c.status) as ClaimStatus;
        return (
          <article key={c.id} className={clsx("panel p-4", e?.flag && "border-warning/50")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <ClaimStatusChip status={status} />
                {status !== c.status && <span className="text-xs text-muted">в версии: {CLAIM_STATUS_LABEL[c.status]}</span>}
                <span className="chip border-line text-muted">{c.kind === "operational" ? "оперативное" : "устойчивое"}</span>
                {c.origin !== "editor" && <span className="chip border-line text-muted">{c.origin === "ai_suggestion" ? "из предложения ИИ" : c.origin}</span>}
              </div>
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => setHistoryOf(historyOf === c.id ? null : c.id)} aria-label="История утверждения" title="История">
                  <History className="h-4 w-4" />
                </button>
                {canFlag && (
                  <button className="btn-ghost btn-sm" onClick={() => setFlagging(c)} aria-label="Пометить" title="Срочная пометка">
                    <Flag className="h-4 w-4" />
                  </button>
                )}
                {editable && (
                  <>
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(c)} aria-label="Править" title="Править">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => remove(c)} aria-label="Убрать" title="Убрать">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-2 text-[15px] leading-snug text-fg">{c.text}</p>
            {e?.flag && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Пометка «{CLAIM_STATUS_LABEL[e.flag.flag]}»: {e.flag.reason}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
              {c.event_date && <span>событие: {c.event_date}</span>}
              {c.published_at && <span>опубл.: {c.published_at}</span>}
              {c.checked_at && <span>проверено: {c.checked_at}</span>}
              {c.valid_until && <span>пересмотреть до: {c.valid_until}</span>}
            </div>
            {c.sources.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm">
                {c.sources.map((s, i) => (
                  <li key={i} className="text-fg-soft">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">
                        {s.title || s.url} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span>{s.title || "источник без ссылки"}</span>
                    )}
                    {s.quote && <span className="text-muted"> — «{s.quote}»</span>}
                    {s.location && <span className="text-muted"> ({s.location})</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted">Источник не указан</p>
            )}
            {c.note && <p className="mt-1 text-xs text-muted">{c.note}</p>}
            {historyOf === c.id && (
              <div className="mt-3">
                <ClaimHistory topicId={topic.id} claimId={c.id} />
              </div>
            )}
          </article>
        );
      })}
      {editing && (
        <ClaimDialog
          initial={editing}
          canVerify={topic.capabilities.can_verify_claims}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={saveError}
        />
      )}
      {flagging && <FlagDialog topic={topic} claim={flagging} onClose={() => setFlagging(null)} />}
    </div>
  );
}
