import { createServer, type Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { sendStripeSyncOperationalNotification } from "./stripeSyncFailureMonitor";

afterEach(() => vi.unstubAllEnvs());

it("rejects an SMTP server without STARTTLS before sending credentials or mail", async () => {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 test.example ESMTP\r\n");
    let buffered = "";
    socket.on("data", (data) => {
      buffered += data.toString();
      let end: number;
      while ((end = buffered.indexOf("\r\n")) !== -1) {
        const command = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        commands.push(command);
        if (command.startsWith("EHLO")) {
          // Advertise AUTH but not STARTTLS, as an insecure or downgraded relay would.
          socket.write("250-test.example\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (command === "STARTTLS") {
          socket.write("502 STARTTLS not supported\r\n");
        } else {
          socket.write("500 Unexpected command\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no TCP port");
    vi.stubEnv("STRIPE_SYNC_ALERT_EMAIL", "operator@example.test");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", String(address.port));
    vi.stubEnv("SMTP_USER", "fake-test-user");
    vi.stubEnv("SMTP_PASSWORD", "fake-test-password");
    vi.stubEnv("SMTP_FROM", "sender@example.test");
    expect(await sendStripeSyncOperationalNotification({ type: "test" })).toEqual({
      success: false, code: "delivery_failed",
    });
    expect(commands.some((command) => command.startsWith("EHLO"))).toBe(true);
    expect(commands).toContain("STARTTLS");
    expect(commands.some((command) => /^(AUTH|MAIL FROM|RCPT TO|DATA)\b/.test(command))).toBe(false);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
