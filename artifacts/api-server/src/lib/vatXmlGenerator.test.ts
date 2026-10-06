import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
const state=vi.hoisted(()=>({rows:[] as Record<string,unknown>[]}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>({rows:state.rows})}}));
import { generateKirKprXml } from "./vatXmlGenerator";
import { buildKirKprZip } from "./vatZip";

describe("KIR/KPR XML in ZIP, official schema",()=>{
  it("packages actual generated KIR + KPR without changing archived data, dates or deductible VAT",async()=>{
    const row={id:"1",journalEntryId:"doc1",direction:"OUT",documentNo:"IR <1> & test",postingDate:"2026-09-17",invoiceDate:"2026-09-16",
      receiptDate:null,partnerName:"Prejemnik & sin",partnerCountryCode:"SI",partnerVatId:"87654321",
      baseAmount:"100.00",vatAmount:"22.00",nonDeductibleVat:"0",deductionPercent:"100",kirBaseField:"P7",kirVatField:"P14",
      kprBaseField:null,kprVatField:null,isReverseCharge:false,pairId:null,reversedById:null,remarks:null,treatment:1,
      correctionPeriod:null,correctionAmount:null,vatCodeCode:"S22",assetType:"NONE"};
    state.rows=[row,{...row,id:"2",journalEntryId:"doc2",direction:"IN",receiptDate:"2026-09-17",documentNo:"PR-2",
      kirBaseField:null,kirVatField:null,kprBaseField:"P8",kprVatField:"P18",vatAmount:"11.00",nonDeductibleVat:"11.00",deductionPercent:"50",vatCodeCode:"P22"}];
    const result=await generateKirKprXml("company","12345678",2026,"0709","2026-09-01","2026-09-30",{vracilo:false});
    expect(result.kirCount).toBe(1);expect(result.kprCount).toBe(1);
    expect(result.xml).toContain("<P18>11.00</P18>");expect(result.xml).toContain("<P17>11.00</P17>");
    expect(result.xml).toContain("IR &lt;1&gt; &amp; test");
    const archive=await JSZip.loadAsync(await buildKirKprZip(result.xml,"KIR_KPR_2026_0709_BOTH.xml"));
    const xml=await archive.file("KIR_KPR_2026_0709_BOTH.xml")!.async("string");
    expect(xml).toBe(result.xml);
    const dir=mkdtempSync(join(tmpdir(),"bookie-kirkpr-"));
    try {
      const file=join(dir,"kirkpr.xml");writeFileSync(file,xml);
      const schema=resolve(import.meta.dirname,"edavki/schema");
      const check=spawnSync("java",[join(schema,"ValidateEdavkiXsd.java"),join(schema,"DDV_KIR_KPR_1.xsd"),file],{encoding:"utf8"});
      expect(check.stderr).toBe("");expect(check.status).toBe(0);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
});
