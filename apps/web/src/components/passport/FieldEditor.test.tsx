import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PassportField, PassportSchema } from "../../api/types";
import { FieldEditor } from "./FieldEditor";

const schema: PassportSchema = {
  schema_version: 1,
  source_kinds: { original_legend: "Исходная легенда", editor: "Редактор", ai_suggestion: "Предложение ИИ" },
  certainties: { defined: "Определено", hypothesis: "Гипотеза", unknown: "Неизвестно" },
  sections: [{ key: "legend", title: "Легенда", description: "", fields: [{ key: "occupation", label: "Род занятий", type: "text", hint: "" }] }],
};
const unknown: PassportField = { value: null, certainty: "unknown", source_kind: "editor", editor_approved: false, dependencies: [] };

function setup(field: PassportField, readOnly = false) {
  const onChange = vi.fn();
  render(<FieldEditor sectionKey="legend" field={field} meta={schema.sections[0].fields[0]} schema={schema} onChange={onChange} readOnly={readOnly} />);
  return onChange;
}

describe("FieldEditor", () => {
  it("ввод значения переводит «неизвестно» в «определено»", () => {
    const onChange = setup(unknown);
    fireEvent.change(screen.getByLabelText("Род занятий"), { target: { value: "Фермер" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: "Фермер", certainty: "defined" }));
  });

  it("выбор «Неизвестно» очищает значение и снимает подтверждение", () => {
    const onChange = setup({ ...unknown, value: "Фермер", certainty: "hypothesis", editor_approved: true });
    fireEvent.click(screen.getByRole("radio", { name: "Неизвестно" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: null, certainty: "unknown", editor_approved: false }));
  });

  it("для пустого поля нельзя выбрать «Определено» или «Гипотеза»", () => {
    setup(unknown);
    expect(screen.getByRole("radio", { name: "Определено" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Гипотеза" })).toBeDisabled();
  });

  it("показывает происхождение значения", () => {
    setup({ ...unknown, value: "x", certainty: "defined", source_kind: "original_legend" });
    expect(screen.getByText("Исходная легенда")).toBeInTheDocument();
  });

  it("в режиме чтения поле не редактируется", () => {
    setup({ ...unknown, value: "x", certainty: "defined" }, true);
    expect(screen.getByLabelText("Род занятий")).toHaveAttribute("readonly");
  });
});
