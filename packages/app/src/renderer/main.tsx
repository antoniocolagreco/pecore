import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider, useNavigate } from "react-router";
import { call } from "./api/client";
import { useData } from "./api/hooks";
import { startLive } from "./api/live";
import { Layout } from "./shell/Layout";
import { FilterProvider } from "./shell/filter";
import { ThemeLoader } from "./theme/ThemeLoader";
import * as screens from "./screens";
import "./theme/global.css";

function Home() {
  const navigate = useNavigate();
  const firstRun = useData(() => call("getFirstRun"), []);
  useEffect(() => {
    if (firstRun.data && !firstRun.data.done) void navigate("/first-run", { replace: true });
  }, [firstRun.data]);
  return <screens.Factory />;
}

const router = createHashRouter([
  { path: "/first-run", element: <screens.FirstRun /> },
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/jobs", element: <screens.Jobs /> },
      { path: "/jobs/:id", element: <screens.JobView /> },
      { path: "/inbox", element: <screens.Inbox /> },
      { path: "/inbox/:id", element: <screens.Inbox /> },
      { path: "/orchestrator", element: <screens.Orchestrator /> },
      { path: "/orchestrator/:id", element: <screens.Orchestrator /> },
      { path: "/projects", element: <screens.Projects /> },
      { path: "/projects/new", element: <screens.NewProjectWizard /> },
      { path: "/projects/:id", element: <screens.ProjectPage /> },
      { path: "/edit/node/*", element: <screens.NodeEditor /> },
      { path: "/edit/recipe/*", element: <screens.RecipeEditor /> },
      { path: "/library", element: <screens.Library /> },
      { path: "/usage", element: <screens.Usage /> },
      { path: "/settings", element: <screens.Settings /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

startLive();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FilterProvider>
      <ThemeLoader />
      <RouterProvider router={router} />
    </FilterProvider>
  </StrictMode>,
);
