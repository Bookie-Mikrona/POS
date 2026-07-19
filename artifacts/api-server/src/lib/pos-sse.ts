import type { Response } from "express";

interface SseClient {
  res: Response;
  napravaId: string | null;
}

const clients = new Set<SseClient>();

export function addClient(res: Response, napravaId: string | null): void {
  clients.add({ res, napravaId });
}

export function removeClient(res: Response): void {
  for (const client of clients) {
    if (client.res === res) {
      clients.delete(client);
      break;
    }
  }
}

export function broadcast(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(msg);
    } catch {
      clients.delete(client);
    }
  }
}

export function broadcastTo(napravaId: string, event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.napravaId === napravaId) {
      try {
        client.res.write(msg);
      } catch {
        clients.delete(client);
      }
    }
  }
}
