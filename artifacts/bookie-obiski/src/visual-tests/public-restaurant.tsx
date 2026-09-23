import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { RestaurantProfileContent } from "../pages/public-restaurant";
import {
  visualTestRestaurant,
  visualTestVoucherCatalog,
} from "@workspace/public-venue-ui/visual-test-fixture";
import "../index.css";

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.endsWith(`/api/javno/restavracije/${visualTestRestaurant.slug}`)) {
    return Response.json(visualTestRestaurant);
  }
  if (url.endsWith(`/api/javno/restavracije/${visualTestRestaurant.slug}/boni`)) {
    return Response.json(visualTestVoucherCatalog);
  }
  throw new Error(`Visual test tried an unexpected request: ${url}`);
};

function VisualPublicPage() {
  useEffect(() => {
    const timer = window.setInterval(() => {
      const voucherTab = document.querySelector<HTMLElement>('[data-testid="button-preview-vouchers-tab"]');
      if (!voucherTab) return;
      voucherTab.click();
      document.body.dataset.visualReady = "true";
      window.clearInterval(timer);
    }, 20);
    return () => window.clearInterval(timer);
  }, []);
  return <RestaurantProfileContent slug={visualTestRestaurant.slug} />;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <VisualPublicPage />
  </QueryClientProvider>,
);