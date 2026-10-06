import JSZip from "jszip";

/** The eDavki KIR/KPR importer accepts a ZIP containing the XML evidence, not a bare XML upload. */
export async function buildKirKprZip(xml: string, filename: string): Promise<Buffer> {
  if (!/^KIR_KPR_\d{4}_07(0[1-9]|1[0-2])_(KIR|KPR|BOTH)\.xml$/.test(filename))
    throw new Error("Neveljavno ime KIR/KPR datoteke.");
  if (!xml.includes('<DDV_KIR_KPR xmlns="http://edavki.durs.si/Documents/Schemas/DDV_KIR_KPR_1.xsd">'))
    throw new Error("Arhiv ne vsebuje KIR/KPR XML pričakovane sheme.");
  const zip = new JSZip();
  // Fixed metadata makes re-downloading an archived XML produce the same ZIP bytes.
  zip.file(filename, xml, { date: new Date("1980-01-01T00:00:00Z") });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
