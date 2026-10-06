import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  role: "accountant" as string | null,
  companyId:"a7a1ab21-9a6a-46dd-9959-000000000001",
  ledger: [] as Record<string,unknown>[], missing: [] as Record<string,unknown>[],
  queries: [] as string[], audit: vi.fn(),
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth:(req:any,_res:any,next:any)=>{req.clerkUserId="vat-form-test-user";next();},
}));
vi.mock("@workspace/db",async importOriginal=>{
  const original = await importOriginal<any>();
  const dialect=new PgDialect();
  const fake={
    select:(fields:any)=>{
      let eligible=true;
      const chain:any={from:()=>chain,where:(condition:any)=>{
        const params=dialect.sqlToQuery(condition).params;
        eligible=params.includes(state.companyId);return chain;
      },limit:async()=>!eligible?[]:Object.hasOwn(fields,"role")?(state.role?[{role:state.role}]:[]):
        [{id:state.companyId,naziv:"Test družba",podjetjeDavcna:"12345678",idZaDdv:"SI12345678"}]};
      return chain;
    },
    execute:async(query:any)=>{
      const sql=dialect.sqlToQuery(query).sql;state.queries.push(sql);
      return {rows:sql.includes('SELECT vl.id, vl.direction')?state.ledger:state.missing};
    },
    transaction:async(callback:any)=>callback(fake),
    insert:()=>({values:state.audit}),
  };
  return {...original,db:fake};
});
import router from "./vatForms";
const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.log={error:vi.fn()};next();});app.use("/api",router);
const params={form:"DDV-O",year:2026,period:"0709",periodMode:"mesecno"};
const base=()=>`/api/companies/${state.companyId}`;
async function preview() { return request(app).get(base()+"/vat-form-preview").query(params); }
beforeEach(()=>{state.role="accountant";state.ledger=[];state.missing=[];state.queries=[];state.audit.mockReset();state.audit.mockResolvedValue(undefined);});
describe("VAT statutory API security and confirmation",()=>{
  it("returns canonical period and preview with no audit write",async()=>{
    const res=await preview();expect(res.status).toBe(200);expect(res.body.periodFrom).toBe("2026-09-01");
    expect(res.headers["cache-control"]).toBe("no-store");expect(res.body.fields.find((f:any)=>f.code==="f11").value).toBe("0");
    expect(state.audit).not.toHaveBeenCalled();
    const query=state.queries[0];
    for(const relation of ["je","iv","dc"]) expect(query).toContain(`(${relation}.company_id IS NULL OR ${relation}.company_id =`);
    expect(state.queries[1]).toContain("HAVING COUNT(*)");
  });
  it("blocks another tenant before reading its fiscal source",async()=>{
    const res=await request(app).get("/api/companies/a7a1ab21-9a6a-46dd-9959-000000000002/vat-form-preview").query(params);
    expect(res.status).toBe(403);expect(state.queries).toHaveLength(0);
  });
  it("allows viewer preview but denies export",async()=>{
    state.role="viewer";const p=await preview();expect(p.status).toBe(200);
    const res=await request(app).post(base()+"/vat-form-export").send({...params,previewHash:p.body.snapshotHash,confirmed:true});
    expect(res.status).toBe(403);expect(state.audit).not.toHaveBeenCalled();
  });
  it.each([["period","0009"],["year",2019],["periodMode","automatic"]])("rejects invalid %s",async(key,value)=>{
    expect((await request(app).get(base()+"/vat-form-preview").query({...params,[key]:value})).status).toBe(400);
  });
  it("blocks monthly-report quarter and missing explicit confirmation",async()=>{
    const rp=await request(app).get(base()+"/vat-form-preview").query({...params,form:"RP-O",periodMode:"trimesecno"});
    expect(rp.status).toBe(400);
    const p=await preview();
    expect((await request(app).post(base()+"/vat-form-export").send({...params,previewHash:p.body.snapshotHash})).status).toBe(400);
  });
  it("rejects stale confirmation without generating an archive",async()=>{
    expect((await request(app).post(base()+"/vat-form-export").send({...params,previewHash:"0".repeat(64),confirmed:true})).status).toBe(409);
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("does not export a misleading zero return when the ledger is incomplete",async()=>{
    state.missing=[{documentNo:"JE-MISSING",reason:"Manjka davčna sled."}];
    const p=await preview();expect(p.body.canExport).toBe(false);
    const res=await request(app).post(base()+"/vat-form-export").send({...params,previewHash:p.body.snapshotHash,confirmed:true});
    expect(res.status).toBe(400);expect(state.audit).not.toHaveBeenCalled();
  });
  it("archives exact confirmed XML and sha256 without financial posting",async()=>{
    const p=await preview();
    const res=await request(app).post(base()+"/vat-form-export").send({...params,previewHash:p.body.snapshotHash,confirmed:true});
    expect(res.status).toBe(200);expect(res.body.filename).toBe("DDV_O_2026_0709.xml");expect(res.body.sha256).toHaveLength(64);
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({companyId:state.companyId,entityType:"vat_form_export",
      payload:expect.objectContaining({xml:res.body.xml,sha256:res.body.sha256,previewHash:p.body.snapshotHash})}));
  });
  it("fails explicitly when the export cannot be archived",async()=>{
    const p=await preview();state.audit.mockRejectedValueOnce(new Error("db unavailable"));
    const res=await request(app).post(base()+"/vat-form-export").send({...params,previewHash:p.body.snapshotHash,confirmed:true});
    expect(res.status).toBe(500);expect(res.body.xml).toBeUndefined();
  });
});
