import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AboutPage } from "./About";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ me: null }) }));

describe("AboutPage", () => {
  it("рендерится без входа и ведёт в систему", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Обращения граждан");
    const links = screen.getAllByRole("link", { name: /Открыть систему|Посмотреть систему/ });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/login"));
  });

  it("не выдаёт будущие возможности за готовые: в плане завершён только этап 1", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    const roadmap = document.getElementById("roadmap")!;
    expect(within(roadmap).getAllByText("готово")).toHaveLength(1);
    expect(within(roadmap).getAllByText("в работе")).toHaveLength(1);
    // MAX, мониторинг и лаборатория помечены этапами, а не «Работает»
    expect(screen.getAllByTitle("Запланировано, в разработке").length).toBeGreaterThanOrEqual(5);
  });
});
