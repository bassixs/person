import { Navigate, Outlet, createBrowserRouter, useLocation } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { AboutPage } from "./pages/About";
import { ContextPage } from "./pages/Context";
import { LabPage } from "./pages/Lab";
import { LoginPage } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { OverviewPage } from "./pages/Overview";
import { PersonaEditorPage } from "./pages/PersonaEditor";
import { PersonasPage } from "./pages/Personas";
import { SettingsPage } from "./pages/Settings";
import { TasksPage } from "./pages/Tasks";

function RequireAuth() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  // Публичная презентация для руководства — без входа
  { path: "/about", element: <AboutPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: "overview", element: <OverviewPage /> },
          { path: "personas", element: <PersonasPage /> },
          { path: "personas/:id", element: <PersonaEditorPage /> },
          { path: "context/*", element: <ContextPage /> },
          { path: "tasks/*", element: <TasksPage /> },
          { path: "lab/*", element: <LabPage /> },
          { path: "settings/*", element: <SettingsPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
], {
  // На GitHub Pages приложение живёт в подкаталоге /<repo>/
  basename: import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, ""),
});
