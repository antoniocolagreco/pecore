import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { startLive } from "./api/live";
import { Layout } from "./shell/Layout";
import { FilterProvider } from "./shell/filter";
import { ThemeLoader } from "./theme/ThemeLoader";
import * as screens from "./screens";
import "./theme/global.css";

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <screens.Factory /> },
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
