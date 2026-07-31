// artifacts/api-server/src/lib/kripto.ts
//
// Šifriranje gesel za predale IMAP.
//
// Gesla predalov ne morejo biti spremenljivke okolja, ker so odvisna od
// najemnika. Zato so v zbirki, šifrirana s ključem, ki JE spremenljivka
// okolja (Replit Secrets: IMAP_ENC_KEY).
//
// AES-256-GCM: šifrira in hkrati overi. Če je zapis spremenjen,
// dešifriranje ne uspe, namesto da bi vrnilo smeti.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITEM = 'aes-256-gcm';
const DOLZINA_IV = 12;    // priporočilo za GCM
const DOLZINA_ZNACKE = 16;

let kljucCache: Buffer | null = null;

function kljuc(): Buffer {
  if (kljucCache) return kljucCache;

  const surov = process.env.IMAP_ENC_KEY;
  if (!surov) {
    throw new Error(
      'Manjka spremenljivka okolja IMAP_ENC_KEY. ' +
      'Dodajte jo v Replit Secrets — brez nje gesel predalov ni mogoče brati.',
    );
  }
  if (surov.length < 32) {
    throw new Error('IMAP_ENC_KEY mora imeti vsaj 32 znakov.');
  }

  // Fiksna sol: ključ mora biti izpeljan enako ob vsakem zagonu, sicer
  // se obstoječi zapisi ne dajo dešifrirati. Sol tu ni varnostni element
  // — to je ključ sam.
  kljucCache = scryptSync(surov, 'bookie-uvoz-predal', 32);
  return kljucCache;
}

/** Vrne niz oblike base64(iv):base64(značka):base64(šifropis). */
export function sifrirajGeslo(geslo: string): string {
  const iv = randomBytes(DOLZINA_IV);
  const sifrer = createCipheriv(ALGORITEM, kljuc(), iv);
  const sifropis = Buffer.concat([sifrer.update(geslo, 'utf8'), sifrer.final()]);
  const znacka = sifrer.getAuthTag();
  return [iv, znacka, sifropis].map((b) => b.toString('base64')).join(':');
}

export function desifrirajGeslo(zapis: string): string {
  const deli = zapis.split(':');
  if (deli.length !== 3) {
    throw new Error('Šifrirano geslo ni v pričakovani obliki iv:značka:šifropis.');
  }

  const [iv, znacka, sifropis] = deli.map((d) => Buffer.from(d, 'base64'));
  if (iv.length !== DOLZINA_IV || znacka.length !== DOLZINA_ZNACKE) {
    throw new Error('Šifrirano geslo ima napačne dolžine polj.');
  }

  const desifrer = createDecipheriv(ALGORITEM, kljuc(), iv);
  desifrer.setAuthTag(znacka);

  try {
    return Buffer.concat([desifrer.update(sifropis), desifrer.final()]).toString('utf8');
  } catch {
    // Napaka overjanja pomeni napačen ključ ali spremenjen zapis.
    // Izvirne napake ne izpisujemo naprej, da ne uhaja podrobnosti.
    throw new Error(
      'Gesla predala ni bilo mogoče dešifrirati. ' +
      'Preverite, ali se IMAP_ENC_KEY ujema s tistim ob shranjevanju gesla.',
    );
  }
}

/** Za preizkus nastavitve brez dostopa do zbirke. */
export function preveriKljuc(): boolean {
  try {
    const vzorec = 'preizkus-' + Date.now();
    return desifrirajGeslo(sifrirajGeslo(vzorec)) === vzorec;
  } catch {
    return false;
  }
}
