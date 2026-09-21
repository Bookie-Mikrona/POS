import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVivaBridgeResult } from './vivaBridge.ts';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const state = encode({
  v: 1,
  returnUrl: 'https://bookie-erp.replit.app/pos/blagajna?narocilo=42',
  clientTransactionId: 'attempt-123',
});
const callback = `bookie-viva-bridge://result/${state}`;

test('sprejme veljaven uspešen callback', () => {
  const result = parseVivaBridgeResult(
    `${callback}?status=success&transactionId=viva-9&clientTransactionId=attempt-123`,
  );
  assert.equal(result.kind, 'approved');
  if (result.kind === 'approved') {
    assert.match(result.returnUrl, /transactionId=viva-9/);
    assert.match(result.returnUrl, /clientTransactionId=attempt-123/);
  }
});

test('zavrne neujemajočo referenco', () => {
  const result = parseVivaBridgeResult(
    `${callback}?status=success&transactionId=viva-9&clientTransactionId=wrong`,
  );
  assert.equal(result.kind, 'invalid');
});

test('sprejme le Viva launch z ujemajočim callbackom', () => {
  const target = `intent://pay/v1?callback=${encodeURIComponent(callback)}#Intent;scheme=vivapayclient;package=com.vivawallet.spoc.payapp.demo;end`;
  const result = parseVivaBridgeResult(
    `bookie-viva-bridge://pay/${state}?target=${encodeURIComponent(target)}`,
  );
  assert.equal(result.kind, 'launch');
  if (result.kind === 'launch') {
    assert.match(result.vivaDeepLinkUrl, /^vivapayclient:\/\/pay\/v1\?/);
    assert.doesNotMatch(result.vivaDeepLinkUrl, /#Intent/);
  }
});

test('zavrne launch z drugim callbackom ali neveljavnim ciljem', () => {
  const otherCallback = 'bookie-viva-bridge://result/other-state';
  const target = `intent://pay/v1?callback=${encodeURIComponent(otherCallback)}#Intent;scheme=vivapayclient;package=com.vivawallet.spoc.payapp.demo;end`;
  const result = parseVivaBridgeResult(
    `bookie-viva-bridge://pay/${state}?target=${encodeURIComponent(target)}`,
  );
  assert.equal(result.kind, 'invalid');
});

test('zavrne Viva launch za neznan Android paket', () => {
  const target = `intent://pay/v1?callback=${encodeURIComponent(callback)}#Intent;scheme=vivapayclient;package=example.evil;end`;
  const result = parseVivaBridgeResult(
    `bookie-viva-bridge://pay/${state}?target=${encodeURIComponent(target)}`,
  );
  assert.equal(result.kind, 'invalid');
});

test('zavrne povratek na drugo pot ali nešifriran naslov', () => {
  const unsafeState = encode({
    v: 1,
    returnUrl: 'http://evil.example/pos/blagajna',
    clientTransactionId: 'attempt-123',
  });
  const result = parseVivaBridgeResult(
    `bookie-viva-bridge://result/${unsafeState}?status=success&transactionId=viva-9&clientTransactionId=attempt-123`,
  );
  assert.equal(result.kind, 'invalid');
});