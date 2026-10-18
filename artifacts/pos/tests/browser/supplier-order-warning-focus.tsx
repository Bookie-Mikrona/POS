import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import NarocilaDobaviteljem from "../../src/pages/NarocilaDobaviteljem";
import "../../src/index.css";

const root = document.getElementById("test-root");
if (!root) throw new Error("Supplier order warning test root is missing.");

createRoot(root).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NarocilaDobaviteljem />
  </QueryClientProvider>,
);
