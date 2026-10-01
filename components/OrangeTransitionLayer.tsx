/**
 * Couche du voile orange du groupe (app) — voir utils/orangeTransition.ts.
 *
 * Deux animations, mêmes timings que les portes de l'onboarding (start, meet) :
 *   - arrivée : plein écran orange, opacité 1 → 0 en 420 ms, dès le montage si
 *     une arrivée a été demandée (fin du slider « faire connaissance ») ;
 *   - zoom : un disque orange qui grossit depuis le bouton Envoyer jusqu'à couvrir
 *     l'écran en 480 ms, puis rappelle l'appelant pour qu'il navigue. Le disque
 *     reste posé : l'écran suivant apparaît dessous, avec son propre voile.
 *
 * Posée en dernier enfant de la mise en page, elle passe au-dessus du header et
 * du fil. `pointerEvents="none"` : elle ne capte jamais un toucher.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { OnbColors } from '@/constants/onboardingTheme';
import {
  consumeOrangeArrival,
  subscribeOrangeZoom,
  type ZoomOrigin,
} from '@/utils/orangeTransition';

export function OrangeTransitionLayer() {
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [arrival] = useState(() => consumeOrangeArrival());
  const veil = useSharedValue(arrival ? 1 : 0);
  const [zoomOrigin, setZoomOrigin] = useState<ZoomOrigin | null>(null);
  const zoom = useSharedValue(0);

  useEffect(() => {
    if (!arrival) return;
    if (reduced) {
      veil.value = 0;
      return;
    }
    veil.value = withDelay(30, withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) }));
  }, [arrival, reduced, veil]);

  useEffect(() => {
    return subscribeOrangeZoom((origin, onCovered) => {
      if (reduced) {
        // Pas de disque : le voile plein écran se pose, puis on navigue.
        veil.value = 1;
        onCovered();
        return;
      }
      setZoomOrigin(origin);
      zoom.value = 0;
      zoom.value = withTiming(1, { duration: 480, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onCovered)();
      });
    });
  }, [reduced, veil, zoom]);

  // Échelle qui amène le disque à couvrir le coin le plus lointain.
  const maxScale = zoomOrigin
    ? (2 *
        Math.hypot(
          Math.max(zoomOrigin.x, W - zoomOrigin.x),
          Math.max(zoomOrigin.y, H - zoomOrigin.y),
        )) /
        zoomOrigin.size +
      0.5
    : 1;

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + zoom.value * (maxScale - 1) }],
  }));

  return (
    <>
      {zoomOrigin && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.disc,
            {
              width: zoomOrigin.size,
              height: zoomOrigin.size,
              borderRadius: zoomOrigin.size / 2,
              left: zoomOrigin.x - zoomOrigin.size / 2,
              top: zoomOrigin.y - zoomOrigin.size / 2,
            },
            zoomStyle,
          ]}
        />
      )}
      {arrival && <Animated.View pointerEvents="none" style={[styles.veil, veilStyle]} />}
    </>
  );
}

const styles = StyleSheet.create({
  disc: {
    position: 'absolute',
    backgroundColor: OnbColors.primary,
    zIndex: 50,
    elevation: 50,
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OnbColors.primary,
    zIndex: 60,
    elevation: 60,
  },
});
