import { ObjectStorageService } from "./objectStorage";

const storage = new ObjectStorageService();

export interface VatXmlArchive {
  id: string;
  companyId: string;
  periodYear: number;
  period: string;
  xmlInline: string;
}

/** Both initial archiving and recovery must use the same immutable identity. */
export function saveVatXmlArchive(submission: VatXmlArchive): Promise<string> {
  return storage.savePrivateObject(
    `vat-xml/${submission.companyId}/${submission.periodYear}-${submission.period}/${submission.id}.xml`,
    Buffer.from(submission.xmlInline, "utf8"),
    "application/xml",
  );
}
