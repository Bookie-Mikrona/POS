import { describe, expect, it } from "vitest";
import { isEditableKeyboardTarget } from "./keyboard-events";

describe("globalne tipkovne bližnjice", () => {
  it.each(["1", "2", "3"])("ne prestreže Gboard tipke %s v vnosnem polju", key => {
    const input = document.createElement("input");
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    input.dispatchEvent(event);

    expect(isEditableKeyboardTarget(input)).toBe(true);
  });

  it("dovoli bližnjice, ko fokus ni v vnosnem polju", () => {
    const button = document.createElement("button");
    expect(isEditableKeyboardTarget(button)).toBe(false);
  });

  it("prepozna otroka urejevalnega elementa", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.appendChild(child);

    expect(isEditableKeyboardTarget(child)).toBe(true);
  });
});