import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useURL } from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { parseVivaBridgeResult } from '@/lib/vivaBridge';

type ScreenState =
  | { kind: 'ready' }
  | { kind: 'returning' }
  | { kind: 'error'; message: string; returnUrl?: string };

export default function BridgeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const incomingUrl = useURL();
  const processedUrl = useRef<string | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: 'ready' });

  const openUrlAndCloseBridge = async (url: string) => {
    await Linking.openURL(url);
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    }
  };

  useEffect(() => {
    if (!incomingUrl || processedUrl.current === incomingUrl) return;
    // Expo Go/dev client lahko ob običajnem zagonu poda svoj exp:// URL.
    // Obravnavaj samo URI-je, ki jih je namenoma poslal POS ali Viva.
    if (!incomingUrl.startsWith('bookie-viva-bridge:')) return;
    processedUrl.current = incomingUrl;
    const result = parseVivaBridgeResult(incomingUrl);
    if (result.kind === 'invalid') {
      setState({ kind: 'error', message: result.message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (result.kind === 'launch') {
      setState({ kind: 'returning' });
      openUrlAndCloseBridge(result.vivaDeepLinkUrl).catch(() => {
        setState({ kind: 'error', message: 'Viva.com Terminala ni bilo mogoče odpreti. Plačila ne ponavljajte.' });
      });
      return;
    }

    setState({ kind: 'returning' });
    void Haptics.notificationAsync(
      result.kind === 'approved'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );
    openUrlAndCloseBridge(result.returnUrl).catch(() => {
      setState({
        kind: 'error',
        message: 'Bookie POS-a ni bilo mogoče odpreti. Plačila ne ponavljajte.',
        returnUrl: result.returnUrl,
      });
    });
  }, [incomingUrl]);

  const retryReturn = () => {
    if (state.kind !== 'error' || !state.returnUrl) return;
    setState({ kind: 'returning' });
    void openUrlAndCloseBridge(state.returnUrl).catch(() => {
      setState(state);
    });
  };

  const isWaiting = state.kind === 'returning';
  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: Platform.OS === 'web' ? 67 : insets.top,
          paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom,
        },
      ]}
    >
      <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
        <Feather name="link-2" size={31} color={colors.primaryForeground} />
      </View>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>BOOKIE POS</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Viva Bridge</Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {isWaiting ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <Feather
            name={state.kind === 'error' ? 'alert-triangle' : 'shield'}
            size={32}
            color={state.kind === 'error' ? colors.destructive : colors.primary}
          />
        )}
        <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>
          {isWaiting
            ? 'Vračanje v Bookie POS'
            : state.kind === 'error'
              ? 'Povratek ni uspel'
              : 'Bridge je pripravljen'}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {isWaiting
            ? 'Rezultat plačila se varno predaja POS-u v strežniško preverjanje.'
            : state.kind === 'error'
              ? state.message
              : 'Aplikacija se samodejno odpre po zaključku plačila v Viva.com Terminalu.'}
        </Text>
        {state.kind === 'error' && state.returnUrl ? (
          <Pressable
            testID="retry-return"
            onPress={retryReturn}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Feather name="external-link" size={19} color={colors.primaryForeground} />
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Odpri Bookie POS</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.securityRow}>
        <Feather name="lock" size={15} color={colors.mutedForeground} />
        <Text style={[styles.securityText, { color: colors.mutedForeground }]}>
          Račun se izda šele po strežniški potrditvi Vive.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandMark: {
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  eyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 2.4,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    marginTop: 5,
    marginBottom: 26,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 13,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 19,
    textAlign: 'center',
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 20,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 22,
    maxWidth: 320,
  },
  securityText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
});