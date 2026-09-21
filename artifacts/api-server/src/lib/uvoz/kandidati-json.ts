export type UparjanjeKandidatJson = Record<string, unknown>;

/**
 * Kandidati so v starejših zapisih v PostgreSQL shranjeni kot JSON-besedilo,
 * novejši gonilniki pa jih lahko vrnejo že razčlenjene. API mora obravnavati
 * oba zapisa enako.
 */
export function razcleniUparjanjeKandidate(raw: unknown): UparjanjeKandidatJson[] {
  const pretvori = (vrednost: unknown): UparjanjeKandidatJson[] =>
    Array.isArray(vrednost)
      ? vrednost.filter(
          (kandidat): kandidat is UparjanjeKandidatJson =>
            typeof kandidat === 'object' && kandidat !== null,
        )
      : [];

  if (typeof raw === 'string') {
    try {
      return pretvori(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  return pretvori(raw);
}