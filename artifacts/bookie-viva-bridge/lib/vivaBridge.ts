export type BridgeResult =
  | { kind: 'launch'; vivaDeepLinkUrl: string }
  | { kind: 'approved'; returnUrl: string }
  | { kind: 'failed'; returnUrl: string }
  | { kind: 'invalid'; message: string };

const ALLOWED_VIVA_PACKAGES = new Set([
  'com.vivawallet.spoc.payapp',
  'com.vivawallet.spoc.payapp.demo',
]);

interface BridgeState {
  v: 1;
  returnUrl: string;
  clientTransactionId: string;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isAllowedReturnUrl(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== 'https:') return false;
  if (!url.pathname.endsWith('/pos/blagajna')) return false;
  return url.hostname.endsWith('.replit.app')
    || url.hostname.endsWith('.replit.dev')
    || url.hostname === 'bookie-erp.replit.app';
}

function parseVivaNativeTarget(target: string): string | null {
  const marker = '#Intent;';
  const markerIndex = target.indexOf(marker);
  if (markerIndex < 0) return null;

  const intentUrl = target.slice(0, markerIndex);
  const intentDirectives = target.slice(markerIndex + marker.length).split(';');
  if (intentDirectives.at(-1) !== 'end') return null;

  const scheme = intentDirectives.find((part) => part.startsWith('scheme='))?.slice('scheme='.length);
  const packageName = intentDirectives.find((part) => part.startsWith('package='))?.slice('package='.length);
  if (scheme !== 'vivapayclient' || !packageName || !ALLOWED_VIVA_PACKAGES.has(packageName)) return null;

  const nativeUrl = intentUrl.replace(/^intent:/, 'vivapayclient:');
  const parsed = new URL(nativeUrl);
  if (parsed.protocol !== 'vivapayclient:' || parsed.hostname !== 'pay' || parsed.pathname !== '/v1') return null;
  return nativeUrl;
}

export function parseVivaBridgeResult(incomingUrl: string): BridgeResult {
  try {
    const incoming = new URL(incomingUrl);
    if (incoming.protocol !== 'bookie-viva-bridge:' || !['pay', 'result'].includes(incoming.hostname)) {
      return { kind: 'invalid', message: 'Prejeti URI ni Bookie Viva callback.' };
    }

    const encodedState = incoming.pathname.replace(/^\/+/, '').split('/')[0];
    if (!encodedState) return { kind: 'invalid', message: 'Callback ne vsebuje konteksta plačila.' };
    const state = JSON.parse(decodeBase64Url(encodedState)) as Partial<BridgeState>;
    if (
      state.v !== 1
      || typeof state.returnUrl !== 'string'
      || typeof state.clientTransactionId !== 'string'
      || !isAllowedReturnUrl(state.returnUrl)
    ) {
      return { kind: 'invalid', message: 'Kontekst plačila ni veljaven.' };
    }

    if (incoming.hostname === 'pay') {
      const target = incoming.searchParams.get('target') ?? '';
      const vivaDeepLinkUrl = parseVivaNativeTarget(target);
      if (!vivaDeepLinkUrl) {
        return { kind: 'invalid', message: 'Viva plačilni zahtevek ni veljaven.' };
      }
      const expectedCallback = `bookie-viva-bridge://result/${encodedState}`;
      if (new URL(vivaDeepLinkUrl).searchParams.get('callback') !== expectedCallback) {
        return { kind: 'invalid', message: 'Povratni naslov Viva zahtevka ni veljaven.' };
      }
      return { kind: 'launch', vivaDeepLinkUrl };
    }

    const callbackClientId = incoming.searchParams.get('clientTransactionId')?.trim() ?? '';
    if (!callbackClientId || callbackClientId !== state.clientTransactionId) {
      return { kind: 'invalid', message: 'Referenca povratka se ne ujema z začetim plačilom.' };
    }

    const status = incoming.searchParams.get('status')?.trim() ?? '';
    const transactionId = incoming.searchParams.get('transactionId')?.trim() ?? '';
    const returnUrl = new URL(state.returnUrl);
    returnUrl.searchParams.set('vivaTapToPay', '1');
    returnUrl.searchParams.set('clientTransactionId', callbackClientId);

    if (status === 'success' && transactionId) {
      returnUrl.searchParams.set('status', 'success');
      returnUrl.searchParams.set('transactionId', transactionId);
      return { kind: 'approved', returnUrl: returnUrl.toString() };
    }

    returnUrl.searchParams.set('status', status || 'unknown');
    const errorCode = incoming.searchParams.get('errorCode')?.trim();
    const message = incoming.searchParams.get('message')?.trim();
    if (errorCode) returnUrl.searchParams.set('errorCode', errorCode);
    if (message) returnUrl.searchParams.set('message', message);
    return { kind: 'failed', returnUrl: returnUrl.toString() };
  } catch {
    return { kind: 'invalid', message: 'Viva callbacka ni bilo mogoče prebrati.' };
  }
}