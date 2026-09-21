import { describe, expect, it } from "vitest";
import { razcleniXml } from "./parser-eslog";

describe("e-SLOG payment instructions", () => {
  it("reads payment instructions from UBL", () => {
    const dto = razcleniXml(`<Invoice>
      <ID>INV-1</ID><IssueDate>2026-09-11</IssueDate><DueDate>2026-10-11</DueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode>
      <AccountingSupplierParty><Party><PartyName><Name>Dobavitelj</Name></PartyName></Party></AccountingSupplierParty>
      <PaymentMeans>
        <PaymentID>SI00 12345-67890</PaymentID>
        <InstructionNote>Plačilo materiala</InstructionNote>
        <PayeeFinancialAccount><ID>SI56 0400 0027 9548 024</ID><FinancialInstitutionBranch><ID>OTPVSI2X</ID></FinancialInstitutionBranch></PayeeFinancialAccount>
      </PaymentMeans>
    </Invoice>`);

    expect(dto).toMatchObject({
      dobaviteljIban: "SI56 0400 0027 9548 024",
      dobaviteljBic: "OTPVSI2X",
      placilniModel: "SI00",
      placilniSklic: "12345-67890",
      placilniNamen: "Plačilo materiala",
      datumZapadlosti: "2026-10-11",
    });
  });

  it("reads payment instructions from CII", () => {
    const dto = razcleniXml(`<CrossIndustryInvoice>
      <ExchangedDocument><ID>INV-2</ID><IssueDateTime><DateTimeString format="102">20260911</DateTimeString></IssueDateTime></ExchangedDocument>
      <SupplyChainTradeTransaction>
        <ApplicableHeaderTradeAgreement><SellerTradeParty><Name>Dobavitelj</Name></SellerTradeParty></ApplicableHeaderTradeAgreement>
        <ApplicableHeaderTradeSettlement>
          <PaymentReference>SI12 987654</PaymentReference>
          <SpecifiedTradeSettlementPaymentMeans>
            <PayeePartyCreditorFinancialAccount><IBANID>SI56040000279548024</IBANID></PayeePartyCreditorFinancialAccount>
            <PayeeSpecifiedCreditorFinancialInstitution><BICID>OTPVSI2X</BICID></PayeeSpecifiedCreditorFinancialInstitution>
          </SpecifiedTradeSettlementPaymentMeans>
          <SpecifiedTradePaymentTerms><Description>Plačilo storitve</Description><DueDateDateTime><DateTimeString format="102">20261015</DateTimeString></DueDateDateTime></SpecifiedTradePaymentTerms>
        </ApplicableHeaderTradeSettlement>
      </SupplyChainTradeTransaction>
    </CrossIndustryInvoice>`);

    expect(dto).toMatchObject({
      dobaviteljIban: "SI56040000279548024",
      dobaviteljBic: "OTPVSI2X",
      placilniModel: "SI12",
      placilniSklic: "987654",
      placilniNamen: "Plačilo storitve",
      datumZapadlosti: "2026-10-15",
    });
  });
});