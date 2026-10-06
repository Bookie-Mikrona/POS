import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { buildEmailSender } from "./email-sender";

const to = "customer@example.org";
const companyName = "Issuing Company";

describe("company e-mail sender", () => {
  it("uses a same-domain company mailbox without Reply-To; keeps MAIL FROM", () => {
    const result = buildEmailSender("info@mikrona.si", to, "Restaurant", {
      companyName, companyEmail: "office@mikrona.si",
    });
    expect(result).toEqual({
      from: { name: companyName, address: "office@mikrona.si" },
      envelope: { from: "info@mikrona.si", to },
    });
  });

  it("keeps foreign-domain company mailboxes out of From and uses Reply-To", () => {
    const result = buildEmailSender("info@mikrona.si", to, "Restaurant", {
      companyName, companyEmail: "office@company.si",
    });
    expect(result.from).toEqual({ name: companyName, address: "info@mikrona.si" });
    expect(result.replyTo).toEqual({ name: companyName, address: "office@company.si" });
    expect(result.envelope).toEqual({ from: "info@mikrona.si", to });
  });

  it.each([null, undefined, "", "  "])("omits Reply-To for missing company e-mail (%s)", companyEmail => {
    const result = buildEmailSender("info@mikrona.si", to, "Restaurant", { companyName, companyEmail });
    expect(result.from).toEqual({ name: companyName, address: "info@mikrona.si" });
    expect(result).not.toHaveProperty("replyTo");
  });

  it("parses SMTP senders with a display name", () => {
    const result = buildEmailSender('"Existing SMTP Name" <info@mikrona.si>', to, "Restaurant", {
      companyName, companyEmail: "office@company.si",
    });
    expect(result.from).toEqual({ name: companyName, address: "info@mikrona.si" });
    expect(result.envelope.from).toBe("info@mikrona.si");
    expect(result.replyTo?.address).toBe("office@company.si");
  });

  it("compares exact domains case-insensitively, not suffixes or subdomains", () => {
    expect(buildEmailSender("info@MIKRONA.SI", to, companyName, {
      companyEmail: "office@mikrona.si",
    }).from.address).toBe("office@mikrona.si");
    for (const domain of ["mail.mikrona.si", "evil-mikrona.si", "mikrona.si.evil.org"]) {
      const result = buildEmailSender("info@mikrona.si", to, companyName, {
        companyEmail: `office@${domain}`,
      });
      expect(result.from.address).toBe("info@mikrona.si");
      expect(result.replyTo?.address).toBe(`office@${domain}`);
    }
  });

  it("retains the existing function's company/restaurant name for legacy callers", () => {
    expect(buildEmailSender("SMTP Name <info@mikrona.si>", to, "Legacy Restaurant").from)
      .toEqual({ name: "Legacy Restaurant", address: "info@mikrona.si" });
    expect(buildEmailSender("info@mikrona.si", to, "Legacy Restaurant", {
      companyName: " ",
    }).from.name).toBe("Legacy Restaurant");
  });

  it.each(["office@company.si", "office@mikrona.si"])(
    "never adds Reply-To for password/test e-mail (%s)", companyEmail => {
      const result = buildEmailSender("info@mikrona.si", to, "Restaurant", {
        companyName, companyEmail,
      }, true);
      expect(result.from.name).toBe(companyName);
      expect(result).not.toHaveProperty("replyTo");
      expect(result.envelope.from).toBe("info@mikrona.si");
    },
  );

  it.each(["a@company.si, b@mikrona.si", "a@company.si\r\nBcc: victim@example.org", "not-an-email"])(
    "rejects invalid mailboxes without sending (%s)", companyEmail => {
      expect(() => buildEmailSender("info@mikrona.si", to, companyName, { companyEmail })).toThrow();
    },
  );

  it("rejects injected display names and invalid SMTP senders", () => {
    expect(() => buildEmailSender("info@mikrona.si", to, companyName, {
      companyName: "Name\r\nBcc: victim@example.org",
    })).toThrow();
    expect(() => buildEmailSender("a@mikrona.si, b@mikrona.si", to, companyName)).toThrow();
  });

  it("produces the real MIME headers while retaining the SMTP envelope (no network)", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({
      ...buildEmailSender("SMTP Name <info@mikrona.si>", to, "Restaurant", {
        companyName, companyEmail: "office@company.si",
      }),
      to, subject: "Local header test", text: "Test",
    });
    const mime = info.message.toString();
    expect(mime).toContain("From: Issuing Company <info@mikrona.si>");
    expect(mime).toContain("Reply-To: Issuing Company <office@company.si>");
    expect(info.envelope).toEqual({ from: "info@mikrona.si", to });
  });
});
