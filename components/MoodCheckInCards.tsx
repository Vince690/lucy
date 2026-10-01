import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageBackground, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MOOD_LEVELS, type MoodLevel } from '@/constants/moods';

/** Cotes de la maquette Figma « Chat v6 — rangée calée sur les bulles ». */
export const MOOD_CARD_WIDTH = 112;
export const MOOD_CARD_HEIGHT = 72;
const GAP = 8;
const STEP = MOOD_CARD_WIDTH + GAP;
/** Marge des bulles du fil : la rangée part à l'aplomb des bulles de Lucy et passe sous le bord de l'écran. */
const EDGE = 20;
/**
 * La carte « au milieu » est celle de la deuxième fente à l'écran (le milieu
 * des trois visibles) : elle grandit un peu, les autres restent à leur taille.
 * Son centre, mesuré depuis le bord gauche de l'écran.
 */
const FOCUS_CENTER = EDGE + STEP + MOOD_CARD_WIDTH / 2;
/** Taille de la carte au milieu : à peine plus grande, elle ne recouvre pas ses voisines (3,4 pt de chaque côté sur 8 d'écart). */
const FOCUS_SCALE = 1.06;
/**
 * Marge avant la première carte : une fente vide, pour que « Dur » puisse
 * aussi venir au milieu. Le défilement vaut alors i × STEP quand la carte i
 * est au milieu. La marge de droite se déduit de la largeur de l'écran pour
 * que « Au top » au milieu soit exactement la fin du contenu.
 */
const PAD_LEFT = EDGE + STEP;
/** « Moyen », la neutre, au milieu à l'ouverture : « Dur » dépasse de 12 pt à gauche, « Au top » de 22 pt à droite. */
const INITIAL_INDEX = 2;
/** Un peu d'air sous la question de Lucy. */
const TOP_ROOM = 8;
/** La carte en focus, puis la carte choisie, grandissent : 4 pt de chaque côté pour ne pas être rognées. */
const VERTICAL_ROOM = 5;
/** Temps laissé à la carte touchée pour se mettre en avant avant que le fil ne l'emporte. */
const SELECT_HOLD_MS = 320;

interface MoodCheckInCardsProps {
  /** Appelé une fois la mise en avant jouée : l'écran enregistre, retire la rangée et envoie. */
  onSelect: (mood: number) => void;
}

/**
 * La rangée de cartes sous la question de Lucy, lue comme une réponse
 * suggérée : calée à gauche sur les bulles de Lucy, cinq cartes de même
 * taille, à plat, coupées par le bord de l'écran comme une bulle trop longue.
 * Trois cartes tiennent à l'écran, un bout de la quatrième invite à glisser.
 *
 * La carte du milieu est légèrement plus grande et le défilement se cale sur
 * la carte suivante : un magnétisme léger, qui accompagne le geste sans le
 * retenir. La taille de chaque carte se déduit de la seule position de
 * défilement, sur le fil d'animation, sans rendu React pendant le geste.
 *
 * Un toucher sur la carte du milieu envoie : elle se met en avant, les
 * autres s'effacent, puis l'écran reprend la main. Un toucher sur une autre
 * carte l'amène au milieu : on ne peut pas envoyer une humeur en voulant
 * juste la regarder.
 */
export function MoodCheckInCards({ onSelect }: MoodCheckInCardsProps) {
  const { t } = useTranslation('mood');
  const { width: screenWidth } = useWindowDimensions();
  const padRight = Math.max(EDGE, screenWidth - PAD_LEFT - MOOD_CARD_WIDTH);
  const [selected, setSelected] = useState<number | null>(null);
  const lockedRef = useRef(false);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(INITIAL_INDEX * STEP);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const handlePress = useCallback((index: number) => {
    if (lockedRef.current) return;
    const atFocus = Math.round(scrollX.value / STEP) === index;
    if (!atFocus) {
      Haptics.selectionAsync().catch(() => {});
      scrollRef.current?.scrollTo({ x: index * STEP, animated: true });
      return;
    }
    lockedRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSelected(index);
    setTimeout(() => onSelect(MOOD_LEVELS[index].level), SELECT_HOLD_MS);
  }, [onSelect, scrollRef, scrollX]);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(180)}
      style={styles.bleed}
    >
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.track, { paddingRight: padRight }]}
        contentOffset={{ x: INITIAL_INDEX * STEP, y: 0 }}
        // Magnétisme : l'arrêt se cale sur une carte, la décélération courte
        // fait qu'une pichenette amène à la suivante sans aller plus loin.
        snapToInterval={STEP}
        snapToAlignment="start"
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={selected === null}
      >
        {MOOD_LEVELS.map((level, index) => (
          <MoodCard
            key={level.level}
            index={index}
            level={level}
            label={t(`levels.${level.level}`)}
            scrollX={scrollX}
            state={selected === null ? 'idle' : selected === index ? 'chosen' : 'faded'}
            onPress={handlePress}
          />
        ))}
      </Animated.ScrollView>
    </Animated.View>
  );
}

interface MoodCardProps {
  index: number;
  level: MoodLevel;
  label: string;
  scrollX: SharedValue<number>;
  state: 'idle' | 'chosen' | 'faded';
  onPress: (index: number) => void;
}

const MoodCard = React.memo(function MoodCard({ index, level, label, scrollX, state, onPress }: MoodCardProps) {
  // Mise en avant au choix : un léger bond, les autres s'effacent.
  const emphasis = useSharedValue(1);
  const dim = useSharedValue(1);

  React.useEffect(() => {
    if (state === 'chosen') {
      emphasis.value = withSpring(1.06, { damping: 14, stiffness: 220 });
    } else if (state === 'faded') {
      dim.value = withTiming(0.35, { duration: 200 });
    }
  }, [state, emphasis, dim]);

  // Centre de la carte dans le contenu ; sa distance au milieu donne sa taille.
  const center = PAD_LEFT + index * STEP + MOOD_CARD_WIDTH / 2;
  const cardStyle = useAnimatedStyle(() => {
    const distance = Math.abs(center - scrollX.value - FOCUS_CENTER);
    const focus = interpolate(distance, [0, STEP], [FOCUS_SCALE, 1], Extrapolation.CLAMP);
    return {
      opacity: dim.value,
      transform: [{ scale: focus * emphasis.value }],
    };
  });

  return (
    <Animated.View style={[styles.card, state === 'chosen' && styles.cardChosen, cardStyle]}>
      <Pressable
        onPress={() => onPress(index)}
        style={styles.pressable}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <ImageBackground source={level.card} style={styles.cardImage} imageStyle={styles.cardImageInner}>
          <Text style={styles.emoji}>{level.emoji}</Text>
          <Text style={styles.label}>{label}</Text>
        </ImageBackground>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  bleed: {
    marginHorizontal: -EDGE,
    marginTop: TOP_ROOM,
  },
  track: {
    paddingLeft: PAD_LEFT,
    paddingVertical: VERTICAL_ROOM,
    gap: GAP,
  },
  card: {
    width: MOOD_CARD_WIDTH,
    height: MOOD_CARD_HEIGHT,
    borderRadius: 18,
    // Fond opaque sous l'image, le temps que l'image se charge.
    backgroundColor: '#FFFFFF',
  },
  // La carte choisie grandit encore un peu : elle passe devant ses voisines.
  cardChosen: {
    zIndex: 1,
  },
  pressable: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  cardImage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  cardImageInner: {
    borderRadius: 18,
  },
  emoji: {
    fontSize: 24,
    lineHeight: 30,
  },
  label: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
