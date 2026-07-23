import app from "./app";
import { logger } from "./lib/logger";
import { zaženiNočnoČiščenje } from "./lib/sessionScheduler";
import { zaženiZapiranjeIzmene } from "./lib/izmeneScheduler";

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
});
