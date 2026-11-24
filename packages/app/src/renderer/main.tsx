import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { startLive } from "./api/live";
import { Showcase } from "./gallery/Showcase";
import { Layout } from "./shell/Layout";
import { ThemeLoader } from "./theme/ThemeLoader";
import * as screens from "./screens";
import { ToastProvider, TooltipProvider } from "./ds/overlay";
import "./ds/tokens.css";
import "./theme/global.css";

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <screens.Factory /> },
      { path: "/jobs", element: <screens.Jobs /> },
      { path: "/jobs/:id", element: <screens.JobView /> },
      { path: "/notifications", element: <screens.Notifications /> },
      { path: "/notifications/:id", element: <screens.Notifications /> },
      { path: "/projects", element: <screens.Projects /> },
      { path: "/projects/new", element: <screens.NewProjectWizard /> },
      { path: "/projects/:id", element: <screens.ProjectPage /> },
      { path: "/edit/node/*", element: <screens.NodeEditor /> },
      { path: "/edit/recipe/*", element: <screens.RecipeEditor /> },
      { path: "/templates", element: <screens.Templates /> },
      { path: "/templates/nodes/new", element: <screens.NodeEditor newTemplate /> },
      { path: "/templates/recipes/new", element: <screens.RecipeEditor newTemplate /> },
      { path: "/agents", element: <screens.Agents /> },
      { path: "/agents/edit/:id?", element: <screens.AgentCatalogEditor /> },
      { path: "/settings", element: <screens.Settings /> },
      { path: "/showcase", element: <Showcase /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

startLive();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <ThemeLoader />
        <RouterProvider router={router} />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
