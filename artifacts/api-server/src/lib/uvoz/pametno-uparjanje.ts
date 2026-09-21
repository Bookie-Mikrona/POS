import { z } from 'zod';
import { anthropic } from '@workspace/integrations-anthropic-ai';
import { normalizirajNaziv } from './dto';
import type { Kandidat } from './uparjanje';

const AiIzborSchema = z.object({
  artikelId: z.number().int().nullable(),
  zaupanje: z.number().min(0).max(1),
  razlog: z.string().max(300),
});

const MERSKE_ENOTE: Record<string, { vrsta: 'vol' | 'masa'; faktor: number }> = {
  ml: { vrsta: 'vol', faktor: 1 },
  cl: { vrsta: 'vol', faktor: 10 },
  dl: { vrsta: 'vol', faktor: 100 },
  l: { vrsta: 'vol', faktor: 1000 },
  g: { vrsta: 'masa', faktor: 1 },
  gr: { vrsta: 'masa', faktor: 1 },
  dag: { vrsta: 'masa', faktor: 10 },
  kg: { vrsta: 'masa', faktor: 1000 },
};

export function normalizirajNazivZaUparjanje(vrednost: string | null | undefined): string {
  return normalizirajNaziv(vrednost)
    .replace(/(\d+(?:\.\d+)?)\s*(ml|cl|dl|dag|kg|gr|g|l)\b/g, (_celota, stevilo: string, enota: string) => {
      const definicija = MERSKE_ENOTE[enota];
      const kolicina = Number(stevilo) * definicija.faktor;
      const zapis = Number.isInteger(kolicina) ? String(kolicina) : String(Number(kolicina.toFixed(3)));
      return `${zapis}${definicija.vrsta === 'vol' ? 'ml' : 'g'}`;
    })
    .replace(/\b(stv|stek|stekl|steklen)\b/g, 'steklenica')
    .replace(/\b(plast|plasticna|plasticen|pet)\b/g, 'plastika')
    .replace(/\b(plo|ploc|plocev)\b/g, 'plocevinka')
    .replace(/\s+/g, ' ')
    .trim();
}

export function podobnostNormaliziranihNazivov(a: string, b: string): number {
  const prvi = new Set(normalizirajNazivZaUparjanje(a).split(' ').filter(Boolean));
  const drugi = new Set(normalizirajNazivZaUparjanje(b).split(' ').filter(Boolean));
  if (prvi.size === 0 || drugi.size === 0) return 0;
  let skupnih = 0;
  for (const token of prvi) if (drugi.has(token)) skupnih += 1;
  return (2 * skupnih) / (prvi.size + drugi.size);
}

export interface AiPredlogUparjanja {
  artikelId: number;
  zaupanje: number;
  razlog: string;
}

let aiVrsta: Promise<void> = Promise.resolve();
let naslednjiAiKlicPo = 0;

async function pocakaj(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function vAiVrsti<T>(delo: () => Promise<T>): Promise<T> {
  let sprosti!: () => void;
  const prejsnji = aiVrsta;
  aiVrsta = new Promise<void>(resolve => { sprosti = resolve; });
  await prejsnji;
  try {
    const premor = Math.max(0, naslednjiAiKlicPo - Date.now());
    if (premor > 0) await pocakaj(premor);
    naslednjiAiKlicPo = Date.now() + 250;
    return await delo();
  } finally {
    sprosti();
  }
}

export async function predlagajUparjanjeZAi(
  nazivDobavnice: string,
  kandidati: Kandidat[],
): Promise<AiPredlogUparjanja | null> {
  if (!nazivDobavnice.trim() || kandidati.length === 0) return null;

  const dovoljeniIds = new Set(kandidati.map(kandidat => kandidat.artikelId));
  return vAiVrsti(async () => {
    for (let poskus = 0; poskus < 2; poskus += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      system: [
        'Upari naziv artikla z dobavnice izključno z enim od podanih artiklov ali vrni null.',
        'Razumi slovenske gostinske okrajšave, OCR napake, sopomenke, embalažo in enakovredne merske zapise.',
        'Primer: 0,5 l je 5 dl oziroma 500 ml; stv ali stek pomeni steklenica.',
        'Ne izmišljaj ID-jev. Če vrsta, znamka, okus ali količina nasprotujejo, vrni null.',
        'To je samo predlog za človeško potrditev.',
      ].join(' '),
      messages: [{
        role: 'user',
        content: JSON.stringify({
          nazivDobavnice,
          normaliziranNaziv: normalizirajNazivZaUparjanje(nazivDobavnice),
          kandidati: kandidati.slice(0, 20).map(kandidat => ({
            artikelId: kandidat.artikelId,
            naziv: kandidat.naziv,
            normaliziranNaziv: normalizirajNazivZaUparjanje(kandidat.naziv),
            osnovnaEnota: kandidat.osnovnaEnota,
          })),
        }),
      }],
      tools: [{
        name: 'predlagaj_uparjanje',
        description: 'Izbere en obstoječ artikel kot predlog ali vrne null.',
        input_schema: {
          type: 'object',
          properties: {
            artikelId: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            zaupanje: { type: 'number', minimum: 0, maximum: 1 },
            razlog: { type: 'string', maxLength: 300 },
          },
          required: ['artikelId', 'zaupanje', 'razlog'],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: 'tool', name: 'predlagaj_uparjanje' },
        }, { signal: controller.signal, timeout: 8_000 });

        const tool = response.content.find(block => block.type === 'tool_use');
        if (!tool || tool.type !== 'tool_use') return null;
        const parsed = AiIzborSchema.safeParse(tool.input);
        if (!parsed.success || parsed.data.artikelId == null || !dovoljeniIds.has(parsed.data.artikelId)) return null;
        return {
          artikelId: parsed.data.artikelId,
          zaupanje: parsed.data.zaupanje,
          razlog: parsed.data.razlog,
        };
      } catch (error: unknown) {
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : null;
        if (status === 429 && poskus === 0) {
          await pocakaj(750);
          continue;
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  });
}