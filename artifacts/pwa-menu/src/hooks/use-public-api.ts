import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  QrGostNarociloInput,
  QrGostNarociloResponse,
} from '@workspace/api-client-react';

const QR_NAPRAVA_STORAGE_KEY = 'bookie.qr-naprava-id.v1';
const QR_NAPRAVA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function novaQrNapravaId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Brskalnik ne podpira varne identitete za QR naročilo.');
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stabilna, anonimna identiteta tega javnega QR brskalnika. */
export function getOrCreateQrNapravaId(): string {
  const saved = window.localStorage.getItem(QR_NAPRAVA_STORAGE_KEY);
  if (saved && QR_NAPRAVA_ID_RE.test(saved)) return saved.toLowerCase();

  const qrNapravaId = novaQrNapravaId();
  window.localStorage.setItem(QR_NAPRAVA_STORAGE_KEY, qrNapravaId);
  return qrNapravaId;
}

export type PublicMenuModifier = {
  id: number;
  naziv: string;
  cena: number;
  alergeni?: { koda: string; naziv: string }[] | null;
  alergeniSledi?: { koda: string; naziv: string }[] | null;
  potrjen?: boolean;
  opozorila?: string[];
};

export type PublicMenuModifierGroup = {
  id: number;
  naziv: string;
  obvezna: boolean;
  minIzbir: number;
  maxIzbir: number;
  opcije: PublicMenuModifier[];
};

export type PublicMenuToGoEmbalaza = {
  id: number;
  naziv: string;
  cena: number;
};

export type PublicMenuArticle = {
  id: number;
  naziv: string;
  opis: string | null;
  cena: number;
  barva: string | null;
  /** Neobvezni razširitvi za menije, ki imajo slike in seznam alergenov. */
  slikaUrl?: string | null;
  alergeni?: { koda: string; naziv: string }[] | null;
  alergeniSledi?: { koda: string; naziv: string }[] | null;
  potrjen?: boolean;
  opozorila?: string[];
  jeAlkohol: boolean;
  naVoljo: boolean;
  mealType: 'ala_carte' | 'prepared' | 'composite';
  availableQuantity: number | null;
  jePica: boolean;
  toGo: boolean;
  toGoEmbalaza: PublicMenuToGoEmbalaza[];
  velikostiPic: Array<{ id: "mala" | "normalna" | "druzinska"; naziv: string; premerCm: number; normativFaktor: number; cena: number }>;
  kategorija: { naziv: string } | null;
  modifikatorji: PublicMenuModifierGroup[];
};

export type PublicMenuCategory = {
  naziv: string;
  artikli: PublicMenuArticle[];
};

export type PublicMulticourseMenu = {
  menuArtikelId: number;
  /** Legacy setting retained for menus configured before the generic contract. */
  izbor: 'fixed_four' | 'choose_three';
  selectionMode?: 'fixed' | 'choose' | null;
  selectionCount?: number | null;
  courses: Array<{
    courseNumber: number;
    courseName?: string | null;
    /** Legacy default; selections must use one of allowedFoodArtikelIds. */
    foodArtikelId: number;
    allowedFoodArtikelIds: number[];
    allowedWineArtikelIds: number[];
    /** Absent on legacy menus, where wine was required for every course. */
    wineRequired?: boolean | null;
    /** Informational courses are materialized automatically by the server. */
    informational?: boolean | null;
  }>;
};

export type PublicExistingOrderLine = {
  ime: string;
  kolicina: number;
  cenaKos: number;
  skupaj: number;
  opomba: string | null;
  toGo: boolean;
  velikostPice: "mala" | "normalna" | "druzinska" | null;
  dodatki: Array<{
    ime: string;
    kolicina: number;
    cenaKos: number;
    skupaj: number;
    tip: "modifikator" | "embalaza";
  }>;
};

export type PublicExistingOrder = {
  narociloId: number;
  skupaj: number;
  znesekNapitnina: number;
  postavke: PublicExistingOrderLine[];
};

export type MeniJavnoResponse = {
  qrAiAsistentAktiven: boolean;
  lokal: {
    podjetjeNaziv: string;
    enotaNaziv: string;
  };
  miza: {
    stevilka: number;
    naziv: string | null;
    prostorNaziv: string | null;
  };
  kategorije: PublicMenuCategory[];
  artikli: PublicMenuArticle[];
  /** Konfiguracija večhodnih menijev; hrano postrežnik materializira iz te konfiguracije. */
  multicourseMenus: PublicMulticourseMenu[];
  obstojeceNarocilo: PublicExistingOrder | null;
};

export type PublicMenuActivationResponse = {
  aktivirano: true;
  veljaDo: string;
  radijMetri: 50;
  nacin: 'gps' | 'wifi';
};

export async function activatePublicMenu(
  token: string,
  qrNapravaId: string,
  position?: Pick<GeolocationCoordinates, 'latitude' | 'longitude' | 'accuracy'>,
  previewSession?: string,
): Promise<PublicMenuActivationResponse> {
  const res = await fetch(`/api/javno/meni/${token}/aktivacija`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qrNapravaId,
      ...(previewSession ? { previewSession } : {}),
      ...(position ? {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
      } : {}),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Lokacije ni bilo mogoče potrditi.');
  }
  return res.json();
}

