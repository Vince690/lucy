/**
 * La pile de trois cartes sous les messages d'accueil de Lucy — des brouillons
 * de premier message, jamais imposés.
 *
 * Choisi par Vincent le 23 septembre 2026 (variante « Papier » de la maquette),
 * repris le 25 : carte blanche, bord gris, ombre douce, texte gris ; trois plans
 * empilés vers le haut, chacun un peu plus petit. Dans l'ordre : une classique,
 * une loufoque, une qui reprend le questionnaire (le premier objectif coché).
 *
 * Les mesures sont CELLES DU CHAT, pas celles d'une maquette à part : texte 16/22
 * et gris des bulles de Lucy, bordure 1,5 et arrondi 20 de la zone de saisie,
 * marges intérieures des bulles, largeur voisine de la largeur maximale d'une
 * bulle. Première version : texte 15, bord 1, arrondi 18, compteur « 1 / 3 » en
 * 10 — tout un cran plus fin que le reste de l'écran, ça se voyait. Le compteur
 * a disparu : la pile boucle, un numéro n'y veut rien dire. À sa place, un petit
 * chevron en bas à droite, au trait de l'avion du bouton Envoyer, qui dit « ça
 * se fait glisser ».
 *
 * Hauteur : celle du texte le plus long des trois (une copie invisible dans le
 * flux la mesure), les trois cartes la partagent — le même objet qui tourne.
 *
 * Geste : on glisse la carte du dessus à gauche ou à droite, elle passe sous la
 * pile et la suivante vient devant — les plans arrière avancent à mesure que le
 * doigt avance, sur le fil d'animation, sans rendu React pendant le geste. Un
 * appui remplit la barre de message ; l'écran retire alors la pile.
 *
 * Le glissé n'est pris qu'au-delà de 8 pt à l'horizontale : le fil, lui, garde
 * le défilement vertical.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronRight } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { OnboardingProfileAnswers } from '@/contexts/AuthContext';
import { track } from '@/utils/analytics';

/** Largeur : celle d'une bulle de Lucy au plus large (80 %), plafonnée. */
const CARD_MAX_WIDTH = 320;
const CARD_WIDTH_RATIO = 0.8;
/** Marges intérieures des bulles ; à droite, la place du chevron en plus. */
const CARD_PAD_X = 16;
const CARD_PAD_Y = 12;
const CHEVRON_SIZE = 18;
const CHEVRON_INSET = 10;
/** Hauteur avant mesure : deux lignes de 22, plus les marges. */
const FALLBACK_CARD_HEIGHT = 2 * 22 + 2 * CARD_PAD_Y;
/** Ce que les plans arrière dépassent au-dessus de la carte de devant. */
const BACK_ROOM = 26;
const TOP_ROOM = 10;

/** Position de chaque plan : devant (0), milieu (1), fond (2). */
const LAYERS = [
  { y: 0, s: 1 },
  { y: -12, s: 0.94 },
  { y: -22, s: 0.88 },
] as const;
/** Distance de glissé à laquelle les plans arrière ont fini d'avancer. */
const FOLLOW_DISTANCE = 140;
/** Au-delà, la carte part sous la pile ; en deçà, elle revient. */
const CYCLE_THRESHOLD = 70;
const EXIT_DISTANCE = 360;
const EXIT_MS = 260;
const SETTLE_MS = 420;

/** Objectifs pour lesquels « je veux {objectif} » ne fait pas une phrase. */
const GOALS_WITHOUT_CARD = new Set(['just_talk', 'someone_to_talk']);

export interface FirstMessageCard {
  key: 'classic' | 'wacky' | 'goal';
  text: string;
}

