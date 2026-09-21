import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecretInput } from "./SecretInput";

describe("SecretInput", () => {
  it('renderira type="text" in privzeto maskira vrednost', () => {
    render(<SecretInput value="integracijska-vrednost" onChange={() => undefined} />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("type", "text");
    expect(input).not.toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("data-masked", "true");
  });

  it("show/hide preklaplja samo CSS maskiranje", () => {
    render(<SecretInput value="vrednost" onChange={() => undefined} />);

    const input = screen.getByRole("textbox");
    fireEvent.click(screen.getByRole("button", { name: "Prikaži vrednost" }));
    expect(input).toHaveAttribute("data-masked", "false");
    expect(input).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Skrij vrednost" }));
    expect(input).toHaveAttribute("data-masked", "true");
  });

  it("posreduje spremembo vrednosti in uporablja atribute proti password managerjem", () => {
    let receivedValue = "";
    const onChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => {
      receivedValue = event.currentTarget.value;
    });
    render(<SecretInput value="" onChange={onChange} id="integration-value" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("data-1p-ignore", "true");
    expect(input).toHaveAttribute("data-lpignore", "true");
    expect(input).toHaveAttribute("name", "credential-value");

    fireEvent.change(input, { target: { value: "nova-vrednost" } });
    expect(onChange).toHaveBeenCalled();
    expect(receivedValue).toBe("nova-vrednost");
  });
});