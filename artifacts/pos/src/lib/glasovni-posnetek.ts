/**
 * Nadomestek za prepoznavanje govora v brskalniku (Android WebView ga nima):
 * posname en stavek, zazna konec govora po tišini in ga pošlje strežniku v prepis.
 */
export type PosnetekHandle = { stop: () => void };

export type PosnetekCallbacks = {
  onResult: (tekst: string) => void;
  onError: (napaka: string) => void;
  onActivity: () => void;
  /** Sproži se, ko je stavek prepisan (ali ni bilo govora) in je mikrofon sproščen. */
  onEnd: () => void;
};

const TISINA_PO_GOVORU_MS = 700;
const NAJDALJE_CAKANJE_NA_GOVOR_MS = 6000;
const NAJDALJE_SNEMANJE_MS = 12000;
const PRAG_GLASNOSTI = 0.02;

export function jePodprtoSnemanje(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function izberiMime(): string {
  const kandidati = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return kandidati.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

async function dobiBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function prepisi(blob: Blob, mimeType: string): Promise<string> {
  const odgovor = await fetch("/api/ai/glasovni-prepis", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: await dobiBase64(blob), mimeType }),
  });
  if (!odgovor.ok) throw new Error("PREPIS");
  const { tekst } = (await odgovor.json()) as { tekst?: string };
  return (tekst ?? "").trim();
}

/** Posname en stavek. Vrne ročaj; stop() zaključi snemanje in še vedno prepiše do tedaj posneto. */
export function posnemiStavek(cb: PosnetekCallbacks): PosnetekHandle {
  let koncano = false;
  let ustavljeno = false;
  let zakljuci: () => void = () => { ustavljeno = true; };

  void (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      koncano = true;
      cb.onError(cause instanceof Error && cause.name === "NotAllowedError" ? "not-allowed" : "audio-capture");
      cb.onEnd();
      return;
    }
    const mime = izberiMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const deli: Blob[] = [];
    let slisalGovor = false;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const vzorec = new Uint8Array(analyser.fftSize);
    const zacetek = Date.now();
    let zadnjiGovor = 0;

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(vzorec);
      let max = 0;
      for (const v of vzorec) max = Math.max(max, Math.abs(v - 128) / 128);
      const zdaj = Date.now();
      if (max > PRAG_GLASNOSTI) {
        if (!slisalGovor) cb.onActivity();
        slisalGovor = true;
        zadnjiGovor = zdaj;
      }
      const tisina = slisalGovor && zdaj - zadnjiGovor > TISINA_PO_GOVORU_MS;
      const prevecCakanja = !slisalGovor && zdaj - zacetek > NAJDALJE_CAKANJE_NA_GOVOR_MS;
      if (tisina || prevecCakanja || zdaj - zacetek > NAJDALJE_SNEMANJE_MS) zakljuci();
    }, 80);

    recorder.ondataavailable = (e) => { if (e.data.size) deli.push(e.data); };
    recorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      try {
        if (slisalGovor && deli.length) {
          const tekst = await prepisi(new Blob(deli, { type: recorder.mimeType || "audio/webm" }), recorder.mimeType || "audio/webm");
          if (tekst) cb.onResult(tekst);
        }
      } catch {
        cb.onError("network");
      } finally {
        koncano = true;
        cb.onEnd();
      }
    };
    zakljuci = () => { if (recorder.state !== "inactive") recorder.stop(); };
    recorder.start();
    if (ustavljeno) zakljuci();
  })();

  return { stop: () => { if (!koncano) zakljuci(); } };
}
