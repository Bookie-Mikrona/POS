import { describe, expect, it } from "vitest";
import type { Response } from "express";
import {
  addClient,
  broadcastToCompany,
  removeClient,
} from "./pos-sse";

function fakeResponse() {
  const messages: string[] = [];
  return {
    response: { write: (message: string) => messages.push(message) } as unknown as Response,
    messages,
  };
}

describe("podjetniški POS SSE dogodki", () => {
  it("paket pošlje samo povezavam istega podjetja", () => {
    const first = fakeResponse();
    const sameCompany = fakeResponse();
    const otherCompany = fakeResponse();
    addClient(first.response, "naprava-1", "podjetje-a");
    addClient(sameCompany.response, "naprava-2", "podjetje-a");
    addClient(otherCompany.response, "naprava-3", "podjetje-b");

    try {
      broadcastToCompany("podjetje-a", "auth:pos-plan-changed", {
        companyId: "podjetje-a",
        plan: "lite",
      });

      expect(first.messages).toHaveLength(1);
      expect(sameCompany.messages).toHaveLength(1);
      expect(otherCompany.messages).toHaveLength(0);
    } finally {
      removeClient(first.response);
      removeClient(sameCompany.response);
      removeClient(otherCompany.response);
    }
  });
});