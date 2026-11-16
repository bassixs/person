import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ReportPage } from "./Report";
import { PERSONAS } from "./report/personas";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ me: null }) }));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ReportPage />
    </MemoryRouter>,
  );

describe("Отчёт /about", () => {
  it("строит персонажей из настоящих легенд и не выдумывает поля", () => {
    expect(PERSONAS).toHaveLength(7);
    for (const p of PERSONAS) {
      expect(p.total).toBe(31);
      expect(p.known).toBeLessThan(p.total); // все — черновики с честными пробелами
    }
  });

  it("клик по карточке веера открывает экран этого персонажа", () => {
    renderPage();
    const target = PERSONAS[0]!;
    fireEvent.click(screen.getByRole("button", { name: `Выбрать персонажа: ${target.name}` }));
    expect(screen.getByRole("heading", { level: 3, name: target.name })).toBeInTheDocument();
  });

  it("не выдаёт планы за готовое: в плане завершён только этап 1", () => {
    renderPage();
    const roadmap = document.getElementById("roadmap")!;
    expect(within(roadmap).getAllByText("готово")).toHaveLength(1);
    expect(within(roadmap).getAllByText("в работе")).toHaveLength(1);
    expect(screen.getAllByTitle("Запланировано, в разработке").length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByRole("link", { name: /Открыть демо/ })[0]).toHaveAttribute("href", "/login");
  });
});
