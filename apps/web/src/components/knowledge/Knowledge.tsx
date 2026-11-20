import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, Database, Download, ExternalLink, FileText, Globe, Link2, Plus, Search, Upload } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, get, post, upload } from "../../api/client";
import type { KnowledgeItem, KnowledgeItemDetail, Page, SearchHit, SourceOut, TopicListItem } from "../../api/types";
import { useAuth } from "../../lib/auth";
import { EXTRACTION_LABEL, fmtBytes, fmtDate } from "../../lib/format";
import { EmptyState, ErrorState, Field, Modal, Spinner } from "../ui";

const EX_TONE: Record<string, string> = {
  ok: "border-success/40 text-success",
  partial: "border-warning/40 text-warning",
  failed: "border-danger/40 text-danger",
  unsupported: "border-line-strong text-muted",
};

export function ExtractionChip({ status }: { status: string }) {
  return <span className={clsx("chip", EX_TONE[status])}>{EXTRACTION_LABEL[status] ?? status}</span>;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "url") return <Globe className="h-4 w-4 text-muted" />;
  if (kind === "text") return <FileText className="h-4 w-4 text-muted" />;
  return <Database className="h-4 w-4 text-muted" />;
}

/** Цитата поиска: совпадения размечены сервером ⟦…⟧. */
function Excerpt({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/g);
  return (
    <p className="mt-1.5 text-sm leading-snug text-fg-soft">
      {parts.map((p, i) =>
        p.startsWith("⟦") ? (
          <mark key={i} className="rounded-sm bg-accent/20 px-0.5 text-fg">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

function TopicPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const topics = useQuery({ queryKey: ["topics", "picker"], queryFn: () => get<Page<TopicListItem>>("/topics", { page_size: 200 }) });
  const items = topics.data?.items ?? [];
  if (topics.isLoading) return <p className="text-xs text-muted">Загрузка тем…</p>;
  if (items.length === 0) return <p className="text-xs text-muted">Тем пока нет — создайте тему в разделе «Темы».</p>;
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-ui border border-line p-2">
      {items.map((t) => (
        <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm text-fg-soft">
          <input type="checkbox" checked={value.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))} />
          {t.title}
        </label>
      ))}
    </div>
  );
}

export function AddMaterialDialog({ open, onOpenChange, presetTopic }: { open: boolean; onOpenChange: (v: boolean) => void; presetTopic?: string }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [mode, setMode] = useState<"file" | "url" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [layer, setLayer] = useState<"global" | "topic">(presetTopic ? "topic" : "global");
  const [topicIds, setTopicIds] = useState<string[]>(presetTopic ? [presetTopic] : []);
  const [sourceId, setSourceId] = useState("");
  const [published, setPublished] = useState("");
  const [result, setResult] = useState<KnowledgeItemDetail | null>(null);
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => get<SourceOut[]>("/sources"), enabled: open && can("source.read") });

  useEffect(() => {
    if (!open) {
      setResult(null);
      setFile(null);
      setUrl("");
      setTitle("");
      setBody("");
    }
  }, [open]);

  const m = useMutation({
    mutationFn: async () => {
      const meta = { title, layer, topic_ids: topicIds, source_id: sourceId || null, published_at: published || null };
      if (mode === "file") {
        const f = new FormData();
        f.append("file", file!);
        f.append("title", title);
        f.append("layer", layer);
        topicIds.forEach((t) => f.append("topic_ids", t));
        if (sourceId) f.append("source_id", sourceId);
        if (published) f.append("published_at", published);
        return upload<KnowledgeItemDetail>("/knowledge/files", f);
      }
      if (mode === "url") return post<KnowledgeItemDetail>("/knowledge/urls", { ...meta, url });
      return post<KnowledgeItemDetail>("/knowledge/texts", { ...meta, text: body });
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const ready = (mode === "file" ? !!file : mode === "url" ? url.trim().length > 8 : title.trim().length >= 3 && body.trim().length >= 10) && (layer === "global" || topicIds.length > 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const err = m.error as ApiError | null;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Добавить материал" description="Материал — не факт. Подтверждённые утверждения появляются только в досье темы через редактора." wide>
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ExtractionChip status={result.extraction_status} />
            <span className="font-medium text-fg">{result.title}</span>
          </div>
          <p className="text-muted">{result.extraction_note}</p>
          {result.text && <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-ui bg-elevated p-3 text-xs text-fg-soft">{result.text.slice(0, 1500)}</pre>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setResult(null)}>
              Добавить ещё
            </button>
            <button className="btn-primary" onClick={() => onOpenChange(false)}>
              Готово
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex gap-1 rounded-ui border border-line p-1" role="tablist">
            {(
              [
                ["file", "Файл", <Upload key="u" className="h-4 w-4" />],
                ["url", "Ссылка", <Link2 key="l" className="h-4 w-4" />],
                ["text", "Текст", <FileText key="t" className="h-4 w-4" />],
              ] as [typeof mode, string, ReactNode][]
            ).map(([k, label, icon]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={clsx("btn-sm btn flex-1 justify-center", mode === k ? "bg-elevated text-fg" : "text-muted")}>
                {icon} {label}
              </button>
            ))}
          </div>
          {mode === "file" && (
            <Field label="Файл" hint="TXT, MD, CSV, PDF, DOCX, XLSX, PNG, JPG, WEBP — до 20 МБ. Формат проверяется по содержимому." htmlFor="kf">
              <input id="kf" type="file" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".txt,.md,.csv,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp" />
            </Field>
          )}
          {mode === "url" && (
            <Field label="Ссылка" hint="Только публичные страницы. Внутренние адреса, закрытый доступ и капчи не обходятся." htmlFor="ku">
              <input id="ku" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
          )}
          <Field label="Название" hint={mode === "text" ? undefined : "Можно оставить пустым — возьмём из файла или страницы"} htmlFor="kt">
            <input id="kt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
          </Field>
          {mode === "text" && (
            <Field label="Текст" htmlFor="kb">
              <textarea id="kb" className="input min-h-[140px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={200000} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Слой" htmlFor="kl">
              <select id="kl" className="input" value={layer} onChange={(e) => setLayer(e.target.value as "global" | "topic")}>
                <option value="global">Глобальная база</option>
                <option value="topic">Материал темы</option>
              </select>
            </Field>
            <Field label="Дата публикации" htmlFor="kp">
              <input id="kp" type="date" className="input" value={published} onChange={(e) => setPublished(e.target.value)} />
            </Field>
          </div>
          <Field label={layer === "topic" ? "Темы (обязательно)" : "Связать с темами"}>
            <TopicPicker value={topicIds} onChange={setTopicIds} />
          </Field>
          {can("source.read") && (
            <Field label="Источник из реестра" htmlFor="ks">
              <select id="ks" className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">— не указан —</option>
                {sources.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {err && (
            <p className="text-sm text-danger" role="alert">
              {err.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={!ready || m.isPending}>
              {m.isPending ? (mode === "url" ? "Получение…" : "Загрузка…") : "Добавить"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ItemDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ["knowledge", "item", id], queryFn: () => get<KnowledgeItemDetail>(`/knowledge/${id}`) });
  const archive = useMutation({
    mutationFn: () => post(`/knowledge/${id}/${q.data?.archived_at ? "unarchive" : "archive"}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      onClose();
    },
  });
  const it = q.data;
  const canArchive = it && (can("knowledge.manage") || (can("knowledge.add") && it.created_by?.id === me?.id));
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={it?.title ?? "Материал"} wide>
      {q.isLoading && <Spinner />}
      {it && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ExtractionChip status={it.extraction_status} />
            <span className="chip border-line text-muted">{it.layer === "topic" ? "материал темы" : "глобальная база"}</span>
            <span className="font-mono text-[11px] text-muted">
              {it.format.toUpperCase()} {fmtBytes(it.size_bytes)} · {it.text_chars.toLocaleString("ru-RU")} симв.
            </span>
          </div>
          <p className="text-muted">{it.extraction_note}</p>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[140px_1fr]">
            {it.url && (
              <>
                <dt className="text-muted">Ссылка</dt>
                <dd>
                  <a href={it.final_url ?? it.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                    {it.final_url ?? it.url} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </dd>
              </>
            )}
            {it.source && (
              <>
                <dt className="text-muted">Источник</dt>
                <dd>{it.source.name}</dd>
              </>
            )}
            {it.topics.length > 0 && (
              <>
                <dt className="text-muted">Темы</dt>
                <dd>{it.topics.map((t) => t.title).join(", ")}</dd>
              </>
            )}
            {it.published_at && (
              <>
                <dt className="text-muted">Опубликовано</dt>
                <dd>{it.published_at}</dd>
              </>
            )}
            <dt className="text-muted">Добавлен</dt>
            <dd>
              {fmtDate(it.created_at)}
              {it.created_by && ` · ${it.created_by.display_name}`}
            </dd>
          </dl>
          {it.text ? (
            <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-ui bg-elevated p-3 text-xs leading-relaxed text-fg-soft">{it.text}</pre>
          ) : (
            <p className="rounded-ui bg-elevated p-3 text-xs text-muted">Текста нет.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {it.has_file && (
              <a className="btn-ghost" href={`/api/v1/knowledge/${it.id}/file`}>
                <Download className="h-4 w-4" /> Исходный файл
              </a>
            )}
            {canArchive && (
              <button className="btn-ghost" onClick={() => archive.mutate()} disabled={archive.isPending}>
                <Archive className="h-4 w-4" /> {it.archived_at ? "Вернуть из архива" : "В архив"}
              </button>
            )}
          </div>
          {archive.error && <p className="text-sm text-danger">{(archive.error as ApiError).message}</p>}
        </div>
      )}
    </Modal>
  );
}

export function KnowledgeList({ topicId }: { topicId?: string }) {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [layer, setLayer] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const searching = dq.length >= 2;
  const list = useQuery({
    queryKey: ["knowledge", "list", topicId, layer],
    queryFn: () => get<Page<KnowledgeItem>>("/knowledge", { topic_id: topicId, layer: layer || undefined, page_size: 200 }),
    enabled: !searching,
  });
  const search = useQuery({
    queryKey: ["knowledge", "search", dq, topicId, layer],
    queryFn: () => get<SearchHit[]>("/knowledge/search", { q: dq, topic_id: topicId, layer: layer || undefined }),
    enabled: searching,
  });
  const rows: { item: KnowledgeItem; excerpt?: string }[] = searching ? (search.data ?? []).map((h) => ({ item: h.item, excerpt: h.excerpt })) : (list.data?.items ?? []).map((item) => ({ item }));
  const loading = searching ? search.isLoading : list.isLoading;
  const error = searching ? search.error : list.error;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Поиск по тексту материалов" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по материалам" />
          </div>
          {!topicId && (
            <select className="input w-auto" value={layer} onChange={(e) => setLayer(e.target.value)} aria-label="Слой">
              <option value="">Все слои</option>
              <option value="global">Глобальная база</option>
              <option value="topic">Материалы тем</option>
            </select>
          )}
        </div>
        {can("knowledge.add") && (
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Материал
          </button>
        )}
      </div>
      {loading && <Spinner />}
      {error ? <ErrorState error={error} /> : null}
      {!loading && rows.length === 0 && (
        <EmptyState icon={<Database className="h-8 w-8" />} title={searching ? "Ничего не найдено" : "Материалов пока нет"}>
          {searching ? "Поиск учитывает формы слов. Попробуйте другие слова." : "Загрузите документ, добавьте ссылку или текст. Текст извлекается автоматически; статус показывает, что удалось разобрать."}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(({ item, excerpt }) => (
            <li key={item.id}>
              <button className="panel w-full p-4 text-left transition-colors hover:border-accent/40" onClick={() => setOpen(item.id)}>
                <div className="flex flex-wrap items-center gap-2">
                  <KindIcon kind={item.kind} />
                  <span className="font-medium text-fg">{item.title}</span>
                  <ExtractionChip status={item.extraction_status} />
                  {item.layer === "topic" && <span className="chip border-line text-muted">тема</span>}
                </div>
                {excerpt ? (
                  <Excerpt text={excerpt} />
                ) : (
                  <div className="mt-1 font-mono text-[11px] text-muted">
                    {item.format.toUpperCase()}
                    {item.size_bytes ? ` · ${fmtBytes(item.size_bytes)}` : ""}
                    {item.source ? ` · ${item.source.name}` : ""}
                    {item.topics.length ? ` · ${item.topics.map((t) => t.title).join(", ")}` : ""} · {fmtDate(item.created_at)}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ItemDialog id={open} onClose={() => setOpen(null)} />}
      {can("knowledge.add") && <AddMaterialDialog open={addOpen} onOpenChange={setAddOpen} presetTopic={topicId} />}
    </div>
  );
}
