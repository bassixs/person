/**
 * ДЕМО-РЕЖИМ для GitHub Pages (сборка с VITE_DEMO=1).
 *
 * Статический хостинг не может запустить FastAPI/PostgreSQL, поэтому в демо-сборке запросы к /api/v1
 * обрабатывает этот модуль прямо в браузере. Он повторяет правила настоящего backend (apps/api):
 * RBAC, серверное происхождение значений, «пустое = неизвестно», optimistic locking,
 * неизменяемость не-draft версий, барьер активации, честные статусы интеграций.
 *
 * Ограничения (показываются пользователю баннером): данные живут только в localStorage этого
 * браузера, вход — выбором демо-роли без пароля, нет общей базы и серверной защиты.
 * Источник истины для схемы и семи легенд — backend: src/demo/fixtures.json экспортируется
 * командой `python -m app.cli export-demo`, тест backend следит за актуальностью.
 */
import { ApiError } from "../api/client";
import type {
  AuditEvent,
  Passport,
  PassportField,
  PassportSchema,
  PersonaDetail,
  PersonaListItem,
  PersonaStatus,
  Role,
  UserOut,
  VersionDetail,
} from "../api/types";
import fixtures from "./fixtures.json";

const STORE_KEY = "lichnosti-demo-v1";
const SCHEMA = fixtures.schema as PassportSchema;

const ROLE_PERMS: Record<Role, string[]> = {
  admin: ["persona.read_all", "users.manage", "audit.read", "integrations.diagnose"],
  editor: [
    "persona.read_all",
    "persona.read_active",
    "persona.create",
    "persona.edit",
    "persona.archive",
    "persona.activate",
    "audit.read",
  ],
  author: ["persona.read_all", "persona.read_active", "persona.create", "persona.edit"],
  operator: ["persona.read_active"],
};

interface DUser {
  id: string;
  email: string;
  display_name: string;
  roles: Role[];
  is_active: boolean;
  created_at: string;
}
interface DVersion {
  id: string;
  persona_id: string;
  major: number;
  minor: number;
  state: "draft" | "active" | "superseded" | "suspended";
  passport: Passport;
  content_hash: string;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}
interface DPersona {
  id: string;
  display_name: string;
  short_context: string;
  status: PersonaStatus;
  status_before_archive: PersonaStatus | null;
  creation_mode: "manual" | "legend";
  is_seed: boolean;
  active_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  legend: { id: string; content: string; created_at: string } | null;
}
interface DAudit {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_version: string | null;
  details: Record<string, unknown>;
}
interface State {
  users: DUser[];
  personas: DPersona[];
  versions: DVersion[];
  audit: DAudit[];
  current_user_id: string | null;
}

// ---------- утилиты ----------

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
async function hashPassport(p: Passport): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(p)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const err = (status: number, code: string, message: string, details?: unknown) =>
  new ApiError(status, code, message, details, "demo");

// ---------- хранилище ----------

let memory: State | null = null;

function save(s: State) {
  memory = s;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* хранилище недоступно: демо работает до перезагрузки вкладки */
  }
}

async function seedState(): Promise<State> {
  const t = now();
  const users: DUser[] = [
    { id: uuid(), email: "editor@demo.local", display_name: "Редактор (демо)", roles: ["editor"], is_active: true, created_at: t },
    { id: uuid(), email: "author@demo.local", display_name: "Автор (демо)", roles: ["author"], is_active: true, created_at: t },
    { id: uuid(), email: "admin@demo.local", display_name: "Администратор (демо)", roles: ["admin"], is_active: true, created_at: t },
    { id: uuid(), email: "operator@demo.local", display_name: "Оператор (демо)", roles: ["operator"], is_active: true, created_at: t },
  ];
  const s: State = { users, personas: [], versions: [], audit: [], current_user_id: null };
  for (const item of fixtures.seed) {
    const pid = uuid();
    const vid = uuid();
    const passport = clone(item.passport) as Passport;
    s.personas.push({
      id: pid,
      display_name: item.name,
      short_context: item.short_context,
      status: "draft",
      status_before_archive: null,
      creation_mode: "legend",
      is_seed: true,
      active_version_id: null,
      created_by: users[0].id,
      created_at: t,
      updated_at: t,
      legend: { id: uuid(), content: item.legend, created_at: t },
    });
    s.versions.push({
      id: vid,
      persona_id: pid,
      major: 1,
      minor: 0,
      state: "draft",
      passport,
      content_hash: await hashPassport(passport),
      revision: 1,
      created_by: users[0].id,
      updated_by: users[0].id,
      created_at: t,
      updated_at: t,
      approved_at: null,
    });
    s.audit.push({
      id: uuid(),
      occurred_at: t,
      actor_id: users[0].id,
      action: "persona.create",
      entity_type: "persona",
      entity_id: pid,
      entity_version: "1.0",
      details: { mode: "legend", is_seed: true },
    });
  }
  return s;
}

