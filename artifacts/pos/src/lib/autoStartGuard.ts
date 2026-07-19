// Avtostart zaščita — blokada s časovno omejitvijo
//
// Blokada se nastavi ko avtostart ustvari ali ko se prazno naročilo prekliče.
// Samodejno poteče po BLOCK_MS millisekund — preprečuje trajno blokado.
// Pobriše se takoj ko se doda artikel (clearSkipAutoStart).

const SS_KEY = "_pos_skipAutoStart_ts"; // shranjuje timestamp (ms) nastavitve blokade
const BLOCK_MS = 60_000; // 60 sekund — dovolj za zanko (2-5s), premalo za novega kupca

// Modul-nivojska spremenljivka (preživi React remounte, resets on HMR/page-reload)
let _modBlockedAt = 0;

export const setSkipAutoStart = (): void => {
  const now = Date.now();
  _modBlockedAt = now;
  try { sessionStorage.setItem(SS_KEY, String(now)); } catch { /* ignore */ }
};

export const clearSkipAutoStart = (): void => {
  _modBlockedAt = 0;
  try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
};

export const shouldSkipAutoStart = (): boolean => {
  const now = Date.now();

  // Preveri modul-nivojsko blokado (hitra pot, brez IO)
  if (_modBlockedAt > 0) {
    if (now - _modBlockedAt <= BLOCK_MS) return true;
    _modBlockedAt = 0; // potekla — počisti
  }

  // Preveri sessionStorage (preživi HMR reset)
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (now - ts <= BLOCK_MS) return true;
    sessionStorage.removeItem(SS_KEY); // potekla — počisti
  } catch { /* ignore */ }

  return false;
};
