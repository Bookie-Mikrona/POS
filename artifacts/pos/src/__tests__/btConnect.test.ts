/**
 * Unit testi za BT tihi reconnect — localStorage helpers in statusna logika.
 *
 * Pokriva:
 *  - saveBtDeviceRecord / getBtSavedDevice / clearBtSavedDevice: round-trip,
 *    neveljavni podatki, pokvarjen JSON
 *  - BT_CONNECTION_EVENT: konstanta je string (za addEventListener)
 *  - tryAutoConnectBluetooth: brez navigator.bluetooth → false (kompatibilnost)
 *
 * Opomba: celoten tok tihega reconnecta (navigator.bluetooth.getDevices(),
 * GATT connect, findBtChar) zahteva Web Bluetooth API ki ni na voljo v
 * Node/jsdom okolju. Ti scenariji so pokriti z ročnim integracijskim testom
 * na dejanski Android Chrome napravi.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveBtDeviceRecord,
  getBtSavedDevice,
  clearBtSavedDevice,
  BT_CONNECTION_EVENT,
  type SavedBtDevice,
} from "../lib/printer";

beforeEach(() => {
  localStorage.clear();
});

// ── BT_CONNECTION_EVENT ────────────────────────────────────────────────────

describe("BT_CONNECTION_EVENT", () => {
  it("je string (za addEventListener/dispatchEvent)", () => {
    expect(typeof BT_CONNECTION_EVENT).toBe("string");
    expect(BT_CONNECTION_EVENT.length).toBeGreaterThan(0);
  });
});

// ── saveBtDeviceRecord / getBtSavedDevice ──────────────────────────────────

describe("saveBtDeviceRecord + getBtSavedDevice", () => {
  it("round-trip: shrani in naloži id+name", () => {
    saveBtDeviceRecord("abc123", "Q10 Back Clip");
    const d = getBtSavedDevice();
    expect(d).not.toBeNull();
    expect(d!.id).toBe("abc123");
    expect(d!.name).toBe("Q10 Back Clip");
  });

  it("brez name: shrani samo id", () => {
    saveBtDeviceRecord("xyz-id-only");
    const d = getBtSavedDevice();
    expect(d!.id).toBe("xyz-id-only");
    expect(d!.name).toBeUndefined();
  });

  it("prepiše predhodno vrednost", () => {
    saveBtDeviceRecord("id1", "Printer A");
    saveBtDeviceRecord("id2", "Printer B");
    const d = getBtSavedDevice();
    expect(d!.id).toBe("id2");
    expect(d!.name).toBe("Printer B");
  });

  it("getBtSavedDevice → null ko localStorage prazen", () => {
    expect(getBtSavedDevice()).toBeNull();
  });

  it("pokvarjen JSON → null (brez metanja napake)", () => {
    localStorage.setItem("bt_device_v1", "INVALID{{JSON");
    expect(() => getBtSavedDevice()).not.toThrow();
    expect(getBtSavedDevice()).toBeNull();
  });

  it("neveljavna struktura (brez id) → null", () => {
    localStorage.setItem("bt_device_v1", JSON.stringify({ name: "Printer" }));
    expect(getBtSavedDevice()).toBeNull();
  });

  it("prazen id string → null", () => {
    localStorage.setItem("bt_device_v1", JSON.stringify({ id: "", name: "X" }));
    expect(getBtSavedDevice()).toBeNull();
  });

  it("vrnjeni tip ustreza SavedBtDevice", () => {
    saveBtDeviceRecord("type-check-id", "TypeCheck");
    const d: SavedBtDevice | null = getBtSavedDevice();
    expect(d).not.toBeNull();
    // TypeScript type check — ne bo compile napake
    const _id: string = d!.id;
    const _name: string | undefined = d!.name;
    void _id; void _name;
  });
});

// ── clearBtSavedDevice ─────────────────────────────────────────────────────

describe("clearBtSavedDevice", () => {
  it("po clearBtSavedDevice: getBtSavedDevice vrne null", () => {
    saveBtDeviceRecord("abc", "Device");
    clearBtSavedDevice();
    expect(getBtSavedDevice()).toBeNull();
  });

  it("clearBtSavedDevice brez predhodnega save ne meče napake", () => {
    expect(() => clearBtSavedDevice()).not.toThrow();
  });

  it("dvojni clear brez napake", () => {
    saveBtDeviceRecord("id", "D");
    clearBtSavedDevice();
    expect(() => clearBtSavedDevice()).not.toThrow();
    expect(getBtSavedDevice()).toBeNull();
  });
});

// ── tryAutoConnectBluetooth (API ni na voljo v testnem okolju) ─────────────

describe("tryAutoConnectBluetooth — navigator.bluetooth ni na voljo", () => {
  it("vrne false ko navigator.bluetooth ni definiran (Node/jsdom)", async () => {
    // jsdom ne implementira Web Bluetooth → navigator.bluetooth === undefined
    // tryAutoConnectBluetooth mora tiho vrniti false (brez napake).
    // POZOR: ta test ne testira dejanske BLE logike — samo da funkcija ne poruši
    // zagona aplikacije v okolju brez Web Bluetooth (iOS, Firefox, starejši Chrome).
    const { tryAutoConnectBluetooth } = await import("../lib/printer");
    const result = await tryAutoConnectBluetooth();
    // V testnem okolju navigator.bluetooth ni na voljo → false
    expect(result).toBe(false);
  });
});