async function load(): Promise<State> {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      memory = JSON.parse(raw) as State;
      return memory;
    }
  } catch {
    /* повреждённые или недоступные данные — начинаем заново */
  }
  const s = await seedState();
  save(s);
  return s;
}

export async function resetDemo() {
  memory = null;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
  await load();
}

// ---------- доменные помощники ----------

const perms = (u: DUser) => [...new Set(u.roles.flatMap((r) => ROLE_PERMS[r]))];
const label = (v: DVersion) => `${v.major}.${v.minor}`;

function requireUser(s: State): DUser {
  const u = s.users.find((x) => x.id === s.current_user_id && x.is_active);
  if (!u) throw err(401, "unauthenticated", "Требуется вход в систему");
  return u;
}
function requirePerm(u: DUser, p: string) {
  if (!perms(u).includes(p)) throw err(403, "forbidden", "Недостаточно прав для этого действия");
}
function audit(s: State, u: DUser | null, action: string, entity_type: string, entity_id: string | null, entity_version: string | null = null, details: Record<string, unknown> = {}) {
  s.audit.unshift({ id: uuid(), occurred_at: now(), actor_id: u?.id ?? null, action, entity_type, entity_id, entity_version, details });
}
const userRef = (s: State, id: string | null) => {
  const u = s.users.find((x) => x.id === id);
  return u ? { id: u.id, display_name: u.display_name } : null;
};

function visiblePersona(s: State, u: DUser, id: string): DPersona {
  const p = s.personas.find((x) => x.id === id);
  const all = perms(u).includes("persona.read_all");
  if (!p || (!all && !(perms(u).includes("persona.read_active") && p.active_version_id))) throw err(404, "not_found", "Личность: не найдено");
  return p;
}
function visibleVersion(s: State, u: DUser, p: DPersona, vid: string): DVersion {
  const v = s.versions.find((x) => x.id === vid && x.persona_id === p.id);
  if (!v || (!perms(u).includes("persona.read_all") && v.state !== "active")) throw err(404, "not_found", "Версия: не найдено");
  return v;
}

function completeness(p: Passport) {
  let total = 0;
  let filled = 0;
  const sections: Record<string, unknown> = {};
  for (const sec of SCHEMA.sections) {
    const fs = sec.fields.map((f) => p.sections[sec.key].fields[f.key]);
    const f = fs.filter((x) => x.certainty !== "unknown").length;
    sections[sec.key] = {
      fields_total: fs.length,
      fields_filled: f,
      has_narrative: !!p.sections[sec.key].narrative,
      hypotheses: fs.filter((x) => x.certainty === "hypothesis").length,
    };
    total += fs.length;
    filled += f;
  }
  return { fields_total: total, fields_filled: filled, sections };
}

const vref = (v: DVersion | undefined) =>
  v ? { id: v.id, label: label(v), state: v.state, content_hash: v.content_hash, revision: v.revision } : null;

function listItem(s: State, u: DUser, p: DPersona): PersonaListItem {
  const vs = s.versions.filter((v) => v.persona_id === p.id);
  const active = vs.find((v) => v.id === p.active_version_id);
  const draft = perms(u).includes("persona.read_all") ? vs.find((v) => v.state === "draft") : undefined;
  const basis = draft ?? active;
  const c = basis ? completeness(basis.passport) : null;
  return {
    id: p.id,
    display_name: p.display_name,
    short_context: p.short_context,
    status: p.status,
    creation_mode: p.creation_mode,
    is_seed: p.is_seed,
    created_by: userRef(s, p.created_by),
    created_at: p.created_at,
    updated_at: p.updated_at,
    active_version: vref(active),
    draft_version: vref(draft),
    completeness: c ? { fields_filled: c.fields_filled, fields_total: c.fields_total } : null,
    open_issues: null,
  };
}

