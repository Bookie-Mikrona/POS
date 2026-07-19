import nodemailer from "nodemailer";

export interface SmtpKonfiguracija {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpAktiven: boolean;
}

export async function posljiEmailZacasnoGeslo(
  smtp: SmtpKonfiguracija,
  prejemnik: string,
  username: string,
  ime: string | null,
  geslo: string,
  nazivRestavracije: string,
): Promise<{ uspeh: boolean; napaka?: string }> {
  if (!smtp.smtpAktiven) {
    return { uspeh: false, napaka: "Pošiljanje e-pošte ni aktivirano" };
  }
  if (!smtp.smtpHost || !smtp.smtpUser || !smtp.smtpPassword || !smtp.smtpFrom) {
    return { uspeh: false, napaka: "SMTP nastavitve niso popolne" };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.smtpHost,
    port: smtp.smtpPort || 587,
    secure: smtp.smtpPort === 465,
    auth: {
      user: smtp.smtpUser,
      pass: smtp.smtpPassword,
    },
    tls: { rejectUnauthorized: true },
  });

  const pozdrav = ime ? `Pozdravljeni, ${ime}!` : "Pozdravljeni!";
  const subject = `Začasno geslo — ${nazivRestavracije}`;
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
  <h2 style="color: #1a1a2e; margin-bottom: 8px;">${pozdrav}</h2>
  <p style="color: #555; margin-bottom: 16px;">
    Administrator ${nazivRestavracije} je nastavil novo začasno geslo za vaš račun.
  </p>
  <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
    <p style="margin: 0 0 6px; font-size: 13px; color: #888;">Uporabniško ime:</p>
    <p style="margin: 0 0 14px; font-size: 16px; font-weight: bold; color: #1a1a2e; font-family: monospace;">${username}</p>
    <p style="margin: 0 0 6px; font-size: 13px; color: #888;">Začasno geslo:</p>
    <p style="margin: 0; font-size: 22px; font-weight: bold; color: #2563eb; font-family: monospace; letter-spacing: 2px;">${geslo}</p>
  </div>
  <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
    <p style="margin: 0; font-size: 14px; color: #92400e;">
      <strong>Pomembno:</strong> Ob prvem vpisu boste pozvani, da spremenite začasno geslo v novo geslo po vaši izbiri.
    </p>
  </div>
  <p style="color: #888; font-size: 13px; margin: 0;">
    Če tega sporočila niste pričakovali, ga prosim prezrite.
  </p>
