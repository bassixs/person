import clsx from "clsx";
import { Link2, Plus, X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import type { Certainty, PassportField, PassportSchema, SchemaField } from "../../api/types";

const CERTAINTY_TONE: Record<Certainty, string> = {
  defined: "border-success/50 bg-success/10 text-success",
  hypothesis: "border-warning/50 bg-warning/10 text-warning",
  unknown: "border-line-strong bg-elevated text-muted",
};
const SOURCE_TONE: Record<string, string> = {
  original_legend: "border-info/40 text-info",
  editor: "border-line-strong text-fg-soft",
  ai_suggestion: "border-accent/50 text-accent",
};

function TagsInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className={clsx("input flex min-h-[40px] flex-wrap items-center gap-1.5 py-1.5", disabled && "opacity-60")}>
      {value.map((t) => (
        <span key={t} className="chip border-line-strong bg-elevated text-fg-soft">
          {t}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Удалить «${t}»`} className="text-muted hover:text-fg">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          id={id}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted/70"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={value.length ? "" : "Введите и нажмите Enter"}
        />
      )}
    </div>
  );
}

export function FieldEditor({
  sectionKey,
  field,
  meta,
  schema,
  onChange,
  readOnly,
}: {
  sectionKey: string;
  field: PassportField;
  meta: SchemaField;
  schema: PassportSchema;
  onChange: (f: PassportField) => void;
  readOnly: boolean;
}) {
  const id = useId();
  const [showDeps, setShowDeps] = useState(false);
  const isEmpty = field.value === null || (Array.isArray(field.value) && field.value.length === 0) || field.value === "";

  const setValue = (value: string | string[]) => {
    const empty = Array.isArray(value) ? value.length === 0 : value.trim() === "";
    // Ввод значения переводит «неизвестно» в «определено»; очистка — обратно в «неизвестно».
    const certainty: Certainty = empty ? "unknown" : field.certainty === "unknown" ? "defined" : field.certainty;
    onChange({ ...field, value: empty ? null : value, certainty });
  };
  const setCertainty = (c: Certainty) => {
    if (c === "unknown") onChange({ ...field, value: null, certainty: "unknown", editor_approved: false });
    else onChange({ ...field, certainty: c });
  };

  const path = `${sectionKey}.${meta.key}`;
  const allPaths = schema.sections.flatMap((s) =>
    s.fields.map((f) => ({ path: `${s.key}.${f.key}`, label: `${s.title} → ${f.label}` })),
  ).filter((p) => p.path !== path);

  return (
    <div className="rounded-ui border border-line bg-canvas/40 p-4 transition-colors focus-within:border-line-strong">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="mr-auto text-sm font-semibold text-fg">
          {meta.label}
        </label>
        {!isEmpty && (
          <span className={clsx("chip text-[11px]", SOURCE_TONE[field.source_kind])} title="Происхождение значения (определяется сервером)">
            {schema.source_kinds[field.source_kind]}
          </span>
        )}
        <div className="flex overflow-hidden rounded-full border border-line-strong" role="radiogroup" aria-label={`Определённость: ${meta.label}`}>
          {(["defined", "hypothesis", "unknown"] as Certainty[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={field.certainty === c}
              disabled={readOnly || (c !== "unknown" && isEmpty)}
              onClick={() => setCertainty(c)}
              className={clsx(
                "px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
                field.certainty === c ? CERTAINTY_TONE[c] : "text-muted hover:text-fg-soft disabled:opacity-40",
              )}
            >
              {schema.certainties[c]}
            </button>
          ))}
        </div>
      </div>

      {meta.type === "tags" ? (
        <TagsInput id={id} value={Array.isArray(field.value) ? field.value : []} onChange={setValue} disabled={readOnly} />
      ) : meta.type === "longtext" ? (
        <textarea
          id={id}
          className="input min-h-[84px] resize-y"
          value={typeof field.value === "string" ? field.value : ""}
          onChange={(e) => setValue(e.target.value)}
          readOnly={readOnly}
          placeholder={meta.hint || "Неизвестно"}
        />
      ) : (
        <input
          id={id}
          className="input"
          value={typeof field.value === "string" ? field.value : ""}
          onChange={(e) => setValue(e.target.value)}
          readOnly={readOnly}
          placeholder={meta.hint || "Неизвестно"}
        />
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className={clsx("flex items-center gap-1.5", isEmpty ? "text-muted/50" : "text-muted")}>
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
            checked={field.editor_approved}
            disabled={readOnly || isEmpty}
            onChange={(e) => onChange({ ...field, editor_approved: e.target.checked })}
          />
          Подтверждено редактором
        </label>
        <button type="button" className="flex items-center gap-1 text-muted hover:text-fg-soft" onClick={() => setShowDeps((v) => !v)} aria-expanded={showDeps}>
          <Link2 className="h-3.5 w-3.5" />
          Связи: {field.dependencies.length}
        </button>
        {field.certainty === "hypothesis" && <span className="text-warning">Гипотеза — не используется как установленный факт</span>}
      </div>

      {showDeps && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 fade-in">
          <div className="flex flex-wrap gap-1.5">
            {field.dependencies.map((d) => (
              <span key={d} className="chip border-line-strong text-fg-soft">
                {allPaths.find((p) => p.path === d)?.label ?? d}
                {!readOnly && (
                  <button type="button" aria-label="Убрать связь" onClick={() => onChange({ ...field, dependencies: field.dependencies.filter((x) => x !== d) })}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            {field.dependencies.length === 0 && <span className="text-xs text-muted">Связанных полей нет</span>}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5 text-muted" />
              <select
                className="input h-8 py-0 text-xs"
                value=""
                aria-label="Добавить связанное поле"
                onChange={(e) => e.target.value && onChange({ ...field, dependencies: [...field.dependencies, e.target.value].sort() })}
              >
                <option value="">Добавить связанное поле…</option>
                {allPaths
                  .filter((p) => !field.dependencies.includes(p.path))
                  .map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
