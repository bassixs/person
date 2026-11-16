import { describe, expect, it } from "vitest";
import type { Passport, PassportSchema } from "../api/types";
import { sectionStats } from "./passport";
import { initials, plural } from "./format";

const schema: PassportSchema = {
  schema_version: 1,
  source_kinds: { original_legend: "Исходная легенда", editor: "Редактор", ai_suggestion: "Предложение ИИ" },
  certainties: { defined: "Определено", hypothesis: "Гипотеза", unknown: "Неизвестно" },
  sections: [
    {
      key: "legend",
      title: "Легенда",
      description: "",
      fields: [
        { key: "full_name", label: "Имя", type: "text", hint: "" },
        { key: "occupation", label: "Род занятий", type: "text", hint: "" },
        { key: "age_range", label: "Возраст", type: "text", hint: "" },
      ],
    },
  ],
};
const f = (value: string | null, certainty: "defined" | "hypothesis" | "unknown") => ({
  value,
  certainty,
  source_kind: "editor" as const,
  editor_approved: false,
  dependencies: [],
});

describe("sectionStats", () => {
  it("считает неизвестное незаполненным, а гипотезы — отдельно", () => {
    const passport: Passport = {
      schema_version: 1,
      sections: {
        legend: {
          narrative: "  ",
          fields: { full_name: f("Анна", "defined"), occupation: f("Учитель", "hypothesis"), age_range: f(null, "unknown") },
        },
      },
    };
    expect(sectionStats(passport, schema).legend).toEqual({ total: 3, filled: 2, hypotheses: 1, hasNarrative: false });
  });
});

describe("format", () => {
  it("инициалы и склонение", () => {
    expect(initials("Любовь Богданова")).toBe("ЛБ");
    expect(initials("Редактор (демо)")).toBe("Р");
    expect(plural(1, "поле", "поля", "полей")).toBe("поле");
    expect(plural(3, "поле", "поля", "полей")).toBe("поля");
    expect(plural(11, "поле", "поля", "полей")).toBe("полей");
  });
});
