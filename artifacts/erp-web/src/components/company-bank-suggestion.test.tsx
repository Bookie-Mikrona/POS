import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompanyBankSuggestion } from "./company-bank-suggestion";

vi.mock("@workspace/api-client-react", () => ({
  useGetCompany: () => ({ data: { trr: [{ iban: "SI56191000000123438", bic: "HDELSI22" }] } }),
}));

describe("company bank suggestions", () => {
  it("proposes company IBAN and BIC for an empty main analytical TRR", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(<CompanyBankSuggestion companyId="TEST" accountCode="1100000"
      hasSavedMetadata={false} draftEmpty onSelect={onSelect} />);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("SI56191000000123438", "HDELSI22"));
    expect(getByText("Predlog TRR iz podatkov podjetja")).toBeTruthy();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["existing bank metadata", "1100000", true, true],
    ["typed unsaved values", "1100000", false, false],
    ["another bank account", "1101000", false, true],
  ])("does not overwrite %s", (_label, accountCode, hasSavedMetadata, draftEmpty) => {
    const onSelect = vi.fn();
    render(<CompanyBankSuggestion companyId="TEST" accountCode={accountCode}
      hasSavedMetadata={hasSavedMetadata} draftEmpty={draftEmpty} onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
