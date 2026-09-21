import { useEffect, useRef, useState } from 'react';
import { Link, Stack } from 'expo-router';
import { useURL } from 'expo-linking';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { parseVivaBridgeResult } from '@/lib/vivaBridge';

export default function NotFoundScreen() {
  const colors = useColors();
  const incomingUrl = useURL();
  const processedUrl = useRef<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [retryUrl, setRetryUrl] = useState<string | null>(null);
  const isBridgeUrl = incomingUrl?.startsWith('bookie-viva-bridge:') ?? false;

  const openBridgeTarget = (url: string) => {
    setBridgeError(null);
    void Linking.openURL(url).catch(() => {
      setRetryUrl(url);
      setBridgeError(
        url.startsWith('vivapayclient:')
          ? 'Aplikacije Viva.com Terminal ni bilo mogoče odpreti. Preverite, ali je nameščena in prijavljena.'
          : 'Bookie POS-a ni bilo mogoče znova odpreti.',
      );
    });
  };

  useEffect(() => {
    if (!incomingUrl || !isBridgeUrl || processedUrl.current === incomingUrl) return;
    processedUrl.current = incomingUrl;
    const result = parseVivaBridgeResult(incomingUrl);
    if (result.kind === 'invalid') {
      setBridgeError(result.message);
      return;
    }
    const targetUrl = result.kind === 'launch' ? result.vivaDeepLinkUrl : result.returnUrl;
    setRetryUrl(targetUrl);
    openBridgeTarget(targetUrl);
  }, [incomingUrl, isBridgeUrl]);

  return (
    <>
      <Stack.Screen options={{ title: isBridgeUrl ? 'Viva Bridge' : 'Stran ne obstaja' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {isBridgeUrl
            ? bridgeError ?? 'Odpiram Viva.com Terminal…'
            : 'Ta zaslon ne obstaja.'}
        </Text>

        {bridgeError && retryUrl ? (
          <Pressable
            onPress={() => openBridgeTarget(retryUrl)}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
              Poskusi znova
            </Text>
          </Pressable>
        ) : null}

        {!isBridgeUrl || bridgeError ? (
          <Link href="/" style={styles.link}>
            <Text style={[styles.linkText, { color: colors.primary }]}>
              Pojdi na domači zaslon
            </Text>
          </Link>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
  button: {
    marginTop: 20,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
