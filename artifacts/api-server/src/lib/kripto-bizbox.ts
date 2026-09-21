// artifacts/api-server/src/lib/kripto-bizbox.ts
//
// AES-256-GCM šifriranje gesel za per-podjetje bizBox poverilnice.
//
// Ključ je BIZBOX_ENC_KEY (Replit Secret) — ločen od IMAP_ENC_KEY.
// Geslo se šifrira ob shranjevanju v bizbox_nastavitve; dešifrira samo
// interno ob loginBizbox() klicu. NIKOLI se ne vrne v API odgovoru.
//
// Format: base64(iv):base64(authTag):base64(ciphertext)

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITEM = 'aes-256-gcm';
const DOLZINA_IV = 12;    // priporočilo za GCM
const DOLZINA_ZNACKE = 16;

let kljucCache: Buffer | null = null;

function kljuc(): Buffer {
  if (kljucCache) return kljucCache;

  const surov = process.env.BIZBOX_ENC_KEY;
  if (!surov) {
    throw new Error(
      'Manjka BIZBOX_ENC_KEY. Dodajte jo v Replit Secrets — ' +
      'brez nje per-podjetje bizBox gesel ni mogoče brati.',
    );
  }
  if (surov.length < 32) {
    throw new Error('BIZBOX_ENC_KEY mora imeti vsaj 32 znakov.');
  }

  // Fiksna sol (ločena od IMAP sol), da sta ključa neodvisna.
  kljucCache = scryptSync(surov, 'bookie-bizbox-nastavitve', 32);
  return kljucCache;
}

/** Šifrira geslo; vrne base64(iv):base64(authTag):base64(ciphertext). */
export function sifrirajBizboxGeslo(geslo: string): string {
  const iv = randomBytes(DOLZINA_IV);
  const sifrer = createCipheriv(ALGORITEM, kljuc(), iv);
  const sifropis = Buffer.concat([sifrer.update(geslo, 'utf8'), sifrer.final()]);
  const znacka = sifrer.getAuthTag();
  return [iv, znacka, sifropis].map((b) => b.toString('base64')).join(':');
}

/** Dešifrira zapis iz DB; vrne čistopis. Vrže napako ob napačnem ključu/zapisu. */
export function desifrirajBizboxGeslo(zapis: string): string {
  const deli = zapis.split(':');
  if (deli.length !== 3) {
    throw new Error('Šifrirano bizBox geslo ni v pričakovani obliki iv:značka:šifropis.');
  }

  const [iv, znacka, sifropis] = deli.map((d) => Buffer.from(d, 'base64'));
  if (iv.length !== DOLZINA_IV || znacka.length !== DOLZINA_ZNACKE) {
    throw new Error('Šifrirano bizBox geslo ima napačne dolžine polj.');
  }

  const desifrer = createDecipheriv(ALGORITEM, kljuc(), iv);
  desifrer.setAuthTag(znacka);

  try {
    return Buffer.concat([desifrer.update(sifropis), desifrer.final()]).toString('utf8');
  } catch {
    throw new Error(
      'bizBox gesla ni bilo mogoče dešifrirati. ' +
      'Preverite, ali se BIZBOX_ENC_KEY ujema s tistim ob shranjevanju.',
    );
  }
}

/** Samopreizkus: šifriraj → dešifriraj → primerjaj. Vrne true, če ključ deluje. */
export function preveriKljucBizbox(): boolean {
  try {
    const vzorec = 'preizkus-bizbox-' + Date.now();
    return desifrirajBizboxGeslo(sifrirajBizboxGeslo(vzorec)) === vzorec;
  } catch {
    return false;
  }
}
