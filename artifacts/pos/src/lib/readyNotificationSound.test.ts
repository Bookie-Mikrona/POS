import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadyNotificationSound } from "./readyNotificationSound";

afterEach(() => vi.unstubAllGlobals());

function audioMock() {
  const oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const context = {
    state: "suspended", currentTime: 5, destination: {},
    resume: vi.fn(async () => { context.state = "running"; }),
    close: vi.fn(async () => { context.state = "closed"; }),
    createOscillator: vi.fn(() => {
      const oscillator = { type: "", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(),
        disconnect: vi.fn(), onended: null, start: vi.fn(), stop: vi.fn() };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(),
    })),
  };
  const Constructor = vi.fn(function () { return context; });
  vi.stubGlobal("AudioContext", Constructor);
  return { context, Constructor, oscillators };
}

describe("ready notification sound", () => {
  it("unlocks once, reuses the context and plays two audible notes per toast", async () => {
    const { context, Constructor, oscillators } = audioMock();
    const sound = createReadyNotificationSound();
    await sound.unlock();
    await sound.unlock();
    await sound.play();
    expect(Constructor).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0].start).toHaveBeenCalledWith(5);
    expect(oscillators[1].start).toHaveBeenCalledWith(5.22);
    await sound.play();
    expect(oscillators).toHaveLength(4);
    sound.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    await sound.play();
    expect(oscillators).toHaveLength(4);
  });

  it("does not leak a rejection if the browser blocks audio", async () => {
    const { context } = audioMock();
    context.resume.mockRejectedValueOnce(new Error("blocked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sound = createReadyNotificationSound();
    await expect(sound.play()).resolves.toBeUndefined();
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    sound.dispose();
    warn.mockRestore();
  });
});