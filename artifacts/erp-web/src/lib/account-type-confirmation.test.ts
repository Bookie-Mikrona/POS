import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAccountTypeException } from "./account-type-confirmation";

afterEach(() => vi.restoreAllMocks());
describe("code/type exception confirmation", () => {
  const warning = { status: 422, data: { warnings: [{ message: "Konto 400: pričakovan tip Odhodek" }] } };
  it("shows the warning and allows explicitly confirming the exception", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(confirmAccountTypeException(warning)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Konto 400"));
  });
  it("leaves cancellation unconfirmed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(confirmAccountTypeException(warning)).toBe(false);
  });
  it("does not turn ordinary errors into bypassable warnings", () => {
    const confirm = vi.spyOn(window, "confirm");
    expect(confirmAccountTypeException({ status: 403 })).toBe(false);
    expect(confirmAccountTypeException(null)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
