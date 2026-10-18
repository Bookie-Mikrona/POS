import app from "./app";
import { logger } from "./lib/logger";
import { zaženiNočnoČiščenje } from "./lib/sessionScheduler";
import { zaženiZapiranjeIzmene } from "./lib/izmeneScheduler";
import { zazeniSproscanjeRezervacijMiz } from "./lib/rezervacijeMizScheduler";
import { startMonthlyPosBookingScheduler } from "./lib/monthlyPosBookingScheduler";
import { startOfflineFiscalRunner } from "./services/pos/offline-fiscal-runner";
import { startQrHistoryRetentionScheduler } from "./lib/qrHistoryRetention";
import { startVoucherDeliveryRetryScheduler } from "./routes/publicVisits";
import { startPublicProfileImageRetentionScheduler } from "./lib/publicProfileImageRetention";
import { startAllergenResearchRunner } from "./lib/allergen-research-runner";
import { startReportExportRetentionScheduler } from "./lib/reportExportRetention";
import { startUnknownRefundAlertScheduler } from "./lib/vivaRefundAlerts";
import { startVatXmlRecoveryScheduler } from "./lib/vatXmlRecovery";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Nočno čiščenje sej ob 4:00 zjutraj (slovenskega časa)
  zaženiNočnoČiščenje();

  // Samodejno zapiranje izmene ob začetku novega delovnega dne (per-enota ura)
  zaženiZapiranjeIzmene();

  // Ob zagonu in nato vsako minuto sprosti potečene rezervacije miz.
  zazeniSproscanjeRezervacijMiz();

  // Mesečni POS zbirnik se ustvari prvi delovni dan meseca ob 06:00.
  startMonthlyPosBookingScheduler();

  // Default-off durable retry runner for immutable offline FURS v2 cores.
  startOfflineFiscalRunner();

  // QR naprava ostane povezljiva z zaključeno zgodovino največ 30 dni.
  startQrHistoryRetentionScheduler();

  // Retry paid voucher delivery after transient SMTP failures.
  startVoucherDeliveryRetryScheduler();

  // Remove abandoned staged public profile images with a process and database lock.
  startPublicProfileImageRetentionScheduler();
  startAllergenResearchRunner();
  startReportExportRetentionScheduler();
  startUnknownRefundAlertScheduler();
  startVatXmlRecoveryScheduler();
});