function detail(s: State, u: DUser, p: DPersona): PersonaDetail {
  const item = listItem(s, u, p);
  const all = perms(u).includes("persona.read_all");
  const vs = s.versions
    .filter((v) => v.persona_id === p.id && (all || v.state === "active"))
    .sort((a, b) => a.major - b.major || a.minor - b.minor);
  const archived = p.status === "archived";
  const hasDraft = !!item.draft_version;
  const can = (x: string) => perms(u).includes(x);
  return {
    ...item,
    versions: vs.map((v) => ({ ...vref(v)!, created_at: v.created_at, updated_at: v.updated_at, created_by: userRef(s, v.created_by), approved_at: v.approved_at })),
    source_materials: all && p.legend ? [{ id: p.legend.id, kind: "original_legend", content: p.legend.content, created_at: p.legend.created_at }] : [],
    capabilities: {
      can_edit: can("persona.edit") && !archived && hasDraft,
      can_archive: can("persona.archive"),
      can_activate: can("persona.activate") && !archived && hasDraft,
      can_create_version: can("persona.edit") && !archived && !hasDraft && !!p.active_version_id,
    },
    // В демо нет ИИ: интервью и предложения честно недоступны.
    pending_proposals: 0,
    ai_configured: false,
  };
}

function versionDetail(s: State, v: DVersion): VersionDetail {
  return {
    id: v.id,
    label: label(v),
    state: v.state,
    content_hash: v.content_hash,
    revision: v.revision,
    created_at: v.created_at,
    updated_at: v.updated_at,
    created_by: userRef(s, v.created_by),
    approved_at: v.approved_at,
    persona_id: v.persona_id,
    schema_version: SCHEMA.schema_version,
    passport: clone(v.passport),
    completeness: completeness(v.passport) as VersionDetail["completeness"],
    updated_by: userRef(s, v.updated_by),
  };
}

/** Та же валидация и нормализация, что у Pydantic-модели PassportField на backend. */
function normalizePassport(input: Passport): Passport {
  const errors: { loc: string[]; message: string }[] = [];
  const allPaths = new Set(SCHEMA.sections.flatMap((s) => s.fields.map((f) => `${s.key}.${f.key}`)));
  const out: Passport = { schema_version: 1, sections: {} };
  const keys = Object.keys(input?.sections ?? {});
  if (keys.length !== SCHEMA.sections.length || SCHEMA.sections.some((s) => !keys.includes(s.key)))
    throw err(422, "validation_error", "Данные не прошли проверку", [{ loc: ["passport"], message: "Паспорт должен содержать ровно 9 разделов схемы" }]);
  for (const sec of SCHEMA.sections) {
    const inSec = input.sections[sec.key];
    const extra = Object.keys(inSec.fields ?? {}).filter((k) => !sec.fields.some((f) => f.key === k));
    if (extra.length) errors.push({ loc: [sec.key], message: `Неизвестные поля ${extra.join(", ")}` });
    const fields: Record<string, PassportField> = {};
    for (const meta of sec.fields) {
      const f = inSec.fields?.[meta.key] ?? ({} as Partial<PassportField>);
      let value: string | string[] | null = f.value ?? null;
      if (typeof value === "string") value = value.trim() || null;
      else if (Array.isArray(value)) {
        const cleaned = value.map((x) => x.trim()).filter(Boolean);
        value = cleaned.length ? cleaned : null;
      }
      let certainty = f.certainty ?? "unknown";
      let approved = !!f.editor_approved;
      if (value === null) {
        certainty = "unknown";
        approved = false;
      } else if (certainty === "unknown") {
        errors.push({ loc: [sec.key, meta.key], message: "Поле со значением не может иметь определённость «неизвестно»" });
      }
      if (value !== null && meta.type === "tags" && !Array.isArray(value)) errors.push({ loc: [sec.key, meta.key], message: "ожидается список" });
      if (value !== null && meta.type !== "tags" && typeof value !== "string") errors.push({ loc: [sec.key, meta.key], message: "ожидается текст" });
      const deps = [...new Set(f.dependencies ?? [])].sort();
      const badDeps = deps.filter((d) => !allPaths.has(d));
      if (badDeps.length) errors.push({ loc: [sec.key, meta.key], message: `Неизвестные зависимые поля: ${badDeps.join(", ")}` });
      fields[meta.key] = { value, source_kind: f.source_kind ?? "editor", certainty, editor_approved: approved, dependencies: deps };
    }
    out.sections[sec.key] = { fields, narrative: (inSec.narrative ?? "").trim() };
  }
  if (errors.length) throw err(422, "validation_error", "Данные не прошли проверку", errors);
  return out;
}

