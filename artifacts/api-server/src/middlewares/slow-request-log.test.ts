import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger", () => ({ logger: { warn } }));

import { slowRequestLog } from "./slow-request-log";

function run(delayMs: number, threshold?: string) {
  vi.stubEnv("POS_SLOW_REQUEST_MS", threshold);
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  const req = { method: "GET", originalUrl: "/api/mize?token=secret", route: { path: "/mize" } };
  const next = vi.fn();
  slowRequestLog(req as never, res as never, next);
  expect(next).toHaveBeenCalledOnce();
  const spy = vi.spyOn(process, "hrtime");
  const base = process.hrtime.bigint();
  spy.mockRestore();
  vi.spyOn(process.hrtime, "bigint").mockReturnValue(base + BigInt(delayMs * 1e6));
  res.emit("finish");
}

describe("slowRequestLog", () => {
  beforeEach(() => { warn.mockClear(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("zabeleži počasen zahtevek brez poizvedbenega niza", () => {
    run(1500);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/api/mize", routePattern: "/mize", statusCode: 200 }),
      "POS počasen zahtevek",
    );
  });

  it("ne beleži hitrega zahtevka", () => {
    run(50);
    expect(warn).not.toHaveBeenCalled();
  });

  it("spoštuje prag iz okolja", () => {
    run(300, "200");
    expect(warn).toHaveBeenCalledOnce();
  });
});
