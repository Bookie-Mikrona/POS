import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { encryptSmtpPassword, decryptSmtpPassword } from "./erp-smtp-settings";
import { SaveErpSmtpSettingsBody, TestErpSmtpSettingsBody } from "@workspace/api-zod";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "smtp-test-only-key-with-at-least-32-characters"));
afterEach(() => vi.unstubAllEnvs());

describe("ERP SMTP credential protection", () => {
  it("encrypts with random IVs, decrypts for the same company only", () => {
    const first = encryptSmtpPassword("test-password", "company-a");
    const second = encryptSmtpPassword("test-password", "company-a");
    expect(first).not.toBe(second);
    expect(first).not.toContain("test-password");
    expect(decryptSmtpPassword(first, "company-a")).toBe("test-password");
    expect(() => decryptSmtpPassword(first, "company-b")).toThrow();
    const parts = first.split(":");
    parts[1] = Buffer.alloc(16).toString("base64");
    expect(() => decryptSmtpPassword(parts.join(":"), "company-a")).toThrow();
  });
  it("fails closed when the key is absent, invalid or changed", () => {
    const encrypted = encryptSmtpPassword("test-password", "company-a");
    vi.stubEnv("SESSION_SECRET", "different-test-key-with-at-least-32-characters");
    expect(() => decryptSmtpPassword(encrypted, "company-a")).toThrow();
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => encryptSmtpPassword("test-password", "company-a")).toThrow();
    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => encryptSmtpPassword("test-password", "company-a")).toThrow();
    expect(() => decryptSmtpPassword("invalid", "company-a")).toThrow();
  });
});

describe("SMTP input contract", () => {
  const valid = { host: "mail.example.si", port: 465, user: "user", from: "sender@example.si" };
  it("supports implicit TLS and STARTTLS, and an omitted or empty password", () => {
    expect(SaveErpSmtpSettingsBody.safeParse(valid).success).toBe(true);
    expect(SaveErpSmtpSettingsBody.safeParse({ ...valid, port: 587, password: "" }).success).toBe(true);
  });
  it.each([
    { port: 25 }, { port: "465" }, { host: "https://mail.example.si" },
    { host: "smtp.example.si\r\nX: test" }, { from: "a@example.si,b@example.si" },
    { from: "a@example.si\r\nBcc: evil@example.si" }, { user: "" }, { host: "" },
  ])("rejects invalid config %j", invalid => {
    expect(SaveErpSmtpSettingsBody.safeParse({ ...valid, ...invalid }).success).toBe(false);
  });
  it("accepts only one valid test recipient", () => {
    expect(TestErpSmtpSettingsBody.safeParse({ recipient: "test@example.si" }).success).toBe(true);
    expect(TestErpSmtpSettingsBody.safeParse({ recipient: "test@example.si,other@example.si" }).success).toBe(false);
  });
});
