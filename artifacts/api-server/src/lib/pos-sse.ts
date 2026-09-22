import type { Response } from "express";

interface SseClient {
  res: Response;
  napravaId: string | null;
  companyId: string;
  enotaId: number;
}

const clients = new Set<SseClient>();

export function addClient(
  res: Response,
  napravaId: string | null,
  companyId: string,
  enotaId: number,
): void {
  clients.add({ res, napravaId, companyId, enotaId });
}

export function removeClient(res: Response): void {
  for (const client of clients) {
    if (client.res === res) {
      clients.delete(client);
      break;
    }
  }
}

export function broadcastToUnit(enotaId: number, event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.enotaId !== enotaId) continue;
    try {
      client.res.write(msg);
    } catch {
      clients.delete(client);
    }
  }
}

export function broadcastToDevice(
  enotaId: number,
  napravaId: string,
  event: string,
  data: unknown,
): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.enotaId === enotaId && client.napravaId === napravaId) {
      try {
        client.res.write(msg);
      } catch {
        clients.delete(client);
      }
    }
  }
}

/** Podjetniški dogodki nikoli ne smejo zapustiti meja podjetja. */
export function broadcastToCompany(companyId: string, event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.companyId !== companyId) continue;
    try {
      client.res.write(msg);
    } catch {
      clients.delete(client);
    }
  }
}