</div>
`;

  const text = `${pozdrav}\n\nAdministrator ${nazivRestavracije} je nastavil novo začasno geslo za vaš račun.\n\nUporabniško ime: ${username}\nZačasno geslo: ${geslo}\n\nOb prvem vpisu boste pozvani, da spremenite začasno geslo.\n`;

  try {
    await transporter.sendMail({
      from: smtp.smtpFrom,
      to: prejemnik,
      subject,
      text,
      html,
    });
    return { uspeh: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { uspeh: false, napaka: msg };
  }
}

export async function posljiEmailRacun(
  smtp: SmtpKonfiguracija,
  prejemnik: string,
  racun: {
    stevilkaRacuna: string;
    skupaj: number;
    ddv: number;
    placilnaNacin: string;
    zoi: string | null;
    eor: string | null;
    ustvarjeno: string | Date;
  },
  nazivRestavracije: string,
): Promise<{ uspeh: boolean; napaka?: string }> {
  if (!smtp.smtpAktiven) {
    return { uspeh: false, napaka: "Pošiljanje e-pošte ni aktivirano" };
  }
  if (!smtp.smtpHost || !smtp.smtpUser || !smtp.smtpPassword || !smtp.smtpFrom) {
    return { uspeh: false, napaka: "SMTP nastavitve niso popolne" };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.smtpHost,
    port: smtp.smtpPort || 587,
    secure: smtp.smtpPort === 465,
    auth: {
      user: smtp.smtpUser,
      pass: smtp.smtpPassword,
    },
    tls: { rejectUnauthorized: true },
  });

  const datum = new Date(racun.ustvarjeno);
  const datumStr = datum.toLocaleString("sl-SI", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const placilnaNacinSlo: Record<string, string> = {
    gotovina: "Gotovina",
    kartica: "Kartica",
    bon: "Bon",
  };
  const placilnaNacinPrikaz = placilnaNacinSlo[racun.placilnaNacin] ?? racun.placilnaNacin;
  const osnova = racun.skupaj - racun.ddv;

  const subject = `Račun ${racun.stevilkaRacuna} — ${nazivRestavracije}`;
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
  <h2 style="color: #1a1a2e; margin-bottom: 4px;">${nazivRestavracije}</h2>
  <p style="color: #888; font-size: 13px; margin-top: 0; margin-bottom: 20px;">Račun za plačilo</p>
  <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px; margin-bottom: 16px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="color: #888; padding: 5px 0;">Številka računa:</td>
        <td style="text-align: right; font-weight: bold; font-family: monospace; color: #1a1a2e;">${racun.stevilkaRacuna}</td>
      </tr>
      <tr>
        <td style="color: #888; padding: 5px 0;">Datum:</td>
        <td style="text-align: right; color: #1a1a2e;">${datumStr}</td>
      </tr>
      <tr>
        <td style="color: #888; padding: 5px 0;">Način plačila:</td>
        <td style="text-align: right; color: #1a1a2e;">${placilnaNacinPrikaz}</td>
      </tr>
      <tr style="border-top: 1px solid #e5e7eb;">
        <td style="color: #888; padding: 8px 0 5px;">Osnova (brez DDV):</td>
        <td style="text-align: right; color: #1a1a2e; padding-top: 8px;">${osnova.toFixed(2)} €</td>
      </tr>
      <tr>
        <td style="color: #888; padding: 5px 0;">DDV:</td>
        <td style="text-align: right; color: #1a1a2e;">${racun.ddv.toFixed(2)} €</td>
      </tr>
      <tr style="border-top: 2px solid #e5e7eb;">
        <td style="font-weight: bold; font-size: 16px; color: #1a1a2e; padding-top: 8px;">Skupaj:</td>
        <td style="text-align: right; font-weight: bold; font-size: 18px; color: #2563eb; padding-top: 8px;">${racun.skupaj.toFixed(2)} €</td>
      </tr>
    </table>
  </div>
  ${racun.zoi ? `
  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
    <p style="margin: 0 0 4px; font-size: 12px; color: #166534; font-weight: bold;">Davčno potrjen račun (FURS)</p>
    <p style="margin: 0; font-size: 11px; color: #166534; font-family: monospace; word-break: break-all;">ZOI: ${racun.zoi}</p>
    ${racun.eor ? `<p style="margin: 4px 0 0; font-size: 11px; color: #166534; font-family: monospace; word-break: break-all;">EOR: ${racun.eor}</p>` : ""}
  </div>
  ` : ""}
  <p style="color: #aaa; font-size: 12px; margin: 0; text-align: center;">
    Hvala za vaš obisk!
  </p>
</div>
`;
  const text = `${nazivRestavracije}\nRačun za plačilo\n\nŠtevilka: ${racun.stevilkaRacuna}\nDatum: ${datumStr}\nNačin plačila: ${placilnaNacinPrikaz}\nOsnova: ${osnova.toFixed(2)} €\nDDV: ${racun.ddv.toFixed(2)} €\nSkupaj: ${racun.skupaj.toFixed(2)} €\n${racun.zoi ? `\nZOI: ${racun.zoi}\n${racun.eor ? `EOR: ${racun.eor}\n` : ""}` : ""}\nHvala za vaš obisk!`;

  try {
    await transporter.sendMail({
      from: smtp.smtpFrom,
      to: prejemnik,
      subject,
      text,
      html,
    });
    return { uspeh: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { uspeh: false, napaka: msg };
  }
}

export async function posljiTestnoEmail(
  smtp: SmtpKonfiguracija,
  prejemnik: string,
  nazivRestavracije: string,
): Promise<{ uspeh: boolean; napaka?: string }> {
  if (!smtp.smtpHost || !smtp.smtpUser || !smtp.smtpPassword || !smtp.smtpFrom) {
    return { uspeh: false, napaka: "SMTP nastavitve niso popolne (strežnik, uporabnik, geslo in pošiljatelj so obvezni)" };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.smtpHost,
    port: smtp.smtpPort || 587,
    secure: smtp.smtpPort === 465,
    auth: {
      user: smtp.smtpUser,
      pass: smtp.smtpPassword,
    },
    tls: { rejectUnauthorized: true },
  });

  const subject = `Testno sporočilo — ${nazivRestavracije}`;
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
  <h2 style="color: #1a1a2e; margin-bottom: 8px;">Testno e-poštno sporočilo</h2>
  <p style="color: #555; margin-bottom: 16px;">
    SMTP konfiguracija za <strong>${nazivRestavracije}</strong> deluje pravilno.
    To sporočilo je bilo poslano kot preizkus nastavitev.
  </p>
  <div style="background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px;">
    <p style="margin: 0; font-size: 14px; color: #166534;">
      ✓ Pošiljanje e-pošte je uspešno konfigurirano.
    </p>
  </div>
</div>
`;
  const text = `Testno e-poštno sporočilo\n\nSMTP konfiguracija za ${nazivRestavracije} deluje pravilno.\nTo sporočilo je bilo poslano kot preizkus nastavitev.\n`;

  try {
    await transporter.sendMail({
      from: smtp.smtpFrom,
      to: prejemnik,
      subject,
      text,
      html,
    });
    return { uspeh: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { uspeh: false, napaka: msg };
  }
}
