import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Temeljnice from "../../src/pages/temeljnice";
import "../../src/index.css";

// Only this isolated test entry point replaces identity context. Production
// authentication, the page, API hooks, table, badges and detail sheet are unchanged.
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>
    <main className="p-4"><Temeljnice /></main>
  </QueryClientProvider>,
);
