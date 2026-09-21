import { aliasedTable, and, eq, inArray } from "drizzle-orm";
import {
  artModSkupineTable, artikliTable, db, modNormativiTable, modSkupineTable,
  modifikatorjiTable, normativiTable,
} from "@workspace/db";
import { alergeniZNazivi, type AlergenKoda } from "./alergeni";

export type AlergenIzracun = {
  alergeni: ReturnType<typeof alergeniZNazivi>;
  alergeniSledi: ReturnType<typeof alergeniZNazivi>;
  potrjen: boolean;
  opozorila: string[];
  izvori: Array<{ artikelId: number; artikel: string; vir: string | null; documentId: string | null }>;
};

export type AlergenResolverNode = {
  id: number; ime: string; alergeni: AlergenKoda[]; alergeniSledi: AlergenKoda[];
  alergeniStatus: "nepreverjeno" | "potrjeno_brez" | "potrjeno";
  alergeniVir: string | null; alergeniDocumentId: string | null;
};

async function naloziAlergenGraf(enotaId: number) {
  const articles = await db.select({
    id: artikliTable.id, ime: artikliTable.ime, alergeni: artikliTable.alergeni,
    alergeniSledi: artikliTable.alergeniSledi, alergeniStatus: artikliTable.alergeniStatus,
    alergeniVir: artikliTable.alergeniVir, alergeniDocumentId: artikliTable.alergeniDocumentId,
  }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
  const byId = new Map(articles.map((a) => [a.id, a as AlergenResolverNode]));
  const ownerArticle = aliasedTable(artikliTable, "alergen_owner_article");
  const childArticle = aliasedTable(artikliTable, "alergen_child_article");
  const recipeRows = await db.select({
    owner: normativiTable.artikelId, child: normativiTable.vhodniArtikelId,
  }).from(normativiTable)
    .innerJoin(ownerArticle, eq(ownerArticle.id, normativiTable.artikelId))
    .innerJoin(childArticle, eq(childArticle.id, normativiTable.vhodniArtikelId))
    .where(and(eq(ownerArticle.enotaId, enotaId), eq(childArticle.enotaId, enotaId)));
  const graph = new Map<number, number[]>();
  for (const row of recipeRows) graph.set(row.owner, [...(graph.get(row.owner) ?? []), row.child]);
  return { byId, graph };
}

export function razresiAlergeneIzGrafa(
  rootIds: number[],
  byId: Map<number, AlergenResolverNode>,
  graph: Map<number, number[]>,
): AlergenIzracun {
  const memo = new Map<number, { contains: Set<AlergenKoda>; traces: Set<AlergenKoda>; warnings: string[]; sources: AlergenIzracun["izvori"]; verified: boolean }>();
  const visit = (id: number, stack: Set<number>) => {
    const cached = memo.get(id); if (cached) return cached;
    const node = byId.get(id);
    if (!node) return { contains: new Set<AlergenKoda>(), traces: new Set<AlergenKoda>(), warnings: [`Manjkajoča sestavina #${id}.`], sources: [], verified: false };
    if (stack.has(id)) return { contains: new Set<AlergenKoda>(), traces: new Set<AlergenKoda>(), warnings: [`Zaznan cikel normativa pri artiklu »${node.ime}«.`], sources: [], verified: false };
    const next = new Set(stack); next.add(id);
    const contains = new Set(node.alergeni ?? []);
    const traces = new Set(node.alergeniSledi ?? []);
    const warnings: string[] = [];
    const sources: AlergenIzracun["izvori"] = [];
    let verified = node.alergeniStatus !== "nepreverjeno";
    if (!verified) warnings.push(`Sestavina »${node.ime}« nima potrjenega alergenskega profila.`);
    if (node.alergeniStatus !== "nepreverjeno") sources.push({ artikelId: node.id, artikel: node.ime, vir: node.alergeniVir, documentId: node.alergeniDocumentId });
    for (const child of graph.get(id) ?? []) {
      // permitted 1:1 self normative represents the same physical item, not a cycle
      if (child === id) continue;
      const result = visit(child, next);
      result.contains.forEach((code) => contains.add(code));
      result.traces.forEach((code) => traces.add(code));
      warnings.push(...result.warnings); sources.push(...result.sources); verified &&= result.verified;
    }
    contains.forEach((code) => traces.delete(code));
    const result = { contains, traces, warnings: [...new Set(warnings)], sources, verified };
    memo.set(id, result); return result;
  };

  const contains = new Set<AlergenKoda>();
  const traces = new Set<AlergenKoda>();
  const warnings: string[] = [];
  const sources: AlergenIzracun["izvori"] = [];
  let verified = rootIds.length > 0;
  for (const rootId of rootIds) {
    const result = visit(rootId, new Set());
    result.contains.forEach((code) => contains.add(code));
    result.traces.forEach((code) => traces.add(code));
    warnings.push(...result.warnings);
    sources.push(...result.sources);
    verified &&= result.verified;
  }
  contains.forEach((code) => traces.delete(code));
  const uniqueSources = [...new Map(sources.map(source => [source.artikelId, source])).values()];
  return {
    alergeni: alergeniZNazivi([...contains].sort()),
    alergeniSledi: alergeniZNazivi([...traces].sort()),
    potrjen: verified,
    opozorila: [...new Set(warnings)],
    izvori: uniqueSources,
  };
}

/** Resolve the base recipe. Selected modifiers are resolved separately. */
export async function razresiAlergeneArtikla(artikelId: number, enotaId: number): Promise<AlergenIzracun | null> {
  const { byId, graph } = await naloziAlergenGraf(enotaId);
  if (!byId.has(artikelId)) return null;
  return razresiAlergeneIzGrafa([artikelId], byId, graph);
}

/** Resolve an unsaved recipe from its currently selected input articles. */
export async function razresiAlergeneVhodnihArtiklov(vhodniArtikelIds: number[], enotaId: number): Promise<AlergenIzracun> {
  const { byId, graph } = await naloziAlergenGraf(enotaId);
  return razresiAlergeneIzGrafa([...new Set(vhodniArtikelIds)], byId, graph);
}

/** Conservative summary for a modifier option, based on its own normativ inputs. */
export async function razresiAlergeneModifikatorja(modifikatorId: number, enotaId: number): Promise<AlergenIzracun> {
  const inputs = await db.select({ artikelId: modNormativiTable.vhodniArtikelId })
    .from(modNormativiTable)
    .innerJoin(modifikatorjiTable, eq(modifikatorjiTable.id, modNormativiTable.modifikatorId))
    .innerJoin(modSkupineTable, eq(modSkupineTable.id, modifikatorjiTable.skupinaId))
    .where(and(eq(modNormativiTable.modifikatorId, modifikatorId), eq(modSkupineTable.enotaId, enotaId)));
  const resolved = await Promise.all(inputs.map((input) => razresiAlergeneArtikla(input.artikelId, enotaId)));
  const contains = new Set<AlergenKoda>(); const traces = new Set<AlergenKoda>();
  const warnings: string[] = []; const sources: AlergenIzracun["izvori"] = [];
  let potrjen = inputs.length > 0;
  for (const result of resolved) {
    if (!result) { potrjen = false; warnings.push("Sestavina modifikatorja ni najdena."); continue; }
    result.alergeni.forEach((item) => contains.add(item.koda));
    result.alergeniSledi.forEach((item) => traces.add(item.koda));
    warnings.push(...result.opozorila); sources.push(...result.izvori); potrjen &&= result.potrjen;
  }
  contains.forEach((code) => traces.delete(code));
  return { alergeni: alergeniZNazivi([...contains].sort()), alergeniSledi: alergeniZNazivi([...traces].sort()), potrjen, opozorila: [...new Set(warnings)], izvori: sources };
}

/** Mark every recipe parent as unverified and, when requested, the changed article itself. */
export async function razveljaviAlergeneNadrejenih(
  artikelId: number,
  executor: typeof db = db,
  includeSelf = true,
): Promise<void> {
  const rows = await executor.select({ parent: normativiTable.artikelId, child: normativiTable.vhodniArtikelId }).from(normativiTable);
  const reverse = new Map<number, number[]>();
  for (const row of rows) reverse.set(row.child, [...(reverse.get(row.child) ?? []), row.parent]);
  const ids = new Set<number>(includeSelf ? [artikelId] : []); const queue = [artikelId];
  const modifierParents = await executor.select({
    child: modNormativiTable.vhodniArtikelId, parent: artModSkupineTable.artikelId,
  }).from(modNormativiTable)
    .innerJoin(modifikatorjiTable, eq(modifikatorjiTable.id, modNormativiTable.modifikatorId))
    .innerJoin(artModSkupineTable, eq(artModSkupineTable.skupinaId, modifikatorjiTable.skupinaId));
  for (const row of modifierParents) reverse.set(row.child, [...(reverse.get(row.child) ?? []), row.parent]);
  while (queue.length) for (const parent of reverse.get(queue.shift()!) ?? []) if (!ids.has(parent)) { ids.add(parent); queue.push(parent); }
  if (ids.size > 0) {
    await executor.update(artikliTable).set({ alergeniStatus: "nepreverjeno", alergeniVerifiedBy: null, alergeniVerifiedAt: null })
      .where(inArray(artikliTable.id, [...ids]));
  }
}