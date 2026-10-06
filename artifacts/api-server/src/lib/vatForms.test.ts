import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { buildVatFormPreview, EDAVKI_SCHEMAS, generateVatFormXml, vatFormBounds, type VatForm, type VatFormSource, type VatFormOptions } from "./vatForms";
import { buildKirKprZip } from "./vatZip";

export const company = {id:"a7a1ab21-9a6a-46dd-9959-000000000001",naziv:"Test & družba <XML>",podjetjeDavcna:"12345678",idZaDdv:"SI12345678"};
export const options = (form: VatForm = "DDV-O"): VatFormOptions => ({form,year:2026,period:"0709",periodMode:"mesecno"});
export const row = (changes: Partial<VatFormSource> = {}): VatFormSource => ({
  id:"row",direction:"OUT",codeDirection:"OUT",documentNo:"TEST-1",baseAmount:"100.00",vatAmount:"22.00",nonDeductibleVat:"0.00",deductionPercent:"100",
  kirBaseField:"P7",kirVatField:"P14",kprBaseField:null,kprVatField:null,code:"S22",triggersRpO:false,triggersPdO:false,rpOColumn:null,
  partnerCountryCode:"SI",partnerVatId:"SI87654321",partnerName:"Prejemnik",receiptDate:null,assetType:"NONE",treatment:1,
  correctionPeriod:null,reversedById:null,sourceStatus:"posted",...changes,
});
function validate(xml: string, schema: string) {
  const dir = mkdtempSync(join(tmpdir(),"bookie-edavki-"));
  try {
    const file=join(dir,"test.xml"); writeFileSync(file,xml);
    const path=resolve(import.meta.dirname,"edavki/schema");
    const result=spawnSync("java",[join(path,"ValidateEdavkiXsd.java"),join(path,`${schema}.xsd`),file],{encoding:"utf8"});
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
const value = (p: ReturnType<typeof buildVatFormPreview>, code: string) => p.fields.find(f=>f.code===code)?.value;
describe("statutory VAT forms", () => {
  it("keeps monthly March distinct from Q1 and handles leap February",()=>{
    expect(vatFormBounds({...options(),period:"0703"}).from).toBe("2026-03-01");
    expect(vatFormBounds({...options(),period:"0703",periodMode:"trimesecno"}).from).toBe("2026-01-01");
    expect(vatFormBounds({...options(),year:2024,period:"0702"}).to).toBe("2024-02-29");
    expect(()=>vatFormBounds({...options(),period:"0702",periodMode:"trimesecno"})).toThrow();
  });
  it.each(["RP-O","PD-O"] as const)("requires monthly %s",form=>{
    expect(()=>vatFormBounds({...options(form),periodMode:"trimesecno"})).toThrow("koledarski mesec");
  });
  it.each(["0009","0700","0713","0709x","09"])("rejects malformed period %s",period=>{
    expect(()=>vatFormBounds({...options(),period})).toThrow();
  });
  it("aggregates decimal cents BEFORE whole-EUR rounding and derives liability from rounded fields",()=>{
    const p=buildVatFormPreview(company,options(),[row({id:"1",baseAmount:"0.30",vatAmount:"0.30"}),row({id:"2",baseAmount:"0.30",vatAmount:"0.30"})]);
    expect(value(p,"f11")).toBe("1"); expect(value(p,"f21")).toBe("1"); expect(value(p,"f51")).toBe("1");
    expect(value(p,"f52")).toBe("0");
  });
  it("does not apply deduction percentage twice",()=>{
    const p=buildVatFormPreview(company,options(),[row({direction:"IN",codeDirection:"IN",code:"P22",receiptDate:"2026-09-15",
      kirBaseField:null,kirVatField:null,kprBaseField:"P8",kprVatField:"P18",vatAmount:"11",nonDeductibleVat:"11",deductionPercent:"50"})]);
    expect(value(p,"f41")).toBe("11"); expect(value(p,"f52")).toBe("11"); expect(p.canExport).toBe(true);
  });
  it("exports all missing DVO fields including domestic 76a, EU services, triangular, assets and flat compensation",()=>{
    const rows=[
      row({id:"pd",code:"S76A",kirBaseField:"P8",kirVatField:null,vatAmount:"0"}),
      row({id:"svc",code:"SEU-S",kirBaseField:"P27",kirVatField:null,triggersRpO:true,vatAmount:"0"}),
      row({id:"tri",code:"SEU-TR",kirBaseField:"P11",kirVatField:null,triggersRpO:true,vatAmount:"0"}),
      ...(["P20","P21","P22","P25"] as const).map((f,i)=>row({id:f,codeDirection:"IN",code:"EUS5",kirBaseField:null,kirVatField:f,baseAmount:"0",vatAmount:String(i+1)})),
      row({id:"asset",direction:"IN",codeDirection:"IN",code:"PAV8",kirBaseField:null,kirVatField:null,kprBaseField:"P8",kprVatField:"P21",
        receiptDate:"2026-09-15",vatAmount:"8",assetType:"OTHER_FA"}),
    ];
    const p=buildVatFormPreview(company,options(),rows);
    expect(value(p,"f11a")).toBe("100");expect(value(p,"f12")).toBe("200");
    expect(value(p,"f24a")).toBe("1");expect(value(p,"f24b")).toBe("2");expect(value(p,"f24c")).toBe("3");
    expect(value(p,"f25b")).toBe("4");expect(value(p,"f43")).toBe("8");expect(value(p,"f35")).toBe("100");
    expect(p.canExport).toBe(true);
  });
  it("keeps goods A3, triangular A5, and services A6; never RP-O purchases",()=>{
    const p=buildVatFormPreview(company,options("RP-O"),[
      row({id:"g",code:"SEU-B",kirBaseField:"P10",triggersRpO:true,rpOColumn:"A3",partnerCountryCode:"AT",partnerVatId:"ATU12345678"}),
      row({id:"t",code:"SEU-TR",kirBaseField:"P11",triggersRpO:true,rpOColumn:"A3",partnerCountryCode:"AT",partnerVatId:"U12345678"}),
      row({id:"s",code:"SEU-S",kirBaseField:"P27",triggersRpO:true,rpOColumn:"B3",partnerCountryCode:"AT",partnerVatId:"ATU12345678"}),
      row({id:"in",code:"EUB22",codeDirection:"IN",direction:"IN",triggersRpO:true}),
      row({id:"mirror",code:"EUB22",codeDirection:"IN",direction:"OUT",triggersRpO:true}),
    ]);
    expect(p.canExport).toBe(true);expect(p.partners).toHaveLength(1);expect(p.partners[0].values).toEqual({A3:"100",A5:"100",A6:"100"});
  });
  it("only PD-O supplier-side domestic 76a",()=>{
    const p=buildVatFormPreview(company,options("PD-O"),[
      row({id:"pd",code:"S76A",kirBaseField:"P8",kirVatField:null}),
      row({id:"rc",code:"RC76A-22",direction:"IN",codeDirection:"IN",triggersPdO:true,kirBaseField:"P8"}),
      row({id:"mirror",code:"RC76A-22",codeDirection:"IN",triggersPdO:true,kirBaseField:"P8"}),
      row({id:"ordinary"}),
    ]);
    expect(p.partners).toHaveLength(1);expect(p.partners[0].values.A3).toBe("100");
  });
  it("normalizes prefixed IDs without a country and rejects contradictory country/ID",()=>{
    expect(buildVatFormPreview(company,options("PD-O"),[row({code:"S76A",kirBaseField:"P8",partnerCountryCode:null,partnerVatId:"SI87654321"})]).partners[0].vatId).toBe("87654321");
    const supply=row({code:"SEU-B",kirBaseField:"P10",triggersRpO:true,partnerCountryCode:null,partnerVatId:"ATU12345678"});
    expect(buildVatFormPreview(company,options("RP-O"),[supply]).partners[0].countryCode).toBe("AT");
    expect(buildVatFormPreview(company,options("RP-O"),[{...supply,partnerCountryCode:"DE"}]).canExport).toBe(false);
  });
  it.each([
    {code:null}, {sourceStatus:"draft"}, {treatment:2,correctionPeriod:"202607"},
    {baseAmount:"NaN"}, {reversedById:"storno"}, {kirBaseField:"P99"}, {isReverseCharge:true,pairValid:false}, {isImport:true,pairValid:false},
  ])("blocks bad ledger input %j",changes=>{
    expect(buildVatFormPreview(company,options(),[row(changes)]).canExport).toBe(false);
  });
  it("blocks missing KPR receipt date, invalid partner IDs, XI services and call-off stock",()=>{
    expect(buildVatFormPreview(company,options(),[row({direction:"IN",codeDirection:"IN",kprBaseField:"P8",receiptDate:null})]).canExport).toBe(false);
    for (const changes of [{partnerVatId:null},{partnerCountryCode:"GB"},{partnerCountryCode:"XI",code:"SEU-S",kirBaseField:"P27"},
      {code:"CALL-OFF",rpOColumn:"A7"}]) {
      expect(buildVatFormPreview(company,options("RP-O"),[row({triggersRpO:true,partnerCountryCode:"AT",partnerVatId:"ATU12345678",...changes})]).canExport).toBe(false);
    }
  });
  it("blocks quarterly DVO when RP-O supplies exist and mismatched taxpayer identification",()=>{
    expect(buildVatFormPreview(company,{...options(),periodMode:"trimesecno"},[row({code:"SEU-B",kirBaseField:"P10",triggersRpO:true})]).canExport).toBe(false);
    expect(buildVatFormPreview({...company,idZaDdv:"SI99999999"},options(),[]).canExport).toBe(false);
  });
  it("binds confirmation to source cents, company and canonical ordering",()=>{
    const a=row({id:"a"}),b=row({id:"b"});
    const hash=buildVatFormPreview(company,options(),[a,b]).snapshotHash;
    expect(buildVatFormPreview(company,options(),[b,a]).snapshotHash).toBe(hash);
    expect(buildVatFormPreview(company,options(),[a,{...b,baseAmount:"100.01"}]).snapshotHash).not.toBe(hash);
    expect(buildVatFormPreview({...company,naziv:"Other"},options(),[a,b]).snapshotHash).not.toBe(hash);
  });
  it.each(["DDV-O","RP-O","PD-O"] as const)("validates nonempty %s XML with OFFICIAL XSD including contacts and corrections",form=>{
    const source=form==="DDV-O"?row():form==="PD-O"?row({code:"S76A",kirBaseField:"P8",kirVatField:null}):
      row({code:"SEU-S",kirBaseField:"P27",triggersRpO:true,rpOColumn:"B3",partnerCountryCode:"AT",partnerVatId:"ATU12345678"});
    const preview=buildVatFormPreview(company,options(form),[source]);
    const xml=generateVatFormXml(company,preview,{contactName:"Ana & <test>",contactPhone:"+386",refund:true,deductionProportion:true,
      corrections:form==="DDV-O"?[]:[{year:2026,month:8,countryCode:form==="PD-O"?"SI":"AT",vatId:form==="PD-O"?"87654321":"U12345678",values:{B3:form==="PD-O"?"-50":"50"}}]});
    expect(xml).toContain("Ana &amp; &lt;test&gt;");validate(xml,EDAVKI_SCHEMAS[form]);
  });
  it.each(["DDV-O","RP-O","PD-O"] as const)("validates empty %s XML",form=>{
    validate(generateVatFormXml(company,buildVatFormPreview(company,options(form),[])),EDAVKI_SCHEMAS[form]);
  });
  it("rejects future, duplicate and delta/noninteger corrections plus XML control characters",()=>{
    const p=buildVatFormPreview(company,options("PD-O"),[]);
    const c={year:2026,month:8,countryCode:"SI",vatId:"87654321",values:{B3:"0"}};
    expect(()=>generateVatFormXml(company,p,{corrections:[{...c,month:9}]})).toThrow("pretekli");
    expect(()=>generateVatFormXml(company,p,{corrections:[c,c]})).toThrow("Podvojen");
    expect(()=>generateVatFormXml(company,p,{corrections:[{...c,values:{B3:"0.50"}}]})).toThrow("celih EUR");
    expect(()=>generateVatFormXml(company,p,{corrections:[{...c,values:{B6:"0"}}]})).toThrow("Nepodprto");
    expect(()=>generateVatFormXml(company,p,{contactName:"invalid\u0001"})).toThrow("XML");
    expect(()=>generateVatFormXml({...company,id:"other"},p)).toThrow("drugemu podjetju");
  });
  it("rejects negative net RP-O values but allows a credit reducing a positive current total",()=>{
    const supply=row({code:"SEU-B",kirBaseField:"P10",triggersRpO:true,partnerCountryCode:"AT",partnerVatId:"ATU12345678"});
    const negative=buildVatFormPreview(company,options("RP-O"),[{...supply,baseAmount:"-100"}]);
    expect(negative.canExport).toBe(false);
    const net=buildVatFormPreview(company,options("RP-O"),[supply,{...supply,id:"credit",baseAmount:"-50"}]);
    expect(net.canExport).toBe(true);expect(net.partners[0].values.A3).toBe("50");
    expect(()=>generateVatFormXml(company,net,{corrections:[{year:2026,month:8,countryCode:"AT",vatId:"U12345678",values:{B3:"-50"}}]})).toThrow("negativne");
  });
  it("respects the separate 17-digit PD-O limits for current, correction and total amounts",()=>{
    const source=row({code:"S76A",kirBaseField:"P8",baseAmount:"-99999999999999999"});
    const p=buildVatFormPreview(company,options("PD-O"),[source]);
    expect(p.canExport).toBe(true);
    validate(generateVatFormXml(company,p,{corrections:[{year:2026,month:8,countryCode:"SI",vatId:"87654321",
      values:{B3:"-99999999999999999"}}]}),EDAVKI_SCHEMAS["PD-O"]);
    expect(buildVatFormPreview(company,options("PD-O"),[source,{...source,id:"2",partnerVatId:"SI12345679"}]).canExport).toBe(false);
  });
  it("packages one identical archived XML in a deterministic ZIP with safe filename",async()=>{
    const xml='<?xml version="1.0"?><DDV_KIR_KPR xmlns="http://edavki.durs.si/Documents/Schemas/DDV_KIR_KPR_1.xsd"/>';
    // Normal generator always emits a non-self-closing root.
    const document=xml.replace('/>','></DDV_KIR_KPR>');
    const name="KIR_KPR_2026_0709_BOTH.xml";
    const zip=await buildKirKprZip(document,name),again=await buildKirKprZip(document,name);
    expect(zip.equals(again)).toBe(true);
    const archive=await JSZip.loadAsync(zip);expect(Object.keys(archive.files)).toEqual([name]);
    expect(await archive.file(name)!.async("string")).toBe(document);
    await expect(buildKirKprZip(document,"../../bad.xml")).rejects.toThrow();
  });
});
