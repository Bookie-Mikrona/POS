import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  userId: null as string | null,
  sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(),
}));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mocks.userId }) }));
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));
import router from "./superadmin-email";

const app = express();
app.use(express.json());
app.use("/superadmin/email", router);
const target = "/superadmin/email";
const body = { recipient: "admin@example.org", confirmRecipient: "admin@example.org", confirmed: true };
let clock = Date.now();

beforeEach(() => {
  vi.clearAllMocks();
  clock += 120_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  mocks.userId = "super-admin";
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
  mocks.sendMail.mockResolvedValue({ accepted: [body.recipient], rejected: [] });
  vi.stubEnv("SUPER_ADMIN_IDS", "super-admin,second-admin");
  for (const [key, value] of Object.entries({
    SMTP_HOST: "smtp.example.invalid", SMTP_PORT: "465", SMTP_FROM: "bookie@example.org",
    SMTP_USER: "test-user", SMTP_PASSWORD: "test-secret-do-not-return",
  })) vi.stubEnv(key, value);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("SuperAdmin global SMTP", () => {
  it.each([null, "ordinary-user"])("guards status and sending for %s", async userId => {
    mocks.userId = userId;
    const code = userId ? 403 : 401;
    expect((await request(app).get(target)).status).toBe(code);
    expect((await request(app).post(`${target}/test`).send(body)).status).toBe(code);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("returns only presence flags, does not connect, ignores unit/company headers", async () => {
    const response = await request(app).get(target).set("X-Company-Id", "other").set("X-Enota-Id", "99");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      configured: true, present: { host: true, from: true, user: true, password: true }, portValid: true, missing: [],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/test-secret|test-user|smtp\.example|bookie@/);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("handles empty configuration without attempting transport", async () => {
    for (const key of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "SMTP_PORT"]) vi.stubEnv(key, "");
    expect((await request(app).get(target)).body).toMatchObject({
      configured: false, missing: ["SMTP_HOST", "SMTP_FROM"],
      present: { host: false, from: false, user: false, password: false },
    });
    expect((await request(app).post(`${target}/test`).send(body)).status).toBe(503);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it.each(["0", "65536", "abc", "1.5"])("rejects invalid port %s", async port => {
    vi.stubEnv("SMTP_PORT", port);
    expect((await request(app).get(target)).body).toMatchObject({ configured: false, portValid: false, missing: ["SMTP_PORT"] });
    expect((await request(app).post(`${target}/test`).send(body)).status).toBe(503);
  });

  it("rejects partial authentication but allows an explicitly unauthenticated relay", async () => {
    vi.stubEnv("SMTP_PASSWORD", "");
    expect((await request(app).get(target)).body).toMatchObject({ configured: false, missing: ["SMTP_PASSWORD"] });
    vi.stubEnv("SMTP_USER", "");
    expect((await request(app).get(target)).body.configured).toBe(true);
  });

  it.each([
    {}, { ...body, confirmed: false }, { ...body, confirmRecipient: "other@example.org" },
    { ...body, recipient: "a@example.org,b@example.org", confirmRecipient: "a@example.org,b@example.org" },
    { ...body, recipient: "a@example.org\r\nBcc: b@example.org" },
    { ...body, recipient: "invalid", confirmRecipient: "invalid" },
  ])("requires exactly one repeated recipient and explicit confirmation", async input => {
    expect((await request(app).post(`${target}/test`).send(input)).status).toBe(400);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("uses the global transport, fixed message and a shared cooldown", async () => {
    expect((await request(app).post(`${target}/test`).send({ ...body, subject: "override", companyId: "other" })).body).toEqual({ ok: true });
    expect(mocks.sendMail).toHaveBeenCalledExactlyOnceWith({
      from: "bookie@example.org", to: body.recipient,
      subject: "Bookie — preizkus globalnega pošiljanja", text: expect.any(String),
    });
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      secure: true, auth: { user: "test-user", pass: "test-secret-do-not-return" },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, tls: { rejectUnauthorized: true },
    }));
    expect(mocks.close).toHaveBeenCalledOnce();
    mocks.userId = "second-admin";
    const retry = await request(app).post(`${target}/test`).send(body);
    expect(retry.status).toBe(429);
    expect(retry.headers["retry-after"]).toBe("60");
    clock += 60_000;
    expect((await request(app).post(`${target}/test`).send(body)).status).toBe(200);
  });

  it.each(["throw", "rejected", "empty", "creation"])("sanitizes %s failures and limits retries", async mode => {
    if (mode === "throw") mocks.sendMail.mockRejectedValue(new Error("test-secret-do-not-return smtp://user:token@host"));
    if (mode === "rejected") mocks.sendMail.mockResolvedValue({ accepted: [], rejected: [body.recipient] });
    if (mode === "empty") mocks.sendMail.mockResolvedValue({});
    if (mode === "creation") mocks.createTransport.mockImplementationOnce(() => { throw new Error("test-secret-do-not-return"); });
    const response = await request(app).post(`${target}/test`).send(body);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toMatch(/test-secret|token|smtp:|admin@example/);
    expect(mocks.close).toHaveBeenCalledTimes(mode === "creation" ? 0 : 1);
    expect((await request(app).post(`${target}/test`).send(body)).status).toBe(429);
  });

  it("blocks another in-flight request even after cooldown expires", async () => {
    let resolve!: (value: unknown) => void;
    mocks.sendMail.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const first = request(app).post(`${target}/test`).send(body).then(response => response);
    await vi.waitFor(() => expect(mocks.sendMail).toHaveBeenCalledOnce());
    clock += 120_000;
    expect((await request(app).post(`${target}/test`).send(body)).status).toBe(429);
    resolve({ accepted: [body.recipient], rejected: [] });
    expect((await first).status).toBe(200);
  });
});
