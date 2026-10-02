export interface SepaTransactionInstruction {
  paymentId: string;
  amount: string;
  executionDate: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  purpose?: string | null;
  reference?: string | null;
  model?: string | null;
}

export interface SepaBatchInstruction {
  messageId: string;
  companyName: string;
  debtorIban: string;
  debtorBic?: string | null;
  profile: string;
  transactions: SepaTransactionInstruction[];
}

const escapeXml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const agent = (bic?: string | null) => {
  const normalized = String(bic ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(normalized)
    ? `<FinInstnId><BIC>${escapeXml(normalized)}</BIC></FinInstnId>`
    : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>";
};

function remittance(tx: SepaTransactionInstruction): string {
  const ref = String(tx.reference ?? "").trim();
  const normalizedReference = ref.replace(/\s+/g, "").toUpperCase();
  if (isValidRfReference(normalizedReference)) {
    return `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${escapeXml(normalizedReference)}</Ref></CdtrRefInf>${tx.purpose ? `<AddtlRmtInf>${escapeXml(tx.purpose.slice(0, 140))}</AddtlRmtInf>` : ""}</Strd>`;
  }
  const model = String(tx.model ?? "").trim();
  const siReference = model ? `${model} ${ref}`.trim() : ref;
  const text = ([siReference, tx.purpose].filter(Boolean).join(" — ") || `Plačilo ${tx.paymentId}`).slice(0, 140);
  return `<Ustrd>${escapeXml(text)}</Ustrd>`;
}

function isValidRfReference(value: string): boolean {
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(value)) return false;
  let remainder = 0;
  for (const char of value.slice(4) + value.slice(0, 4)) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** One-file pain.001 serialization; the first exported XML is persisted by the batch route. */
export function buildSepaBatchXml(input: SepaBatchInstruction): string {
  if (input.profile !== "pain.001.001.03") throw new Error(`Nepodprt SEPA profil: ${input.profile}`);
  if (!input.transactions.length) throw new Error("Paket nima plačilnih nalogov");
  const txs = input.transactions;
  const sum = txs.reduce((total, tx) => total + Math.round(Number(tx.amount) * 100), 0);
  const sumText = (sum / 100).toFixed(2);
  const transactionXml = txs.map(tx => {
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Znesek plačilnega naloga ni veljaven");
    return `<CdtTrfTxInf><PmtId><EndToEndId>${escapeXml(`BOOKIE-${tx.paymentId.replaceAll("-", "").slice(0, 28)}`)}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amount.toFixed(2)}</InstdAmt></Amt><CdtrAgt>${agent(tx.creditorBic)}</CdtrAgt><Cdtr><Nm>${escapeXml(tx.creditorName)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${escapeXml(tx.creditorIban)}</IBAN></Id></CdtrAcct><RmtInf>${remittance(tx)}</RmtInf></CdtTrfTxInf>`;
  }).join("");
  const date = txs[0]!.executionDate;
  if (txs.some(tx => tx.executionDate !== date)) throw new Error("Paket vsebuje nezdružljive datume izvedbe");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>${escapeXml(input.messageId)}</MsgId><CreDtTm>${new Date().toISOString()}</CreDtTm><NbOfTxs>${txs.length}</NbOfTxs><CtrlSum>${sumText}</CtrlSum><InitgPty><Nm>${escapeXml(input.companyName)}</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>${escapeXml(input.messageId)}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${txs.length}</NbOfTxs><CtrlSum>${sumText}</CtrlSum><PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${escapeXml(date)}</ReqdExctnDt><Dbtr><Nm>${escapeXml(input.companyName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${escapeXml(input.debtorIban)}</IBAN></Id></DbtrAcct><DbtrAgt>${agent(input.debtorBic)}</DbtrAgt><ChrgBr>SLEV</ChrgBr>${transactionXml}</PmtInf></CstmrCdtTrfInitn></Document>`;
}