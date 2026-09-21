import { describe, expect, it } from "vitest";
import { parseCamt053 } from "./bankStatements";

describe("parseCamt053", () => {
  it("prebere vhodne in izhodne transakcije z bančnimi podatki", () => {
    const result = parseCamt053(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt><Acct><Ccy>EUR</Ccy></Acct>
    <Ntry><Amt Ccy="EUR">119.18</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-11</Dt></BookgDt><AcctSvcrRef>OUT-1</AcctSvcrRef>
      <NtryDtls><TxDtls><Refs><EndToEndId>BOOKIE-123</EndToEndId></Refs><RltdPties><Cdtr><Nm>Julius Meinl d.o.o.</Nm></Cdtr><CdtrAcct><Id><IBAN>SI56 0400 0027 9548 024</IBAN></Id></CdtrAcct></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>SI00 1003532025028</Ref></CdtrRefInf></Strd></RmtInf><AddtlTxInf>Plačilo računa</AddtlTxInf></TxDtls></NtryDtls>
    </Ntry>
    <Ntry><Amt Ccy="EUR">42.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-09-10</Dt></ValDt>
      <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kupec d.o.o.</Nm></Dbtr><DbtrAcct><Id><IBAN>SI56191000000001234</IBAN></Id></DbtrAcct></RltdPties><RmtInf><Ustrd>Račun 25-10</Ustrd></RmtInf></TxDtls></NtryDtls>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`);

    expect(result.skippedRows).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-09-11",
      amount: -119.18,
      reference: "SI00 1003532025028",
      counterpartyName: "Julius Meinl d.o.o.",
      counterpartyIban: "SI56040000279548024",
      currency: "EUR",
    });
    expect(result.transactions[1]).toMatchObject({
      date: "2026-09-10",
      amount: 42,
      counterpartyName: "Kupec d.o.o.",
      reference: "Račun 25-10",
    });
  });

  it("prebere identiteto, obdobje in stanji iz glave izpiska", () => {
    const result = parseCamt053(`<Document><BkToCstmrStmt><Stmt>
      <Id>2026-0098</Id><CreDtTm>2026-09-11T18:00:00</CreDtTm>
      <FrToDt><FrDtTm>2026-09-10T00:00:00</FrDtTm><ToDtTm>2026-09-11T23:59:59</ToDtTm></FrToDt>
      <Acct><Id><IBAN>SI56 0201 0001 2345 678</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">75.50</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
      <Ntry><Amt Ccy="EUR">24.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-11</Dt></BookgDt></Ntry>
    </Stmt></BkToCstmrStmt></Document>`);

    expect(result.metadata).toEqual({
      statementNumber: "2026-0098",
      statementDate: "2026-09-11",
      periodFrom: "2026-09-10",
      periodTo: "2026-09-11",
      sourceIban: "SI56020100012345678",
      openingBalance: 100,
      closingBalance: 75.5,
      currency: "EUR",
    });
  });

  it("ne podvoji zbirnega zneska, če podtransakcije nimajo svojih zneskov", () => {
    const result = parseCamt053(`<Document><BkToCstmrStmt><Stmt><Ntry>
      <Amt Ccy="EUR">30.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-11</Dt></BookgDt>
      <NtryDtls><TxDtls><RmtInf><Ustrd>A</Ustrd></RmtInf></TxDtls><TxDtls><RmtInf><Ustrd>B</Ustrd></RmtInf></TxDtls></NtryDtls>
    </Ntry></Stmt></BkToCstmrStmt></Document>`);

    expect(result.transactions).toEqual([]);
    expect(result.skippedRows[0]?.reason).toContain("brez posameznih zneskov");
  });

  it("razdeli zbirno knjižbo, ko ima vsaka podtransakcija svoj znesek", () => {
    const result = parseCamt053(`<Document><BkToCstmrStmt><Stmt><Acct><Ccy>EUR</Ccy></Acct><Ntry>
      <Amt Ccy="EUR">30.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-11</Dt></BookgDt>
      <NtryDtls>
        <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">10.00</Amt></TxAmt></AmtDtls><RmtInf><Ustrd>A</Ustrd></RmtInf></TxDtls>
        <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">20.00</Amt></TxAmt></AmtDtls><RmtInf><Ustrd>B</Ustrd></RmtInf></TxDtls>
      </NtryDtls>
    </Ntry></Stmt></BkToCstmrStmt></Document>`);

    expect(result.skippedRows).toEqual([]);
    expect(result.transactions.map((tx) => tx.amount)).toEqual([-10, -20]);
  });
});