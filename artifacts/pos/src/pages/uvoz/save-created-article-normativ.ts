export type CreatedArticleNormativItem = {
  vhodniArtikelId: number;
  kolicina: number;
};

export async function saveCreatedArticleNormativ({
  url,
  headers,
  expectedRevision,
  items,
  fetchImpl = fetch,
}: {
  url: string;
  headers: Record<string, string>;
  expectedRevision: number;
  items: CreatedArticleNormativItem[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("Ustvarjeni artikel nima veljavne revizije normativa.");
  }

  const response = await fetchImpl(url, {
    method: "PUT",
    credentials: "include",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ items, expectedRevision }),
  });
  if (response.ok) return;

  const body = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(body.error ?? "Normativa novega artikla ni bilo mogoče shraniti.");
}