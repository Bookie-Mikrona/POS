import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport, getErpSmtp } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail, close: vi.fn() })), getErpSmtp: vi.fn() };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("./erp-smtp-settings", async importOriginal => ({
  ...await importOriginal<typeof import("./erp-smtp-settings")>(),
  getErpSmtp,
}));

import { posljiEmailRacun, posljiEmailZacasnoGeslo, posljiEslogEmail, posljiTestnoEmail } from "./pos-email";
import { posljiPorociloPdf } from "./erp-email";

const smtp = {
  smtpHost: "smtp.example.invalid", smtpPort: 587, smtpUser: "test-user",
  smtpPassword: "test-only-placeholder", smtpFrom: "SMTP Name <info@mikrona.si>", smtpAktiven: true,
};
const sender = { companyName: "Issuing Company", companyEmail: "office@company.si" };
const receipt = {
  stevilkaRacuna: "TEST-1", skupaj: 12, ddv: 2, placilnaNacin: "gotovina",
  zoi: null, eor: null, ustvarjeno: "2026-10-01",
};
const report = {
  companyId: "company-report",
  prejemnik: "customer@example.org", companyName: "Legacy Company", reportTitle: "Report",
  subtitle: "Period", filename: "report.pdf", pdfBuffer: Buffer.from("test PDF"),
};

beforeEach(() => {
  vi.clearAllMocks();
  getErpSmtp.mockResolvedValue({
    host: smtp.smtpHost, port: 587, user: smtp.smtpUser,
    password: smtp.smtpPassword, from: smtp.smtpFrom,
  });
  sendMail.mockResolvedValue({ messageId: "local-test" });
  // Only the isolated test process sees these dummy settings. No real SMTP connection.
  for (const [key, value] of Object.entries({
    SMTP_HOST: smtp.smtpHost, SMTP_PORT: "587", SMTP_USER: smtp.smtpUser,
    SMTP_PASSWORD: smtp.smtpPassword, SMTP_FROM: smtp.smtpFrom,
  })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("all five send functions share company sender policy", () => {
  it.each([
    ["receipt", () => posljiEmailRacun(smtp, report.prejemnik, receipt, "Restaurant", sender)],
    ["e-SLOG", () => posljiEslogEmail(smtp, report.prejemnik, {
      ...receipt, datumIzdaje: "2026-10-01", kupecNaziv: null,
    }, "<Invoice/>", report.pdfBuffer, "Restaurant", sender)],
    ["ERP PDF", () => posljiPorociloPdf(report, sender)],
  ] as const)("%s uses company name, safe From, Reply-To and fixed envelope", async (_kind, send) => {
    expect((await send()).uspeh).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: sender.companyName, address: "info@mikrona.si" },
      replyTo: { name: sender.companyName, address: sender.companyEmail },
      envelope: { from: "info@mikrona.si", to: report.prejemnik },
    }));
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: smtp.smtpHost, port: 587, secure: false,
      auth: { user: smtp.smtpUser, pass: smtp.smtpPassword },
      tls: { rejectUnauthorized: true },
    }));
  });

  it.each([
    ["password", () => posljiEmailZacasnoGeslo(smtp, report.prejemnik, "test-user", null, "test-only", "Restaurant", sender)],
    ["SMTP test", () => posljiTestnoEmail(smtp, report.prejemnik, "Restaurant", sender)],
  ] as const)("%s uses company name and never Reply-To", async (_kind, send) => {
    expect((await send()).uspeh).toBe(true);
    const mail = sendMail.mock.calls[0]![0];
    expect(mail.from).toEqual({ name: sender.companyName, address: "info@mikrona.si" });
    expect(mail).not.toHaveProperty("replyTo");
    expect(mail.envelope.from).toBe("info@mikrona.si");
  });

  it("keeps old callers working without the optional sender argument", async () => {
    expect((await posljiEmailRacun(smtp, report.prejemnik, receipt, "Legacy Restaurant")).uspeh).toBe(true);
    expect(sendMail.mock.calls[0]![0].from).toEqual({ name: "Legacy Restaurant", address: "info@mikrona.si" });
    expect(sendMail.mock.calls[0]![0]).not.toHaveProperty("replyTo");
    expect((await posljiPorociloPdf(report)).uspeh).toBe(true);
    expect(sendMail.mock.calls[1]![0].from.name).toBe("Legacy Company");
  });

  it("uses same-domain From while keeping the configured MAIL FROM", async () => {
    await posljiEmailRacun(smtp, report.prejemnik, receipt, "Restaurant", {
      ...sender, companyEmail: "office@mikrona.si",
    });
    const mail = sendMail.mock.calls[0]![0];
    expect(mail.from.address).toBe("office@mikrona.si");
    expect(mail.envelope.from).toBe("info@mikrona.si");
    expect(mail).not.toHaveProperty("replyTo");
  });

  it("ERP uses stored company settings with implicit TLS on port 465", async () => {
    getErpSmtp.mockResolvedValue({ host: "mail.mikrona.si", port: 465,
      user: smtp.smtpUser, password: smtp.smtpPassword, from: smtp.smtpFrom });
    await posljiPorociloPdf(report, sender);
    expect(getErpSmtp).toHaveBeenCalledWith(report.companyId);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "mail.mikrona.si", port: 465, secure: true, tls: { rejectUnauthorized: true },
    }));
  });

  it.each(["receipt", "e-SLOG", "password", "SMTP test"])(
    "POS %s defaults to 465 with implicit TLS and certificate verification", async kind => {
      const config = { ...smtp, smtpHost: "mail.mikrona.si", smtpPort: 0 };
      if (kind === "receipt") await posljiEmailRacun(config, report.prejemnik, receipt, "Restaurant", sender);
      else if (kind === "e-SLOG") await posljiEslogEmail(config, report.prejemnik, {
        ...receipt, datumIzdaje: "2026-10-01", kupecNaziv: null,
      }, "<Invoice/>", report.pdfBuffer, "Restaurant", sender);
      else if (kind === "password") await posljiEmailZacasnoGeslo(config, report.prejemnik, "test-user", null, "test-only", "Restaurant", sender);
      else await posljiTestnoEmail(config, report.prejemnik, "Restaurant", sender);
      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: "mail.mikrona.si", port: 465, secure: true, tls: { rejectUnauthorized: true },
      }));
    },
  );
});
