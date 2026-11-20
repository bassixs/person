import { Radar } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAmbient } from "../components/Ambient";
import { KnowledgeList } from "../components/knowledge/Knowledge";
import { SourcesRegistry } from "../components/knowledge/Sources";
import { TopicsCatalog } from "../components/topic/TopicsCatalog";
import { EmptyState, LocalTabs, PageHeader } from "../components/ui";
import { TopicEditorPage } from "./TopicEditor";

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
        <Route path="topics" element={<TopicsCatalog />} />
        <Route path="topics/:id" element={<TopicEditorPage />} />
        <Route path="knowledge" element={<KnowledgeList />} />
        <Route path="sources" element={<SourcesRegistry />} />
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
