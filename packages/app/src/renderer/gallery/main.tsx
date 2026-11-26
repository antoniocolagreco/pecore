import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { ViewHistoryProvider } from "../components/ViewHistoryProvider";
import "../ds/tokens.css";
import "../theme/global.css";
import { ToastProvider, TooltipProvider } from "../ds/overlay";
import { Showcase } from "./Showcase";
import g from "./gallery.module.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <MemoryRouter>
          <div className={g.standalone}>
            <ViewHistoryProvider><Showcase /></ViewHistoryProvider>
          </div>
        </MemoryRouter>
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
