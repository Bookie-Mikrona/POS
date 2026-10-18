// A real API instance without background business schedulers. The allowlist is
// overridden only in this disposable process, never in the managed workflow.
import app from "../../src/app.ts";

const server = app.listen(Number(process.env.PORT), "127.0.0.1", () => {
  process.send?.({ type: "ready", port: server.address().port });
});
