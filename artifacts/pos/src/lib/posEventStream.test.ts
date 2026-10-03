import { describe, expect, it, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { ReadableStream } from "node:stream/web";
import { customFetch } from "@workspace/api-client-react";
import { createPosEventStream } from "./posEventStream";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));

beforeEach(() => { vi.mocked(customFetch).mockReset(); });

function response(chunks: string[]) {
  return {
    headers: new Headers({ "content-type": "text/event-stream; charset=utf-8" }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe("authenticated POS event stream", () => {
  it("passes tenant headers through normal authenticated fetch and parses split readiness events", async () => {
    vi.mocked(customFetch).mockResolvedValue(response([
      "event: ping\ndata: {}\n\nevent: postavkaPri",
      "pravljena\r\ndata: {\"ime\":\"Pica\"}\r",
      "\n\r\n",
    ]));
    const stream = createPosEventStream("/pos/api/events?napravaId=origin", {
      "X-Company-Id": "company-a", "X-Enota-Id": "309", "X-Naprava-Id": "origin",
    });
    const ready = vi.fn();
    const opened = vi.fn();
    const ended = vi.fn();
    stream.addEventListener("open", opened);
    stream.addEventListener("postavkaPripravljena", ready);
    stream.addEventListener("error", ended);
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(ready.mock.calls[0][0].data).toBe('{"ime":"Pica"}');
    expect(opened).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    expect(customFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      responseType: "stream", headers: expect.objectContaining({
        "x-company-id": "company-a", "x-enota-id": "309", Accept: "text/event-stream",
      }),
    }));
    stream.close();
  });

  it("supports multiline data and ignores heartbeat comments", async () => {
    vi.mocked(customFetch).mockResolvedValue(response([
      ": heartbeat\n\nevent: example\ndata: first\ndata: second\n\n",
    ]));
    const stream = createPosEventStream("/pos/api/events", {});
    const event = vi.fn();
    stream.addEventListener("example", event);
    await waitFor(() => expect(event).toHaveBeenCalledOnce());
    expect(event.mock.calls[0][0].data).toBe("first\nsecond");
    stream.close();
  });

  it("aborts on logout or unit change and ignores late events", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(customFetch).mockReturnValue(new Promise<Response>(r => { resolve = r; }));
    const stream = createPosEventStream("/pos/api/events", {});
    const event = vi.fn();
    stream.addEventListener("postavkaPripravljena", event);
    stream.addEventListener("open", event);
    stream.addEventListener("error", event);
    stream.close();
    const signal = vi.mocked(customFetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);
    resolve(response(["event: postavkaPripravljena\ndata: {}\n\n"]));
    await new Promise(r => setTimeout(r, 0));
    expect(event).not.toHaveBeenCalled();
  });
});