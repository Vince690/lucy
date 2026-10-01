/**
 * « Quelqu'un a hâte de faire ta connaissance. » — l'annonce de la rencontre.
 *
 * Écran blanc, titre qui apparaît très lentement, puis un geste : une petite âme
 * orange posée à gauche d'une piste, que l'on fait glisser jusqu'au bout pour
 * rencontrer Lucy. Le glissement est un engagement physique (on VA vers elle) ;
 * l'âme s'intensifie à mesure qu'on approche, des tics haptiques ponctuent le
 * trajet, et l'arrivée déclenche le voile orange (même vocabulaire que « C'est
 * parti ? » : les deux portes du parcours se répondent).
 *
 * C'est ICI que l'onboarding se termine (depuis le 23 septembre 2026) : pendant que
 * le voile couvre l'écran, le profil est écrit, la mémoire de Lucy amorcée, puis la
 * VRAIE app s'ouvre dessous, chat en premier. Plus de faux chat cloisonné : la
 * personne rencontre vraiment Lucy, avec cinq échanges offerts avant le paywall
 * (voir constants/chatGate.ts). Si l'écriture du profil échoue, le voile se retire
 * et le slider revient au départ pour réessayer.
 */

import React, { useCallback, useState } from 'react';
import { Alert, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  runOnJS,
  Easing,
  useReducedMotion,
  interpolate,
} from 'react-native-reanimated';
import { ChevronRight } from 'lucide-react-native';
import AmbientAura from '@/components/onboarding/AmbientAura';
import { OnbColors, OnbSpacing, OnbShadow, OnbType } from '@/constants/onboardingTheme';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { completeOnboarding } from '@/utils/onboardingCompletion';
import { requestOrangeArrival } from '@/utils/orangeTransition';

const TRACK_HEIGHT = 68;
const TRACK_PAD = 6;
const ORB_SIZE = TRACK_HEIGHT - TRACK_PAD * 2;
const AURA_SIZE = 190;

