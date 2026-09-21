import { afterEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

type TestClient = {
  query: (text: string) => Promise<unknown>;
  release: () => void;
};
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

describe("serializacija zalogovnih gibanj", () => {
  it("drugi zapis počaka, dokler prva transakcija drži zalogovni lock", async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    clients.push(first, second);

    await first.query("BEGIN");
    await first.query("UPDATE zaloga_gibi SET opomba = opomba WHERE false");

    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '150ms'");
    await expect(
      second.query("UPDATE zaloga_gibi SET opomba = opomba WHERE false"),
    ).rejects.toMatchObject({ code: "55P03" });
  });
});