/** Les trois textes, dans l'ordre d'affichage. Exporté pour les tests. */
export function buildFirstMessageCards(
  t: (key: string, options?: Record<string, unknown>) => string,
  answers: OnboardingProfileAnswers | null | undefined,
  gender: string | null | undefined,
): FirstMessageCard[] {
  const goalKey = answers?.goals?.find((g) => typeof g === 'string' && !GOALS_WITHOUT_CARD.has(g));
  let goalText = t('chat:firstCards.goalFallback');
  if (goalKey) {
    const label = t(`onboarding:quiz.goals.options.${goalKey}`, {
      context: gender === 'female' ? 'female' : undefined,
      defaultValue: '',
    });
    if (label) {
      const lowered = label.charAt(0).toLowerCase() + label.slice(1);
      goalText = t('chat:firstCards.goal', { goal: lowered });
    }
  }
  return [
    { key: 'classic', text: t('chat:firstCards.classic') },
    { key: 'wacky', text: t('chat:firstCards.wacky') },
    { key: 'goal', text: goalText },
  ];
}

interface FirstMessageDeckProps {
  answers: OnboardingProfileAnswers | null | undefined;
  gender: string | null | undefined;
  /** Carte touchée : le texte va dans la barre, la pile disparaît. */
  onPick: (text: string, card: FirstMessageCard, index: number) => void;
}

export function FirstMessageDeck({ answers, gender, onPick }: FirstMessageDeckProps) {
  const { t } = useTranslation(['chat', 'onboarding']);
  const { width: W } = useWindowDimensions();
  const cards = useMemo(() => buildFirstMessageCards(t, answers, gender), [t, answers, gender]);
  const cardWidth = Math.min(CARD_MAX_WIDTH, Math.round(W * CARD_WIDTH_RATIO));

  /**
   * Hauteur commune : celle du texte le plus long, mesuré par une copie
   * invisible posée dans le flux (les cartes, elles, sont hors flux). Le plus
   * long en caractères n'est pas toujours le plus haut, alors on mesure les trois
   * et on garde la plus grande.
   */
  const [measured, setMeasured] = useState<number[]>([]);
  const onMeasure = useCallback((index: number, e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setMeasured((prev) => {
      if (prev[index] === h) return prev;
      const next = [...prev];
      next[index] = h;
      return next;
    });
  }, []);
  const cardHeight = Math.max(FALLBACK_CARD_HEIGHT, ...measured.filter(Boolean));

  /** Indices des cartes, du plan de devant au fond. */
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  /** Glissé de la carte de devant, quelle qu'elle soit. */
  const dragX = useSharedValue(0);
  const layer0 = useSharedValue(0);
  const layer1 = useSharedValue(1);
  const layer2 = useSharedValue(2);
  const fade0 = useSharedValue(1);
  const fade1 = useSharedValue(1);
  const fade2 = useSharedValue(1);
  const layers = [layer0, layer1, layer2];
  const fades = [fade0, fade1, fade2];
  const [busy, setBusy] = useState(false);

  const cycle = useCallback(
    (direction: 1 | -1) => {
      setBusy(true);
      Haptics.selectionAsync().catch(() => {});
      const leaving = order[0];
      const next = [...order.slice(1), leaving];
      dragX.value = withTiming(direction * EXIT_DISTANCE, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }, (finished) => {
        if (!finished) return;
        // La carte partie revient par le fond, en fondu : ses voisines ont déjà
        // avancé pendant la sortie, elles ne bougent plus.
        fades[leaving].value = 0;
        layers[next[0]].value = 0;
        layers[next[1]].value = 1;
        layers[next[2]].value = 2;
        dragX.value = 0;
        fades[leaving].value = withTiming(1, { duration: SETTLE_MS });
        runOnJS(setOrder)(next);
        runOnJS(setBusy)(false);
      });
    },
    // Les valeurs partagées sont stables ; seul `order` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order],
  );

  const pick = useCallback(() => {
    const index = order[0];
    const card = cards[index];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    track('first_chat_suggestion_tapped', { suggestion_index: index + 1, suggestion_key: card.key });
    onPick(card.text, card, index);
  }, [order, cards, onPick]);

  const pan = Gesture.Pan()
    .enabled(!busy)
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > CYCLE_THRESHOLD) {
        runOnJS(cycle)(e.translationX > 0 ? 1 : -1);
      } else {
        dragX.value = withTiming(0, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
      }
    });
  const tap = Gesture.Tap()
    .enabled(!busy)
    .maxDistance(6)
    .onEnd(() => {
      runOnJS(pick)();
    });
  const gesture = Gesture.Exclusive(pan, tap);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(180)}
      style={[styles.wrap, { paddingTop: TOP_ROOM + BACK_ROOM }]}
      accessibilityRole="none"
    >
      {/* Copies invisibles, dans le flux : elles donnent la hauteur de la pile. */}
      <View
        style={{ width: cardWidth, minHeight: cardHeight }}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {cards.map((card, index) => (
          <View
            key={card.key}
            style={[styles.sizer, index > 0 && styles.sizerStacked]}
            onLayout={(e) => onMeasure(index, e)}
          >
            <Text style={styles.cardText}>{card.text}</Text>
          </View>
        ))}
      </View>

      {cards.map((card, index) => {
        const layerIndex = order.indexOf(index);
        const content = (
          <DeckCard
            key={card.key}
            text={card.text}
            width={cardWidth}
            height={cardHeight}
            layer={layers[index]}
            fade={fades[index]}
            dragX={dragX}
            zIndex={10 - layerIndex}
            front={layerIndex === 0}
            onPress={pick}
          />
        );
        return layerIndex === 0 ? (
          <GestureDetector key={card.key} gesture={gesture}>
            {content}
          </GestureDetector>
        ) : (
          content
        );
      })}
    </Animated.View>
  );
}

