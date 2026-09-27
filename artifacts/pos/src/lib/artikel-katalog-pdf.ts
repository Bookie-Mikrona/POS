import { posFetch } from "@/lib/pos-auth-headers";

export type ArtikelKatalogScope = "nabavni" | "prodajni" | "polizdelki" | "drobni" | "embalaza";

const FILE_NAMES: Record<ArtikelKatalogScope, string> = {
  nabavni: "katalog-nabavni.pdf",
  prodajni: "katalog-prodajni.pdf",
  polizdelki: "katalog-polizdelki.pdf",
  drobni: "katalog-drobni-inventar.pdf",
  embalaza: "katalog-embalaze.pdf",
};

export async function downloadArtikelKatalogPdf(scope: ArtikelKatalogScope): Promise<void> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await posFetch(`${base}/api/artikli/izvozi-katalog.pdf?scope=${scope}`);

  if (!response.ok) {
    const body = await response.text();
    let description = body || `Strežnik je vrnil napako ${response.status}`;
    try {
      const data = JSON.parse(body) as { error?: string; napaka?: string };
      description = data.error ?? data.napaka ?? description;
    } catch {
      // Error body is plain text.
    }
    throw new Error(description);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = FILE_NAMES[scope];
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}