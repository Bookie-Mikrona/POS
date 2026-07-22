/**
 * Nočno čiščenje sej — vsak dan ob 4:00 zjutraj (po slovenskem času)
 * prekine vse aktivne seje razen sej super adminov.
 */
import { clerkClient } from "@clerk/express";
import { logger } from "./logger";

const SUPER_ADMIN_IDS = new Set(
  (process.env["SUPER_ADMIN_IDS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

/** Millisekunde do naslednje 4:00 po slovenskem času (Europe/Ljubljana). */
function msDoNaslednje4Zjutraj(): number {
  const zdaj = new Date();

  // Slovenski čas — wallclock ura ob kateri smo
  const formatirec = new Intl.DateTimeFormat("sl-SI", {
    timeZone: "Europe/Ljubljana",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const deli = formatirec.formatToParts(zdaj);
  const pridobi = (tip: string) =>
    parseInt(deli.find((d) => d.type === tip)?.value ?? "0", 10);

  const ura = pridobi("hour");
  const minuta = pridobi("minute");
  const sekunda = pridobi("second");

  // Sekunde od polnoči do 4:00
  const sekundeDo4 = 4 * 3600;
  const sekundeOdPolnoci = ura * 3600 + minuta * 60 + sekunda;

  let preostaleSecunde: number;
  if (sekundeOdPolnoci < sekundeDo4) {
    preostaleSecunde = sekundeDo4 - sekundeOdPolnoci;
  } else {
    preostaleSecunde = 24 * 3600 - sekundeOdPolnoci + sekundeDo4;
  }

  return preostaleSecunde * 1000;
}

/** Razveljavi vse aktivne seje vseh non-superadmin uporabnikov. */
async function razveljaviSejeNonAdmin(): Promise<void> {
  logger.info("Nočno čiščenje sej: začenjam");
  try {
    const usersResp = await clerkClient.users.getUserList({ limit: 500 });
    const navadniUporabniki = usersResp.data.filter((u) => !SUPER_ADMIN_IDS.has(u.id));

    let razveljavil = 0;
    await Promise.all(
      navadniUporabniki.map(async (u) => {
        try {
          const sejResp = await clerkClient.sessions.getSessionList({
            userId: u.id,
            status: "active",
            limit: 100,
          });
          await Promise.all(
            sejResp.data.map((s) =>
              clerkClient.sessions
                .revokeSession(s.id)
                .then(() => { razveljavil++; })
                .catch(() => {}),
            ),
          );
        } catch {
          // Napaka pri posameznem userju ne prekine celotnega čiščenja
        }
      }),
    );

    logger.info({ razveljavil }, "Nočno čiščenje sej: končano");
  } catch (err) {
    logger.error({ err }, "Nočno čiščenje sej: napaka");
  }
}

/** Zaženi urnik. Kliči enkrat ob zagonu strežnika. */
export function zaženiNočnoČiščenje(): void {
  const ms = msDoNaslednje4Zjutraj();
  const minUte = Math.round(ms / 60_000);
  logger.info(
    { naslednjeZaganjanje: `čez ${minUte} min` },
    "Nočno čiščenje sej: urnik nastavljen",
  );

  function zaženiInPonovi() {
    razveljaviSejeNonAdmin();
    // Naslednjič čez 24h (+ majhna rezerva da ne zamudimo ure ob prehodu na zimski čas)
    setTimeout(zaženiInPonovi, 24 * 60 * 60 * 1000 + 60_000);
  }

  setTimeout(zaženiInPonovi, ms);
}