export const usePublicMenu = (token: string, qrNapravaId: string | null, activated: boolean) => {
  return useQuery({
    queryKey: ['publicMenu', token, qrNapravaId],
    queryFn: async (): Promise<MeniJavnoResponse> => {
      const query = qrNapravaId ? `?qrNapravaId=${encodeURIComponent(qrNapravaId)}` : '';
      const res = await fetch(`/api/javno/meni/${token}${query}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) throw new Error('Javni meni ni najden.');
        if (res.status === 429) throw new Error('Preveč zahtev. Poskusite znova kasneje.');
        throw new Error(data?.error || 'Prišlo je do napake pri nalaganju menija.');
      }
      return res.json();
    },
    enabled: !!token && !!qrNapravaId && activated,
    refetchInterval: 5_000,
    staleTime: 2_000,
    retry: false,
  });
};

export function useUpdatePublicOrderTip(token: string, qrNapravaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (znesekNapitnina: number): Promise<{ znesekNapitnina: number }> => {
      const res = await fetch(`/api/javno/meni/${token}/napitnina`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrNapravaId, znesekNapitnina }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Napitnine ni bilo mogoče shraniti.');
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['publicMenu', token, qrNapravaId] });
    },
  });
}

export type PublicMenuConnection = {
  connected: boolean;
  lastUpdatedAt: number | null;
  reconnecting: boolean;
};

/**
 * Razpoložljivost pride prek seje, vezane na QR napravo in mizo. Dogodek je
 * zgolj signal; vedno znova naložimo cel odgovor menija, da odjemalec ne more
 * uporabiti delnega ali zastarelega stanja.
 */
export function usePublicMenuRealtime(
  token: string,
  qrNapravaId: string | null,
  activated: boolean,
): PublicMenuConnection {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<PublicMenuConnection>({
    connected: false,
    lastUpdatedAt: null,
    reconnecting: false,
  });

  useEffect(() => {
    if (!token || !qrNapravaId || !activated) {
      setConnection({ connected: false, lastUpdatedAt: null, reconnecting: false });
      return;
    }

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;
    let attempts = 0;
    const queryKey = ['publicMenu', token, qrNapravaId] as const;

    const refresh = () => {
      setConnection({ connected: true, lastUpdatedAt: Date.now(), reconnecting: false });
      void queryClient.refetchQueries({ queryKey, type: 'active' });
    };
    const connect = () => {
      if (destroyed) return;
      source = new EventSource(
        `/api/javno/meni/${encodeURIComponent(token)}/dogodki?qrNapravaId=${encodeURIComponent(qrNapravaId)}`,
        { withCredentials: true },
      );
      source.addEventListener('open', () => {
        attempts = 0;
        setConnection((current) => ({ ...current, connected: true, reconnecting: false }));
      });
      source.addEventListener('ready', (event) => {
        setConnection({ connected: true, lastUpdatedAt: Date.now(), reconnecting: false });
        // Priklop po prekinitvi vedno ponovno hidrira podatke.
        if ((event as MessageEvent).data) void queryClient.refetchQueries({ queryKey, type: 'active' });
      });
      source.addEventListener('availability', refresh);
      source.onerror = () => {
        source?.close();
        source = null;
        if (destroyed || retryTimer) return;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
        attempts += 1;
        setConnection((current) => ({ ...current, connected: false, reconnecting: true }));
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, delay);
      };
    };

    connect();
    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [activated, qrNapravaId, queryClient, token]);

  return connection;
}

export const useSubmitPublicOrder = (token: string) => {
  return useMutation({
    mutationFn: async (input: QrGostNarociloInput): Promise<QrGostNarociloResponse> => {
      const res = await fetch(`/api/javno/meni/${token}/narocilo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Prišlo je do napake pri oddaji naročila.');
      }
      return res.json();
    }
  });
};

export type PublicWaiterRequest = {
  id: number;
  stanje: 'caka' | 'potrjeno';
  ustvarjeno: string;
};

async function waiterResponse(res: Response): Promise<PublicWaiterRequest | null> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Natakarja ni bilo mogoče poklicati.');
  }
  return res.json();
}

export function useCurrentWaiterRequest(token: string, qrNapravaId: string | null, activated: boolean) {
  return useQuery({
    queryKey: ['publicWaiterRequest', token, qrNapravaId],
    queryFn: async () => waiterResponse(await fetch(
      `/api/javno/meni/${encodeURIComponent(token)}/natakar/trenutni?qrNapravaId=${encodeURIComponent(qrNapravaId!)}`,
      { credentials: 'include' },
    )),
    enabled: Boolean(token && qrNapravaId && activated),
    refetchInterval: 5_000,
    retry: false,
  });
}

export function useCallWaiter(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ qrNapravaId }: { qrNapravaId: string }) => waiterResponse(await fetch(
      `/api/javno/meni/${encodeURIComponent(token)}/natakar`,
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrNapravaId }) },
    )),
    onSuccess: (request, { qrNapravaId }) => {
      queryClient.setQueryData(['publicWaiterRequest', token, qrNapravaId], request);
    },
  });
}
