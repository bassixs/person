import type { Passport, PassportSchema } from "../api/types";

export interface SectionStat {
  filled: number;
  total: number;
  hypotheses: number;
  hasNarrative: boolean;
}

/** Заполненность разделов: «неизвестно» — не ошибка, а незаполненное состояние. */
export function sectionStats(passport: Passport, schema: PassportSchema): Record<string, SectionStat> {
  const out: Record<string, SectionStat> = {};
  for (const s of schema.sections) {
    const sec = passport.sections[s.key];
    const fields = s.fields.map((f) => sec?.fields[f.key]);
    out[s.key] = {
      total: s.fields.length,
      filled: fields.filter((f) => f && f.certainty !== "unknown").length,
      hypotheses: fields.filter((f) => f?.certainty === "hypothesis").length,
      hasNarrative: !!sec?.narrative.trim(),
    };
  }
  return out;
}
