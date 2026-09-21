import { describe, expect, it } from "vitest";
import { interpretResponse, type ParsedMessage } from "./pos-payten";

function approvedPaytenFixture(amount?: string): ParsedMessage {
  const tailFields = Array.from({ length: 13 }, () => "");
  tailFields[0] = amount ?? "";
  tailFields[5] = "**** **** **** 1234";
  tailFields[9] = "AUTH42";
  tailFields[12] = "VISA";
  return {
    msgId: "10",
    txFlag: "02",
    txNum: "471123",
    tailFields,
    raw: "10...Payten ECR v2.62 fixture",
  };
}

describe("Payten ECR v2.62 odgovor", () => {
  it("bere odobren celotni terminalski znesek v centih in referenco", () => {
    expect(interpretResponse(approvedPaytenFixture("1340"))).toMatchObject({
      status: "odobren",
      referenca: "471123",
      znesek: 1340,
      avtorizacijskaKoda: "AUTH42",
      kartica: "VISA",
      maskiranPan: "**** **** **** 1234",
    });
  });

  it("ob manjkajočem znesku ne izmisli ničelnega plačila", () => {
    expect(interpretResponse(approvedPaytenFixture())).toMatchObject({
      status: "odobren",
      znesek: undefined,
    });
  });
});