interface DeckCardProps {
  text: string;
  width: number;
  height: number;
  layer: SharedValue<number>;
  fade: SharedValue<number>;
  dragX: SharedValue<number>;
  zIndex: number;
  front: boolean;
  onPress: () => void;
}

const DeckCard = React.memo(function DeckCard({ text, width, height, layer, fade, dragX, zIndex, front, onPress }: DeckCardProps) {
  const style = useAnimatedStyle(() => {
    const l = layer.value;
    if (l === 0) {
      return {
        opacity: fade.value,
        transform: [
          { translateX: dragX.value },
          { translateY: LAYERS[0].y },
          { rotate: `${dragX.value / 18}deg` },
          { scale: LAYERS[0].s },
        ],
      };
    }
    // Les plans arrière glissent vers leur prochaine place à mesure que le doigt avance.
    const from = LAYERS[l as 1 | 2];
    const to = LAYERS[(l - 1) as 0 | 1];
    const p = interpolate(Math.abs(dragX.value), [0, FOLLOW_DISTANCE], [0, 1], 'clamp');
    return {
      opacity: fade.value,
      transform: [
        { translateY: from.y + (to.y - from.y) * p },
        { scale: from.s + (to.s - from.s) * p },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.card, { width, height, zIndex, elevation: zIndex }, style]}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessible={front}
      onAccessibilityTap={front ? onPress : undefined}
    >
      <Text style={styles.cardText}>{text}</Text>
      <View style={styles.chevron} pointerEvents="none">
        <ChevronRight size={CHEVRON_SIZE} color="#9CA3AF" strokeWidth={2} />
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginTop: TOP_ROOM,
    alignItems: 'center',
  },
  /** Même boîte que la carte, sans bord ni fond, pour mesurer le texte. */
  sizer: {
    opacity: 0,
    paddingHorizontal: CARD_PAD_X,
    paddingVertical: CARD_PAD_Y,
    // Le bord (1,5 de chaque côté) compte dans la hauteur de la carte.
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  /** Les copies suivantes se superposent à la première : une seule hauteur dans le flux. */
  sizerStacked: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  card: {
    position: 'absolute',
    bottom: 0,
    paddingHorizontal: CARD_PAD_X,
    paddingVertical: CARD_PAD_Y,
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    shadowColor: '#1F2937',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  cardText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#374151',
    // Le chevron vit dans le coin ; la dernière ligne ne passe pas dessous.
    paddingRight: CHEVRON_SIZE + CHEVRON_INSET - CARD_PAD_X + 6,
  },
  chevron: {
    position: 'absolute',
    right: CHEVRON_INSET,
    bottom: CHEVRON_INSET,
    width: CHEVRON_SIZE,
    height: CHEVRON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