/** Порт merge_editor_update: происхождение определяет «сервер». */
function mergeEditorUpdate(prev: Passport, incoming: Passport): { merged: Passport; changed: string[] } {
  const changed = new Set<string>();
  const merged = clone(incoming);
  for (const [skey, sec] of Object.entries(merged.sections)) {
    const ps = prev.sections[skey];
    if (sec.narrative !== ps.narrative) changed.add(`${skey}.narrative`);
    for (const [fkey, f] of Object.entries(sec.fields)) {
      const p = ps.fields[fkey];
      if (canonical(f.value) !== canonical(p.value)) {
        f.source_kind = "editor";
        changed.add(`${skey}.${fkey}`);
      } else {
        f.source_kind = p.source_kind;
        if (f.certainty !== p.certainty || canonical(f.dependencies) !== canonical(p.dependencies)) changed.add(`${skey}.${fkey}`);
      }
      if (f.editor_approved !== p.editor_approved) changed.add(`${skey}.${fkey}`);
    }
  }
  return { merged, changed: [...changed].sort() };
}

function emptyPassport(): Passport {
  return {
    schema_version: 1,
    sections: Object.fromEntries(
      SCHEMA.sections.map((s) => [
        s.key,
        {
          narrative: "",
          fields: Object.fromEntries(
            s.fields.map((f) => [f.key, { value: null, source_kind: "editor", certainty: "unknown", editor_approved: false, dependencies: [] } as PassportField]),
          ),
        },
      ]),
    ),
  };
}

function blockers(v: DVersion) {
  const b: { code: string; message: string }[] = [];
  if (v.state !== "draft") b.push({ code: "not_draft", message: "Активировать можно только черновик" });
  if (v.passport.sections.legend.fields.full_name.certainty === "unknown") b.push({ code: "missing_required", message: "Не заполнено обязательное поле «Имя»" });
  b.push({ code: "validation_missing", message: `Нет актуальной полной проверки согласованности для содержимого ${v.content_hash.slice(0, 12)}` });
  b.push({ code: "lab_missing", message: "Лаборатория (6 групп испытаний) не прогонялась для текущего содержимого" });
  return b;
}

const auditOut = (s: State, e: DAudit): AuditEvent => ({
  id: e.id,
  occurred_at: e.occurred_at,
  actor: userRef(s, e.actor_id),
  action: e.action,
  entity_type: e.entity_type,
  entity_id: e.entity_id,
  entity_version: e.entity_version,
  details: e.details,
});

const integrations = () => [
  { name: "llm", title: "LLM-провайдер", status: "not_configured", verified: false, detail: { host: null, model: null }, how_to_connect: "Демо-режим GitHub Pages: внешние подключения недоступны. В полной версии — LLM_BASE_URL, LLM_API_KEY, LLM_MODEL на сервере." },
  { name: "search", title: "Веб-поиск", status: "not_configured", verified: false, detail: { provider: null }, how_to_connect: "Демо-режим: поиск недоступен. Поставщик поиска не выбран." },
  { name: "max", title: "MAX-бот", status: "not_configured", verified: false, detail: { api: "https://platform-api2.max.ru" }, how_to_connect: "Демо-режим: MAX недоступен. В полной версии — MAX_BOT_TOKEN на сервере." },
];

// ---------- маршрутизация ----------

type Q = Record<string, string | string[] | undefined>;

