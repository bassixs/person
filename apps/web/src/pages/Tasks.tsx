import { ClipboardList } from "lucide-react";
import { useAmbient } from "../components/Ambient";
import { EmptyState, PageHeader } from "../components/ui";

export function TasksPage() {
  useAmbient("low");
  return (
    <div className="shell">
      <PageHeader
        eyebrow="Задания"
        title="Очередь и история заданий"
        description="Разбор отдельных материалов и пакетов комментариев с фиксацией версий тем, персон и навыков."
      />
      <EmptyState icon={<ClipboardList className="h-8 w-8" />} title="Заданий пока нет">
        Быстрый режим (один материал) и пакетный анализ, два входа (сначала контекст или сначала материал), прозрачно
        авторизованные черновики разъяснений — итерация 5 вместе с MAX-ботом. Задания зависят от утверждённых тем
        (итерация 3).
      </EmptyState>
    </div>
  );
}
