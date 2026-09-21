import { createHash, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalAuthorityJson } from "./offline-authority";

describe("offline authority canonical contract", () => {
  it("has deterministic ordering, hash and RSA signature input", () => {
    const left = { scope: { b: "B1", pp: "PP1" }, version: 1, catalog: [{ id: 2 }, { id: 1 }] };
    const right = { catalog: [{ id: 2 }, { id: 1 }], version: 1, scope: { pp: "PP1", b: "B1" } };
    const canonical = canonicalAuthorityJson(left);
    expect(canonicalAuthorityJson(right)).toBe(canonical);
    expect(createHash("sha256").update(canonical).digest("hex")).toHaveLength(64);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signer = createSign("RSA-SHA256"); signer.update(canonical); signer.end();
    const signature = signer.sign(privateKey);
    const verifier = createVerify("RSA-SHA256"); verifier.update(canonical); verifier.end();
    expect(verifier.verify(publicKey, signature)).toBe(true);
    const tampered = createVerify("RSA-SHA256"); tampered.update(`${canonical} `); tampered.end();
    expect(tampered.verify(publicKey, signature)).toBe(false);
  });
});