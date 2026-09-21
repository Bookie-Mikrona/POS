/**
 * Unit testi za funkcijo posljiEslogEmail (pos-email.ts).
 *
 * Mockano : nodemailer (zajamemo sendMail poziv brez SMTP strežnika)
 * Preverja: vsebina e-pošte, priloženi dokumenti (.pdf + .xml), naslovnik,
 *           zaznavanje napak, guard pogoji (SMTP ni aktiven / nepopoln)
 *
 * Scenariji:
 *  U-1  dve prilogi: .pdf in .xml z ustreznim content-type
 *  U-2  XML vsebina je nespremenjena (kot vhodna vrednost)
 *  U-3  zadeva vsebuje stevilkaRacuna in naziv podjetja
 *  U-4  smtpAktiven=false → { uspeh: false } brez sendMail klica
 *  U-5  manjkajoč smtpHost → { uspeh: false } brez sendMail klica
 *  U-6  sendMail vrže napako → { uspeh: false, napaka: msg }
 *  U-7  uspešen klic → { uspeh: true }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: dostopno v vi.mock factory ────────────────────────────────────
const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: "unit-test-ok" }),
}));

// ── Nodemailer mock ────────────────────────────────────────────────────────────
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mockSendMail }),
  },
}));

// ── Uvoz (po vi.mock, ki je hoisted) ─────────────────────────────────────────
import { posljiEslogEmail } from "./pos-email";

// ── Pomožni testni podatki ─────────────────────────────────────────────────────
const VELJAVNI_SMTP = {
  smtpAktiven: true,
  smtpHost: "smtp.test.local",
  smtpUser: "test@test.local",
  smtpPassword: "geslo123",
  smtpFrom: "noreply@test.local",
  smtpPort: 587,
};

const RACUN_PODATKI = {
  stevilkaRacuna: "PP001-B001-000042",
  skupaj: 121.00,
  ddv: 21.00,
  datumIzdaje: "2026-08-21",
  kupecNaziv: "Test Kupec d.o.o.",
};

const FAKE_XML = `<?xml version="1.0"?><Invoice><ID>PP001-B001-000042</ID></Invoice>`;
const FAKE_PDF = Buffer.from("UNIT-TEST-PDF-VSEBINA");

beforeEach(() => {
  mockSendMail.mockClear();
  mockSendMail.mockResolvedValue({ messageId: "unit-test-ok" });
});

// ── Testi ─────────────────────────────────────────────────────────────────────
describe("posljiEslogEmail — unit testi", () => {

  it("U-1: e-pošta vsebuje točno 2 prilogi: .pdf in .xml s pravilnima content-type", async () => {
    const r = await posljiEslogEmail(
      VELJAVNI_SMTP as any,
      "kupec@primer.si",
      RACUN_PODATKI,
      FAKE_XML,
      FAKE_PDF,
      "Test Firma d.o.o.",
    );

    expect(r.uspeh).toBe(true);
    expect(mockSendMail).toHaveBeenCalledOnce();

    const arg = mockSendMail.mock.calls[0]![0] as {
      attachments: Array<{ filename: string; contentType: string; content: unknown }>;
    };

    // Točno 2 prilogi
    expect(arg.attachments).toHaveLength(2);

    const pdfAtt = arg.attachments.find(a => a.filename.endsWith(".pdf"));
    const xmlAtt = arg.attachments.find(a => a.filename.endsWith(".xml"));

    expect(pdfAtt).toBeDefined();
    expect(xmlAtt).toBeDefined();

    // Content-Type
    expect(pdfAtt!.contentType).toContain("application/pdf");
    expect(xmlAtt!.contentType).toContain("application/xml");

    // Imeni datotek iz stevilkaRacuna (posebni znaki zamenjani z _)
    expect(pdfAtt!.filename).toMatch(/^eracun-PP001.B001.000042\.pdf$/);
    expect(xmlAtt!.filename).toMatch(/^eracun-PP001.B001.000042\.xml$/);
  });

  it("U-2: XML vsebina v e-pošti je enaka vhodni vrednosti (nespremenjena)", async () => {
    await posljiEslogEmail(
      VELJAVNI_SMTP as any, "kupec@primer.si", RACUN_PODATKI,
      FAKE_XML, FAKE_PDF, "Test Firma",
    );

    const arg = mockSendMail.mock.calls[0]![0] as {
      attachments: Array<{ filename: string; content: unknown }>;
    };
    const xmlAtt = arg.attachments.find(a => a.filename.endsWith(".xml"));
    expect(xmlAtt!.content).toBe(FAKE_XML);
  });

  it("U-3: PDF vsebina v e-pošti je enaka vhodni Buffer vrednosti", async () => {
    await posljiEslogEmail(
      VELJAVNI_SMTP as any, "kupec@primer.si", RACUN_PODATKI,
      FAKE_XML, FAKE_PDF, "Test Firma",
    );

    const arg = mockSendMail.mock.calls[0]![0] as {
      attachments: Array<{ filename: string; content: unknown }>;
    };
    const pdfAtt = arg.attachments.find(a => a.filename.endsWith(".pdf"));
    const pdfBuf = Buffer.isBuffer(pdfAtt!.content)
      ? pdfAtt!.content as Buffer
      : Buffer.from(pdfAtt!.content as string);
    expect(pdfBuf.equals(FAKE_PDF)).toBe(true);
  });

  it("U-4: zadeva vsebuje stevilkaRacuna in naziv podjetja", async () => {
    const naziv = "Restavracija Fantazija";
    await posljiEslogEmail(
      VELJAVNI_SMTP as any, "kupec@primer.si", RACUN_PODATKI,
      FAKE_XML, FAKE_PDF, naziv,
    );

    const arg = mockSendMail.mock.calls[0]![0] as { subject: string; to: string };
    expect(arg.subject).toContain("PP001-B001-000042");
    expect(arg.subject).toContain(naziv);
    expect(arg.to).toBe("kupec@primer.si");
  });

  it("U-5: smtpAktiven=false → vrne { uspeh: false }, sendMail se ne pokliče", async () => {
    const r = await posljiEslogEmail(
      { ...VELJAVNI_SMTP, smtpAktiven: false } as any,
      "kupec@primer.si", RACUN_PODATKI, FAKE_XML, FAKE_PDF, "Firma",
    );

    expect(r.uspeh).toBe(false);
    expect(r.napaka).toBeDefined();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("U-6: manjkajoč smtpHost → vrne { uspeh: false }, sendMail se ne pokliče", async () => {
    const r = await posljiEslogEmail(
      { ...VELJAVNI_SMTP, smtpHost: "" } as any,
      "kupec@primer.si", RACUN_PODATKI, FAKE_XML, FAKE_PDF, "Firma",
    );

    expect(r.uspeh).toBe(false);
    expect(r.napaka).toBeDefined();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("U-7: sendMail vrže napako → vrne { uspeh: false, napaka: <msg> }", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("Timeout pri povezavi (test)"));

    const r = await posljiEslogEmail(
      VELJAVNI_SMTP as any, "kupec@primer.si", RACUN_PODATKI,
      FAKE_XML, FAKE_PDF, "Firma",
    );

    expect(r.uspeh).toBe(false);
    expect(r.napaka).toContain("Timeout pri povezavi");
  });

  it("U-8: uspešen klic → vrne { uspeh: true } brez napake", async () => {
    const r = await posljiEslogEmail(
      VELJAVNI_SMTP as any, "kupec@primer.si", RACUN_PODATKI,
      FAKE_XML, FAKE_PDF, "Firma",
    );

    expect(r.uspeh).toBe(true);
    expect(r.napaka).toBeUndefined();
  });
});