export async function demoRequest(method: string, path: string, query: Q, body: unknown): Promise<unknown> {
  // небольшая задержка, чтобы состояния загрузки вели себя как с сетью
  await new Promise((r) => setTimeout(r, 120));
  const s = await load();
  const b = (body ?? {}) as Record<string, unknown>;
  const seg = path.split("/").filter(Boolean);

  // --- auth ---
  if (path === "/auth/demo-login" && method === "POST") {
    const u = s.users.find((x) => x.email === b.email && x.is_active);
    if (!u) throw err(401, "invalid_credentials", "Демо-пользователь не найден");
    s.current_user_id = u.id;
    audit(s, u, "auth.login", "user", u.id);
    save(s);
    return { id: u.id, email: u.email, display_name: u.display_name, roles: u.roles, permissions: perms(u).sort(), csrf_token: "demo" };
  }
  if (path === "/auth/demo-users" && method === "GET") {
    return s.users.filter((u) => u.is_active).map((u) => ({ email: u.email, display_name: u.display_name, roles: u.roles }));
  }
  if (path === "/auth/me" && method === "GET") {
    const u = requireUser(s);
    return { id: u.id, email: u.email, display_name: u.display_name, roles: u.roles, permissions: perms(u).sort(), csrf_token: "demo" };
  }
  if (path === "/auth/logout" && method === "POST") {
    const u = requireUser(s);
    audit(s, u, "auth.logout", "user", u.id);
    s.current_user_id = null;
    save(s);
    return undefined;
  }

  const u = requireUser(s);

  // --- system ---
  if (path === "/integrations/status") return integrations();
  if (seg[0] === "integrations" && seg[2] === "check") {
    requirePerm(u, "integrations.diagnose");
    return { ...integrations().find((i) => i.name === seg[1]), ok: false, error: "Демо-режим: внешние вызовы отключены" };
  }
  if (path === "/overview") {
    const counts: Partial<Record<PersonaStatus, number>> = {};
    for (const p of s.personas) counts[p.status] = (counts[p.status] ?? 0) + 1;
    const all = perms(u).includes("persona.read_all");
    const withActive = s.personas.filter((p) => p.active_version_id).length;
    const no = (iteration: number) => ({ available: false, iteration });
    return {
      personas: all
        ? { total: s.personas.filter((p) => p.status !== "archived").length, by_status: counts, with_active_version: withActive }
        : { total: withActive, by_status: {}, with_active_version: withActive },
      topics: no(3),
      tasks: no(5),
      monitoring: no(4),
      proposals: no(2),
      recent_events: perms(u).includes("audit.read")
        ? s.audit.filter((e) => e.entity_type.startsWith("persona")).slice(0, 8).map((e) => auditOut(s, e))
        : [],
      integrations: integrations(),
    };
  }
  if (path === "/audit") {
    requirePerm(u, "audit.read");
    const page = Number(query.page ?? 1);
    const size = Number(query.page_size ?? 50);
    let rows = s.audit;
    if (query.entity_id) rows = rows.filter((e) => e.entity_id === query.entity_id);
    if (query.action) rows = rows.filter((e) => e.action === query.action);
    return { items: rows.slice((page - 1) * size, page * size).map((e) => auditOut(s, e)), total: rows.length, page, page_size: size };
  }

  // --- users ---
  if (seg[0] === "users") {
    requirePerm(u, "users.manage");
    const out = (x: DUser): UserOut => ({ id: x.id, email: x.email, display_name: x.display_name, roles: x.roles, is_active: x.is_active, created_at: x.created_at });
    if (seg.length === 1 && method === "GET") return s.users.map(out);
    if (seg.length === 1 && method === "POST") {
      const email = String(b.email ?? "").toLowerCase().trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(422, "validation_error", "Некорректный email");
      if (s.users.some((x) => x.email === email)) throw err(409, "email_taken", "Пользователь с таким email уже есть");
      const nu: DUser = { id: uuid(), email, display_name: String(b.display_name ?? email), roles: (b.roles as Role[]) ?? [], is_active: true, created_at: now() };
      s.users.push(nu);
      audit(s, u, "user.create", "user", nu.id, null, { roles: nu.roles });
      save(s);
      return out(nu);
    }
    if (seg.length === 2 && method === "PATCH") {
      const t = s.users.find((x) => x.id === seg[1]);
      if (!t) throw err(404, "not_found", "Пользователь не найден");
      if (t.id === u.id && b.is_active === false) throw err(409, "self_disable", "Нельзя отключить собственную учётную запись");
      if (t.id === u.id && Array.isArray(b.roles) && !(b.roles as Role[]).includes("admin")) throw err(409, "self_demote", "Нельзя снять с себя роль администратора");
      if (Array.isArray(b.roles)) t.roles = [...new Set(b.roles as Role[])].sort();
      if (typeof b.is_active === "boolean") t.is_active = b.is_active;
      if (typeof b.display_name === "string") t.display_name = b.display_name;
      audit(s, u, "user.update", "user", t.id, null, {});
      save(s);
      return out(t);
    }
  }

  // --- personas ---
  if (seg[0] === "personas") {
    if (seg.length === 2 && seg[1] === "schema") return SCHEMA;

    if (seg.length === 1 && method === "GET") {
      const all = perms(u).includes("persona.read_all");
      if (!all && !perms(u).includes("persona.read_active")) throw err(403, "forbidden", "Недостаточно прав для этого действия");
      let rows = s.personas.filter((p) => all || p.active_version_id);
      const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
      if (q) rows = rows.filter((p) => p.display_name.toLowerCase().includes(q) || p.short_context.toLowerCase().includes(q));
      const st = query.status ? ([] as string[]).concat(query.status) : [];
      if (st.length) rows = rows.filter((p) => st.includes(p.status));
      else if (query.include_archived !== "true") rows = rows.filter((p) => p.status !== "archived");
      const sort = query.sort ?? "updated_desc";
      rows = [...rows].sort((a, c) =>
        sort === "name_asc" ? a.display_name.localeCompare(c.display_name, "ru") : sort === "created_desc" ? c.created_at.localeCompare(a.created_at) : c.updated_at.localeCompare(a.updated_at),
      );
      const page = Number(query.page ?? 1);
      const size = Number(query.page_size ?? 50);
      return { items: rows.slice((page - 1) * size, page * size).map((p) => listItem(s, u, p)), total: rows.length, page, page_size: size };
    }

    if (seg.length === 1 && method === "POST") {
      requirePerm(u, "persona.create");
      const mode = String(b.mode ?? "manual");
      if (mode === "ai_draft") throw err(503, "llm_not_configured", "LLM-провайдер не подключён: ИИ-черновик недоступен. Создайте личность вручную или из легенды.");
      const name = String(b.display_name ?? "").trim();
      if (!name) throw err(422, "validation_error", "Данные не прошли проверку", [{ loc: ["display_name"], message: "Обязательное поле" }]);
      const legendText = typeof b.legend_text === "string" ? b.legend_text.trim() : "";
      if (mode === "legend" && !legendText) throw err(422, "legend_required", "Для создания из легенды нужен текст легенды");
      const passport = emptyPassport();
      passport.sections.legend.fields.full_name = {
        value: name,
        source_kind: mode === "legend" ? "original_legend" : "editor",
        certainty: "defined",
        editor_approved: mode !== "legend",
        dependencies: [],
      };
      const t = now();
      const p: DPersona = {
        id: uuid(),
        display_name: name,
        short_context: String(b.short_context ?? "").trim(),
        status: "draft",
        status_before_archive: null,
        creation_mode: mode === "legend" ? "legend" : "manual",
        is_seed: false,
        active_version_id: null,
        created_by: u.id,
        created_at: t,
        updated_at: t,
        legend: legendText ? { id: uuid(), content: legendText, created_at: t } : null,
      };
      s.personas.push(p);
      s.versions.push({ id: uuid(), persona_id: p.id, major: 1, minor: 0, state: "draft", passport, content_hash: await hashPassport(passport), revision: 1, created_by: u.id, updated_by: u.id, created_at: t, updated_at: t, approved_at: null });
      audit(s, u, "persona.create", "persona", p.id, "1.0", { mode });
      save(s);
      return detail(s, u, p);
    }

    const p = visiblePersona(s, u, seg[1]);

    if (seg.length === 2 && method === "GET") return detail(s, u, p);
    if (seg.length === 2 && method === "PATCH") {
      requirePerm(u, "persona.edit");
      if (p.status === "archived") throw err(409, "persona_archived", "Личность в архиве");
      if (typeof b.short_context === "string") p.short_context = b.short_context.trim();
      save(s);
      return detail(s, u, p);
    }
    if (seg[2] === "archive" || seg[2] === "unarchive") {
      requirePerm(u, "persona.archive");
      if (seg[2] === "archive" && p.status !== "archived") {
        p.status_before_archive = p.status;
        p.status = "archived";
        audit(s, u, "persona.archive", "persona", p.id);
      } else if (seg[2] === "unarchive" && p.status === "archived") {
        p.status = p.status_before_archive ?? "draft";
        p.status_before_archive = null;
        audit(s, u, "persona.unarchive", "persona", p.id);
      }
      save(s);
      return detail(s, u, p);
    }
    if (seg[2] === "history") {
      requirePerm(u, "persona.read_all");
      const ids = new Set([p.id, ...s.versions.filter((v) => v.persona_id === p.id).map((v) => v.id)]);
      return s.audit.filter((e) => e.entity_id && ids.has(e.entity_id)).map((e) => auditOut(s, e));
    }
    // Итерация 2: интервью и предложения. В демо LLM нет — честное «не подключено», пустые списки.
    if (seg[2] === "lab") {
      requirePerm(u, "persona.read_all");
      if (method === "GET" && seg.length === 3) return { suite_version: "1.0", groups: [], runs: [], baseline: null };
      requirePerm(u, "persona.edit");
      throw err(503, "llm_not_configured", "ИИ не подключён в демо-версии: лаборатория работает на рабочем сервере.");
    }
    if (seg[2] === "submit" && method === "POST") {
      requirePerm(u, "persona.edit");
      throw err(409, "validation_required", "Сначала проверьте целостность паспорта (в демо проверка недоступна).");
    }
    if (seg[2] === "consistency") {
      requirePerm(u, "persona.read_all");
      return { status: "unavailable", level: null, p_conflict: null, severity: null, model: null, content_hash: null };
    }
    if (seg[2] === "interviews" || seg[2] === "proposals" || seg[2] === "validations") {
      requirePerm(u, "persona.read_all");
      if (method === "GET") return [];
      requirePerm(u, "persona.edit");
      throw err(503, "llm_not_configured", "ИИ не подключён в демо-версии: интервью и предложения работают на рабочем сервере с LLM-провайдером.");
    }
    if (seg[2] === "activation-check") {
      const v = visibleVersion(s, u, p, String(query.version_id));
      return { version_id: v.id, content_hash: v.content_hash, can_activate_by_role: perms(u).includes("persona.activate"), blockers: blockers(v) };
    }
    if (seg[2] === "activate" && method === "POST") {
      requirePerm(u, "persona.activate");
      const v = s.versions.find((x) => x.id === b.version_id && x.persona_id === p.id);
      if (!v) throw err(404, "not_found", "Версия: не найдено");
      const bl = blockers(v);
      audit(s, u, "persona.activate_rejected", "persona_version", v.id, label(v), { content_hash: v.content_hash, blockers: bl.map((x) => x.code) });
      save(s);
      throw err(409, "activation_blocked", "Активация заблокирована: устраните блокирующие условия", bl);
    }
    if (seg[2] === "versions" && seg.length === 3 && method === "POST") {
      requirePerm(u, "persona.edit");
      if (p.status === "archived") throw err(409, "persona_archived", "Личность в архиве");
      if (s.versions.some((v) => v.persona_id === p.id && v.state === "draft")) throw err(409, "draft_exists", "У личности уже есть редактируемый черновик");
      throw err(409, "no_active_version", "Нет активной версии, от которой создать черновик");
    }
    if (seg[2] === "versions" && seg.length === 4) {
      const v = visibleVersion(s, u, p, seg[3]);
      if (method === "GET") return versionDetail(s, v);
      if (method === "PUT") {
        requirePerm(u, "persona.edit");
        if (p.status === "archived") throw err(409, "persona_archived", "Личность в архиве: сначала верните её из архива");
        if (v.state !== "draft") throw err(409, "version_immutable", `Версия ${label(v)} в состоянии «${v.state}» неизменяема. Создайте новый черновик.`);
        if (b.expected_revision !== v.revision)
          throw err(409, "revision_conflict", "Черновик изменён в другой вкладке. Обновите страницу, чтобы не потерять правки.", { current_revision: v.revision });
        const incoming = normalizePassport(b.passport as Passport);
        const { merged, changed } = mergeEditorUpdate(v.passport, incoming);
        if (changed.length) {
          v.passport = merged;
          v.content_hash = await hashPassport(merged);
          v.revision += 1;
          v.updated_by = u.id;
          v.updated_at = now();
          const nm = merged.sections.legend.fields.full_name.value;
          if (typeof nm === "string" && nm) p.display_name = nm;
          p.updated_at = v.updated_at;
          audit(s, u, "persona.edit", "persona_version", v.id, label(v), { changed, content_hash: v.content_hash, revision: v.revision });
          save(s);
        }
        return versionDetail(s, v);
      }
    }
  }

  throw err(404, "not_found", `Демо: маршрут ${method} ${path} не поддерживается`);
}
