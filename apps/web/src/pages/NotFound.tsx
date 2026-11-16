import { Link } from "react-router-dom";
import { useAmbient } from "../components/Ambient";
import { EmptyState } from "../components/ui";

export function NotFound() {
  useAmbient("low");
  return (
    <div className="shell">
      <EmptyState title="Страница не найдена" action={<Link to="/overview" className="btn-secondary">На главную</Link>}>
        Проверьте адрес или вернитесь к обзору.
      </EmptyState>
    </div>
  );
}
