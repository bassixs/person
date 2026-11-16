import { BookOpen, Database, Globe, Radar } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAmbient } from "../components/Ambient";
import { EmptyState, LocalTabs, PageHeader } from "../components/ui";

export function ContextPage() {
  useAmbient("low");
  return (
    <div className="shell">
      <PageHeader
        eyebrow="Контекстный центр"
        title="Контекст"
        description="Три слоя знаний: глобальная база, досье тем и материалы заданий. Понимание ИИ не равно проверке достоверности."
      />
      <LocalTabs
        items={[
          { to: "/context/topics", label: "Темы" },
          { to: "/context/knowledge", label: "База знаний" },
          { to: "/context/sources", label: "Источники" },
          { to: "/context/monitoring", label: "Мониторинг" },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="topics" replace />} />
        <Route
          path="topics"
          element={
            <EmptyState icon={<BookOpen className="h-8 w-8" />} title="Темы появятся в итерации 3">
              Досье событий с версиями, карточкой понимания (суть, факты, вопросы, конфликты, пробелы), claims с
              источниками и редакторским утверждением. Создание вручную или из предложения ИИ в задании.
            </EmptyState>
          }
        />
        <Route
          path="knowledge"
          element={
            <EmptyState icon={<Database className="h-8 w-8" />} title="База знаний — итерация 3">
              Загрузка TXT, MD, PDF, DOCX, CSV, XLSX, изображений и URL с проверкой формата, извлечением текста и
              честными статусами ошибок. Новые материалы не становятся фактами без проверки.
            </EmptyState>
          }
        />
        <Route
          path="sources"
          element={
            <EmptyState icon={<Globe className="h-8 w-8" />} title="Реестр источников — итерация 3">
              Реальный боевой список источников владельцем не утверждён, поэтому реестр будет пустым до заполнения
              редактором. Фиктивные источники не создаются.
            </EmptyState>
          }
        />
        <Route
          path="monitoring"
          element={
            <EmptyState icon={<Radar className="h-8 w-8" />} title="Мониторинг — итерация 4">
              Включается редактором только для выбранных важных тем; по умолчанию выключен. Два контура: факты и
              публичные вопросы. Дополнительный веб-поиск — только при подключённом провайдере.
            </EmptyState>
          }
        />
      </Routes>
    </div>
  );
}
