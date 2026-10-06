/** Company identity affects message headers, never SMTP authentication or MAIL FROM. */
export interface CompanyEmailSender {
  companyName?: string | null;
  companyEmail?: string | null;
}

function mailbox(value: string): { address: string; name: string } {
  if (/[\r\n\0]/.test(value)) throw new Error("Neveljaven e-poštni naslov pošiljatelja.");
  const match = value.trim().match(/^(?:([^<>]*)<([^<>]+)>|([^<>]+))$/);
  const address = (match?.[2] ?? match?.[3] ?? "").trim();
  // Exactly one mailbox. Reject lists, malformed domains and header injection.
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(address))
    throw new Error("Neveljaven e-poštni naslov pošiljatelja.");
  return { address, name: (match?.[1] ?? "").trim().replace(/^"(.*)"$/, "$1") };
}

export function buildEmailSender(
  smtpFrom: string,
  recipient: string,
  fallbackName: string,
  sender?: CompanyEmailSender,
  suppressReplyTo = false,
) {
  const smtp = mailbox(smtpFrom);
  const name = sender?.companyName?.trim() || fallbackName.trim() || smtp.name;
  if (/[\r\n\0]/.test(name)) throw new Error("Neveljaven naziv pošiljatelja.");
  const company = sender?.companyEmail?.trim() ? mailbox(sender.companyEmail) : undefined;
  const sameDomain = company?.address.split("@")[1]!.toLowerCase() === smtp.address.split("@")[1]!.toLowerCase();
  return {
    from: { name, address: sameDomain ? company!.address : smtp.address },
    // Nodemailer otherwise derives MAIL FROM from the visible From header.
    envelope: { from: smtp.address, to: recipient },
    ...(company && !sameDomain && !suppressReplyTo
      ? { replyTo: { name, address: company.address } }
      : {}),
  };
}
