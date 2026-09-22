import { describe, expect, it } from "vitest";
import type { Response } from "express";
import {
  addClient,
  broadcastToDevice,
  broadcastToCompany,
  broadcastToUnit,
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
    addClient(first.response, "naprava-1", "podjetje-a", 1);
    addClient(sameCompany.response, "naprava-2", "podjetje-a", 2);
    addClient(otherCompany.response, "naprava-3", "podjetje-b", 3);

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

  it("dogodek enote ne doseže druge enote istega ali drugega podjetja", () => {
    const target = fakeResponse();
    const sameCompany = fakeResponse();
    const otherCompany = fakeResponse();
    addClient(target.response, "skupna-naprava", "podjetje-a", 10);
    addClient(sameCompany.response, "skupna-naprava", "podjetje-a", 11);
    addClient(otherCompany.response, "skupna-naprava", "podjetje-b", 12);

    try {
      broadcastToUnit(10, "update", { type: "narocilo", id: 42 });

      expect(target.messages).toHaveLength(1);
      expect(sameCompany.messages).toHaveLength(0);
      expect(otherCompany.messages).toHaveLength(0);
    } finally {
      removeClient(target.response);
      removeClient(sameCompany.response);
      removeClient(otherCompany.response);
    }
  });

  it("dogodek naprave zahteva pravo enoto in pravo napravo", () => {
    const target = fakeResponse();
    const sameDeviceOtherUnit = fakeResponse();
    const otherDeviceSameUnit = fakeResponse();
    addClient(target.response, "naprava-1", "podjetje-a", 20);
    addClient(sameDeviceOtherUnit.response, "naprava-1", "podjetje-b", 21);
    addClient(otherDeviceSameUnit.response, "naprava-2", "podjetje-a", 20);

    try {
      broadcastToDevice(20, "naprava-1", "postavkaPripravljena", { id: 7 });

      expect(target.messages).toHaveLength(1);
      expect(sameDeviceOtherUnit.messages).toHaveLength(0);
      expect(otherDeviceSameUnit.messages).toHaveLength(0);
    } finally {
      removeClient(target.response);
      removeClient(sameDeviceOtherUnit.response);
      removeClient(otherDeviceSameUnit.response);
    }
  });
});