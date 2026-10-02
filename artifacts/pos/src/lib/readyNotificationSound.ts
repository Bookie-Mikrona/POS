/** A shared context is unlocked by an operator gesture before an SSE toast
 * arrives. Creating a new context only on arrival is blocked on many tablets. */
export function createReadyNotificationSound() {
  let context: AudioContext | null = null;
  let disposed = false;

  async function getRunningContext() {
    if (disposed) return null;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!context || context.state === "closed") context = new AudioContextClass();
    if (context.state !== "running") await context.resume();
    return !disposed && context.state === "running" ? context : null;
  }

  return {
    async unlock() {
      try { await getRunningContext(); }
      catch (error) { console.warn("Zvoka obvestil ni mogoče omogočiti.", error); }
    },
    async play() {
      try {
        const audio = await getRunningContext();
        if (!audio) return;
        for (const [offset, frequency] of [[0, 880], [0.22, 1175]]) {
          const start = audio.currentTime + offset;
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(start);
          oscillator.stop(start + 0.2);
        }
      } catch (error) {
        // A sound failure must never suppress the visible notification.
        console.warn("Zvoka pripravljenega artikla ni mogoče predvajati.", error);
      }
    },
    dispose() {
      disposed = true;
      if (context && context.state !== "closed") void context.close().catch(() => {});
    },
  };
}