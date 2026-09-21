// Edinstven ključ naprave — mora biti ISTI ključ kot v NapravaContext ("pos_naprava_kljuc").
// customFetch pošilja ta UUID kot X-Naprava-Id header; NapravaContext ga pošilja ob
// registraciji. Brez usklajenega ključa se agentTiskalnikIme shrani na napačno naprava-vrstico.
const DEVICE_KEY = "pos_naprava_kljuc";
const LEGACY_KEY = "napravaId";

export function getNapravaId(): string {
  // Primarni ključ
  const primary = localStorage.getItem(DEVICE_KEY);
  if (primary) return primary;

  // Migracija: če obstaja stari ključ, prevzamemo njegovo vrednost
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    localStorage.setItem(DEVICE_KEY, legacy);
    return legacy;
  }

  // Noben ključ ni nastavljen — ustvari novega
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}
