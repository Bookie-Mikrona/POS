import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./input";
import { formatDatum, formatCasovniZig, parseDatum } from "@/lib/utils";

afterEach(cleanup);
describe("Slovenian accounting dates", () => {
  it("formats date-only and document timestamps without timezone shifts", () => {
    expect(formatDatum("2026-01-03")).toBe("03.01.2026");
    expect(formatDatum("2026-01-03T23:59:59Z")).toBe("03.01.2026");
    expect(formatDatum("2026-10-25")).toBe("25.10.2026");
    expect(formatDatum("2026-02-30")).toBe("—");
    expect(formatDatum(null)).toBe("—");
    expect(parseDatum("29.02.2024")).toBe("2024-02-29");
    expect(parseDatum("29.02.2026")).toBeNull();
    expect(parseDatum("1.2.2026")).toBe("2026-02-01");
    expect(formatCasovniZig("2026-01-03T23:59:59Z")).toBe("04.01.2026 00:59:59");
    expect(formatCasovniZig("2026-07-03T23:59:59Z")).toBe("04.07.2026 01:59:59");
  });
  it("shows padded dates even when the browser locale is English", () => {
    render(<Input type="date" value="2026-10-06" lang="en-US" readOnly />);
    expect(screen.getByRole("textbox")).toHaveValue("06.10.2026");
  });
  it("sends ISO dates to existing callers while accepting dd.mm.yyyy", () => {
    const captured = vi.fn();
    function Form() {
      const [value, setValue] = React.useState("2026-01-01");
      return <Input type="date" value={value} onChange={e => { captured(e.target.value); setValue(e.target.value); }} />;
    }
    render(<Form />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "06.10.2026" } });
    expect(captured).toHaveBeenLastCalledWith("2026-10-06");
    expect(screen.getByRole("textbox")).toHaveValue("06.10.2026");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "31.02.2026" } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(captured).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("textbox")).toHaveValue("31.02.2026");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("textbox")).toBeInvalid();
    fireEvent.change(screen.getByLabelText("Koledar: datum"), { target: { value: "2026-03-01" } });
    expect(captured).toHaveBeenLastCalledWith("2026-03-01");
    expect(screen.getByRole("textbox")).toHaveValue("01.03.2026");
    expect(screen.getByRole("textbox")).toBeValid();
  });
  it("normalizes ISO paste and preserves the input event's identity and methods", () => {
    const changed = vi.fn();
    render(<Input type="date" id="TEST-date" name="entryDate" value=""
      onChange={event => {
        event.preventDefault();
        changed(event.target.id, event.target.name, event.target.type, event.currentTarget.value);
      }} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2026-10-06" } });
    expect(screen.getByRole("textbox")).toHaveValue("06.10.2026");
    expect(changed).toHaveBeenCalledWith("TEST-date", "entryDate", "date", "2026-10-06");
  });
  it("respects bounds, resets, clearing and disabled calendar controls", () => {
    const captured = vi.fn();
    const { rerender } = render(<Input type="date" value="2026-01-01" min="2026-01-01" max="2026-12-31"
      onChange={e => captured(e.target.value)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "31.12.2025" } });
    expect(captured).toHaveBeenLastCalledWith("2025-12-31");
    expect(screen.getByRole("textbox")).toBeInvalid();
    rerender(<Input type="date" value="2026-10-06" disabled />);
    expect(screen.getByRole("textbox")).toHaveValue("06.10.2026");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByLabelText("Koledar: datum")).toBeDisabled();
    rerender(<Input type="date" value="" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