export default function MeetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { user, updateProfile } = useAuth();
  const { answers, resetAnswers } = useOnboarding();

  const [zooming, setZooming] = useState(false);

  const trackWidth = W - OnbSpacing.screenX * 2;
  const maxTx = trackWidth - TRACK_PAD * 2 - ORB_SIZE;

  const tx = useSharedValue(0);
  const done = useSharedValue(false);
  const lastTick = useSharedValue(0);
  const hintPulse = useSharedValue(0);
  const zoom = useSharedValue(0);

  // Géométrie du voile de zoom : il naît au centre de l'âme, en fin de piste.
  const trackBottom = Math.max(insets.bottom, OnbSpacing.screenBottom) + 48;
  const orbEndCenterX = OnbSpacing.screenX + TRACK_PAD + maxTx + ORB_SIZE / 2;
  const orbCenterY = H - trackBottom - TRACK_HEIGHT / 2;
  const maxScale =
    (2 * Math.hypot(Math.max(orbEndCenterX, W - orbEndCenterX), orbCenterY)) / ORB_SIZE + 0.5;

  React.useEffect(() => {
    if (reduced) return;
    // Le texte de la piste « respire » doucement tant qu'on n'a pas commencé à glisser.
    hintPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [reduced, hintPulse]);

  /** Le voile a couvert l'écran (ou pas d'animation) : on attend le profil. */
  const coveredRef = React.useRef(false);
  /** Résultat de l'écriture du profil, quand elle est arrivée avant le voile. */
  const completionRef = React.useRef<'pending' | 'ok' | 'failed'>('pending');

  const enterApp = useCallback(() => {
    // La couche du groupe (app) consomme la demande à son montage et dissout le
    // voile en 420 ms, comme gift le faisait après first-chat.
    requestOrangeArrival();
    router.replace('/(app)');
  }, [router]);

  const retreat = useCallback(() => {
    // Profil pas écrit : rien n'ouvre l'app. Le voile se retire, le slider repart
    // du début, et la personne peut réessayer (idempotent côté serveur).
    completionRef.current = 'pending';
    coveredRef.current = false;
    zoom.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(setZooming)(false);
    });
    done.value = false;
    lastTick.value = 0;
    tx.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) });
    Alert.alert(t('onboarding:errorGeneric'));
  }, [zoom, done, lastTick, tx, t]);

  /** Appelé deux fois — fin du voile, fin de l'écriture — et n'agit qu'à la seconde. */
  const settle = useCallback(() => {
    if (!coveredRef.current || completionRef.current === 'pending') return;
    if (completionRef.current === 'ok') enterApp();
    else retreat();
  }, [enterApp, retreat]);

  const onCovered = useCallback(() => {
    coveredRef.current = true;
    settle();
  }, [settle]);

  const complete = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // L'écriture part tout de suite, en parallèle du voile : dans le cas courant
    // elle est finie avant que l'écran soit couvert, et l'app s'ouvre sans attente.
    (async () => {
      let ok = false;
      if (user?.id) {
        try {
          const result = await completeOnboarding({ userId: user.id, answers, updateProfile });
          ok = result.ok;
        } catch (err) {
          console.error('[meet] completeOnboarding :', err);
        }
      }
      if (ok) resetAnswers();
      completionRef.current = ok ? 'ok' : 'failed';
      settle();
    })();

    if (reduced) {
      onCovered();
      return;
    }
    setZooming(true);
    // Mêmes timings que le zoom du bouton Envoyer du chat : les deux voiles du
    // parcours doivent être indiscernables (l'arrivée dissout le voile en 420 ms).
    zoom.value = withTiming(1, { duration: 480, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onCovered)();
    });
  }, [reduced, onCovered, settle, zoom, user?.id, answers, updateProfile, resetAnswers]);

  const tick = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const pan = Gesture.Pan()
    .enabled(!zooming)
    .onChange((e) => {
      if (done.value) return;
      tx.value = Math.min(Math.max(tx.value + e.changeX, 0), maxTx);
      // Tics haptiques tous les quarts de trajet — on « sent » l'approche.
      const quarter = Math.floor((tx.value / maxTx) * 4);
      if (quarter > lastTick.value) {
        lastTick.value = quarter;
        runOnJS(tick)();
      }
    })
    .onEnd((e) => {
      if (done.value) return;
      if (tx.value > maxTx * 0.82) {
        done.value = true;
        tx.value = withTiming(maxTx, { duration: 140, easing: Easing.out(Easing.quad) });
        runOnJS(complete)();
      } else {
        // Relâché trop tôt : retour DÉTERMINISTE (plus de ressort dont l'amplitude
        // dépendait de la position et de la vitesse). Élan avant optionnel si on
        // glissait encore, retour au départ, puis très léger creux élastique FIXE
        // de 3 px — strictement dans le coussin de la piste (TRACK_PAD = 6) :
        // le bord n'est jamais touché, aucun clamp visuel nécessaire.
        lastTick.value = 0;
        const start = tx.value;
        // ~60 ms d'élan à la vitesse de relâchement, borné à 26 px.
        const fwd = Math.min((Math.max(e.velocityX, 0) * 60) / 1000, 26);
        const back = withSequence(
          withTiming(-3, { duration: 380, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 240, easing: Easing.out(Easing.quad) }),
        );
        if (fwd > 3) {
          tx.value = withSequence(
            withTiming(Math.min(start + fwd, maxTx * 0.8), {
              duration: 100,
              easing: Easing.out(Easing.quad),
            }),
            back,
          );
        } else {
          tx.value = back;
        }
      }
    });

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  // L'âme s'éveille à mesure qu'on la rapproche du but.
  const auraStyle = useAnimatedStyle(() => {
    const p = maxTx > 0 ? tx.value / maxTx : 0;
    return {
      opacity: 0.4 + 0.6 * p,
      transform: [{ scale: 1 + 0.5 * p }],
    };
  });

  const hintStyle = useAnimatedStyle(() => {
    const p = maxTx > 0 ? tx.value / maxTx : 0;
    return {
      // Respiration au repos, effacement dès qu'on glisse.
      opacity: (0.55 + 0.25 * hintPulse.value) * interpolate(p, [0, 0.45], [1, 0], 'clamp'),
    };
  });

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + zoom.value * (maxScale - 1) }],
  }));

  const enter = (delay: number, duration: number) =>
    reduced ? FadeIn.duration(0) : FadeIn.delay(delay).duration(duration);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Animated.Text
          entering={enter(500, 1700)}
          style={[styles.title, { marginTop: H * 0.26 }]}
        >
          {t('onboarding:meet.title')}
        </Animated.Text>
      </SafeAreaView>

      <Animated.View
        entering={reduced ? FadeIn.duration(0) : FadeInDown.delay(1900).duration(800)}
        style={[styles.sliderWrap, { bottom: trackBottom, left: OnbSpacing.screenX }]}
      >
        <View style={[styles.track, { width: trackWidth }]}>
          <Animated.Text style={[styles.hint, hintStyle]} numberOfLines={1}>
            {t('onboarding:meet.hint')}
          </Animated.Text>

          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.orbWrap, orbStyle]}>
              <Animated.View pointerEvents="none" style={[styles.aura, auraStyle]}>
                <AmbientAura alive size={AURA_SIZE} intensity={0.5} />
              </Animated.View>
              <View style={styles.orb}>
                <ChevronRight size={26} color={OnbColors.white} strokeWidth={2.6} />
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>

      {/* Voile orange : naît au centre de l'âme arrivée au bout, couvre l'écran. */}
      {zooming && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.zoomDisc,
            {
              left: orbEndCenterX - ORB_SIZE / 2,
              top: orbCenterY - ORB_SIZE / 2,
            },
            zoomStyle,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OnbColors.bg,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: OnbSpacing.screenX,
  },
  title: {
    ...OnbType.title,
    fontSize: 32,
    lineHeight: 42,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  sliderWrap: {
    position: 'absolute',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: OnbColors.selectedBg,
    borderWidth: 1,
    borderColor: OnbColors.primarySoft,
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    left: ORB_SIZE + TRACK_PAD,
    right: 16,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: OnbColors.primaryDeep,
  },
  orbWrap: {
    position: 'absolute',
    left: TRACK_PAD,
    width: ORB_SIZE,
    height: ORB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
    width: AURA_SIZE,
    height: AURA_SIZE,
    top: (ORB_SIZE - AURA_SIZE) / 2,
    left: (ORB_SIZE - AURA_SIZE) / 2,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: OnbColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...OnbShadow.button,
  },
  zoomDisc: {
    position: 'absolute',
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: OnbColors.primary,
  },
});
