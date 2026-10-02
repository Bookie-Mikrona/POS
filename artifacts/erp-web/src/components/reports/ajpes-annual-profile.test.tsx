// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { AjpesAnnualReport, AjpesAnnualSettings } from "@workspace/api-client-react";
import { ProfileEditor } from "./ajpes-annual-profile-editor";
import { changeProfile, confirmProfile, defaultProfile } from "./ajpes-annual-profile-model";
import { cleanSettings, emptyAjpesSettings, invalidInputs } from "./ajpes-annual-report-model";

afterEach(cleanup);
const report = { year: 2025 } as AjpesAnnualReport;
let last: AjpesAnnualSettings = emptyAjpesSettings;
function Harness({ init }: { init: AjpesAnnualSettings }) {
  const [d, setD] = useState(init);
  const [dirty, setDirty] = useState(false);
  last = d;
  return <ProfileEditor report={report} draft={d} viewer={false} dirty={dirty} patch={(fn) => { setD(fn); setDirty(true); }} />;
}
const confirmed = (): AjpesAnnualSettings => confirmProfile(changeProfile(emptyAjpesSettings, { legalForm: "doo", framework: "SRS", size: "small", periodStart: "2025-01-01", periodEnd: "2025-12-31", confirmationBasis: "x" }));

describe("ajpes profile", () => {
  it("defaults unknown, unconfirmed", () => {
    render(<Harness init={emptyAjpesSettings} />);
    expect((screen.getByTestId("profile-microRegime") as HTMLSelectElement).value).toBe("unknown");
    expect(screen.getByTestId("profile-state").textContent).toContain("Nepotrjen");
  });
  it("edit clears confirmation, syncs legacy, unknown differs from no", () => {
    render(<Harness init={confirmed()} />);
    expect(last.profile?.confirmed).toBe(true);
    fireEvent.change(screen.getByTestId("profile-auditRequired"), { target: { value: "no" } });
    expect(last.profile?.confirmed).toBe(false);
    expect(last.profile?.auditRequired).toBe("no");
    expect(last.profile?.listed).toBe("unknown");
    expect(last.metadata.size).toBe("3");
    expect(last.metadata.accountingMethod).toBe("2");
    fireEvent.change(screen.getByTestId("profile-size"), { target: { value: "unknown" } });
    expect(last.metadata.size).toBeUndefined();
  });
  it("normalizes comma and keeps zero vs blank", () => {
    render(<Harness init={emptyAjpesSettings} />);
    fireEvent.change(screen.getByTestId("profile-currentCriteria-assets"), { target: { value: "1250,50" } });
    fireEvent.change(screen.getByTestId("profile-currentCriteria-revenue"), { target: { value: "0" } });
    const c = cleanSettings(last).profile!.currentCriteria;
    expect(c).toEqual({ assets: "1250.50", revenue: "0", employees: "" });
    fireEvent.change(screen.getByTestId("profile-currentCriteria-employees"), { target: { value: "abc" } });
    expect(invalidInputs(last).length).toBe(1);
  });
  it("confirm disabled until complete, stored in settings", () => {
    render(<Harness init={emptyAjpesSettings} />);
    expect((screen.getByTestId("profile-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(defaultProfile().confirmed).toBe(false);
  });
});
