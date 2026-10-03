import { customFetch } from "@workspace/api-client-react";

export interface PosEventStream {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

/** Native EventSource cannot send the bearer/tenant headers used by POS APIs. */
export function createPosEventStream(url: string, headers: HeadersInit): PosEventStream {
  const controller = new AbortController();
  const events = new EventTarget();
  let closed = false;
  const emit = (type: string, data = "") => {
    if (!closed) events.dispatchEvent(new MessageEvent(type, { data }));
  };
  void (async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await customFetch<Response>(url, {
        responseType: "stream", signal: controller.signal, cache: "no-store",
        headers: { ...Object.fromEntries(new Headers(headers)), Accept: "text/event-stream" },
      });
      if (closed) { await response.body?.cancel(); return; }
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/event-stream"
        || !response.body) throw new Error("POS obvestila: strežnik ni vrnil toka dogodkov.");
      reader = response.body.getReader();
      emit("open");
      const decoder = new TextDecoder();
      let pending = "";
      let type = "message";
      let data: string[] = [];
      const line = (value: string) => {
        if (!value) {
          if (data.length) emit(type, data.join("\n"));
          type = "message";
          data = [];
        } else if (value.startsWith("event:")) {
          type = value.slice(6).replace(/^ /, "");
        } else if (value.startsWith("data:")) {
          data.push(value.slice(5).replace(/^ /, ""));
        }
      };
      while (!closed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          line(pending.slice(0, end).replace(/\r$/, ""));
          pending = pending.slice(end + 1);
          if (closed) break;
        }
      }
      // A closed connection must trigger the hook's reconnect, not silently die.
      emit("error");
    } catch (error) {
      if (!closed) {
        console.warn("Povezava za POS obvestila je prekinjena.", error);
        emit("error");
      }
    } finally {
      reader?.releaseLock();
    }
  })();
  return {
    addEventListener(type, listener) {
      events.addEventListener(type, event => listener(event as MessageEvent));
    },
    close() {
      closed = true;
      controller.abort();
    },
  };
}