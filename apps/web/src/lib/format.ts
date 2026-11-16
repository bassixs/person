import type { PersonaStatus, Role } from "../api/types";

const dtf = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const df = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Даты хранятся в UTC, отображаются по Москве (ТЗ). */
export const fmtDateTime = (iso: string) => `${dtf.format(new Date(iso))} МСК`;
export const fmtDate = (iso: string) => df.format(new Date(iso));

export const STATUS_LABEL: Record<PersonaStatus, string> = {
  draft: "Черновик",
  pending_approval: "На согласовании",
  active: "Активна",
  needs_revision: "Требует доработки",
  suspended: "Приостановлена",
  archived: "Архив",
};

export const VERSION_STATE_LABEL: Record<string, string> = {
  draft: "черновик",
  active: "активна",
  superseded: "заменена",
  suspended: "приостановлена",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Администратор",
  editor: "Редактор",
  author: "Автор",
  operator: "Оператор",
};

export const ACTION_LABEL: Record<string, string> = {
  "persona.create": "создал(а) личность",
  "persona.edit": "изменил(а) паспорт",
  "persona.edit_meta": "изменил(а) описание",
  "persona.archive": "отправил(а) в архив",
  "persona.unarchive": "вернул(а) из архива",
  "persona.version_create": "создал(а) новую версию",
  "persona.activate": "активировал(а) версию",
  "persona.activate_rejected": "попытка активации отклонена",
  "auth.login": "вошёл(ла) в систему",
  "auth.logout": "вышел(ла) из системы",
  "auth.login_failed": "неудачная попытка входа",
  "user.create": "создал(а) пользователя",
  "user.update": "изменил(а) пользователя",
};

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
