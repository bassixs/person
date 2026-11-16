import { Cpu, FlaskConical } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAmbient } from "../components/Ambient";
import { IntegrationsList } from "../components/Integrations";
import { EmptyState, LocalTabs, PageHeader } from "../components/ui";

const SKILLS = [
  ["source-reader", "Разбор текста, файла, ссылки"],
  ["topic-researcher", "Контекстный поиск"],
  ["fact-checker", "Проверка утверждений"],
  ["discussion-analyzer", "Анализ собранных открытых комментариев"],
  ["knowledge-manager", "Сопоставление с базой знаний"],
  ["persona-analyst", "Внутренние гипотетические перспективы"],
  ["plain-language-editor", "Разъяснения с прозрачным авторством"],
  ["quality-controller", "Контроль качества результатов ИИ"],
];

export function LabPage() {
  useAmbient("low");
  return (
    <div className="shell">
      <PageHeader
        eyebrow="Лаборатория"
        title="Проверки, навыки и диагностика"
        description="Честные диагностические заключения вместо декоративного «процента качества»."
      />
      <LocalTabs
        items={[
          { to: "/lab/persona-tests", label: "Тесты персон" },
          { to: "/lab/skills", label: "ИИ-навыки" },
          { to: "/lab/diagnostics", label: "Диагностика" },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="persona-tests" replace />} />
        <Route
          path="persona-tests"
          element={
            <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Тесты персон — итерация 2">
              Шесть групп испытаний с результатом pass / warning / critical, привязанным к content_hash версии.
              Critical блокирует активацию на сервере.
            </EmptyState>
          }
        />
        <Route
          path="skills"
          element={
            <div className="space-y-4">
              <div className="panel divide-y divide-line">
                {SKILLS.map(([id, desc]) => (
                  <div key={id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Cpu className="h-4 w-4 text-muted" />
                    <span className="font-mono text-sm text-fg">{id}</span>
                    <span className="text-sm text-muted">{desc}</span>
                    <span className="ml-auto chip border-line text-[11px] text-muted">не реализован</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">
                Реестр версионируемых навыков (инструкция, схемы ввода/вывода, тесты, история запусков) — итерация 4.
                Список выше — утверждённый состав базовых навыков, а не работающие сервисы.
              </p>
            </div>
          }
        />
        <Route path="diagnostics" element={<IntegrationsList />} />
      </Routes>
    </div>
  );
}
