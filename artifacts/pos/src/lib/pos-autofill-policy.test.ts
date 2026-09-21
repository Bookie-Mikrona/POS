import { afterEach, describe, expect, it } from "vitest";
import { setupPosAutofillPolicy } from "./pos-autofill-policy";

describe("POS Autofill politika", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = "";
  });

  it("izključi Autofill na običajnih in naknadno dodanih operativnih poljih", async () => {
    const amount = document.createElement("input");
    amount.type = "number";
    document.body.appendChild(amount);
    cleanup = setupPosAutofillPolicy();

    expect(amount.autocomplete).toBe("off");

    const description = document.createElement("textarea");
    document.body.appendChild(description);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(description.autocomplete).toBe("off");
  });

  it("ohrani eksplicitne oznake ter samodejno izpolnjevanje semantičnih polj", async () => {
    cleanup = setupPosAutofillPolicy();
    const email = document.createElement("input");
    email.type = "email";
    const password = document.createElement("input");
    password.type = "password";
    password.autocomplete = "current-password";
    document.body.append(email, password);
    await new Promise<void>(resolve => queueMicrotask(resolve));

    expect(email.hasAttribute("autocomplete")).toBe(false);
    expect(password.autocomplete).toBe("current-password");
  });
});