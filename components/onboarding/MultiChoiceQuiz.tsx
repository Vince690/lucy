/**
 * MultiChoiceQuiz — écran de quiz multi-choix (≥ 1), pilules en rangées centrées,
 * disposition dense (titre haut + zone centrée). `exclusiveKey` (ex. « Rien de spécial »)
 * désélectionne tout le reste quand on la choisit, et inversement.
 *
 * Si les pilules dépassent la hauteur disponible, la zone devient DÉFILANTE et deux
 * voiles dégradés (plafond sous le sous-titre / plancher au-dessus du CTA) laissent
 * les pilules glisser dessous sans jamais mordre sur le reste de l'écran.
 *
 * Affordance de défilement : selon la résolution, la dernière rangée visible peut
 * tomber PILE au-dessus du voile (aucune pilule coupée) — rien n'indique alors qu'il
 * reste des options dessous. Un petit chevron respire au bas de la zone tant qu'il
 * y a du contenu caché, et s'efface dès qu'on approche du bas.
 */

import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronDown } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  useReducedMotion,
  cancelAnimation,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import QuestionScreenLayout from '@/components/onboarding/QuestionScreenLayout';
import ChoicePill from '@/components/onboarding/ChoicePill';
import { useOnboarding, type OnboardingAnswers } from '@/contexts/OnboardingContext';
import { useOnboardingBack } from '@/utils/onboardingNav';
import { genderContext } from '@/utils/i18n';
import { OnbColors } from '@/constants/onboardingTheme';
import { useQuizAnalytics } from '@/utils/onboardingAnalytics';

/** Clés de réponse à valeur « multi-choix » (string[]). */
type MultiChoiceKey = 'concerns' | 'goals' | 'pride' | 'understood';

interface MultiChoiceQuizProps {
  step: number;
  /** Bloc de locales onboarding:quiz.<quizKey> (title + hint + options.*) */
  quizKey: string;
  answerKey: MultiChoiceKey;
  optionKeys: readonly string[];
  nextRoute: string;
  /** Option exclusive : la choisir vide le reste, choisir autre chose la retire. */
  exclusiveKey?: string;
  /** Plafond de sélections (les autres pilules se grisent une fois atteint). */
  maxSelections?: number;
}

export default function MultiChoiceQuiz({
  step,
  quizKey,
  answerKey,
  optionKeys,
  nextRoute,
  exclusiveKey,
  maxSelections,
}: MultiChoiceQuizProps) {
  const router = useRouter();
  const { t } = useTranslation(['onboarding']);
  const { answers, setAnswer } = useOnboarding();
  const goBack = useOnboardingBack(step);
  const stored = answers[answerKey];
  const [selected, setSelected] = useState<string[]>(Array.isArray(stored) ? stored : []);
  const gctx = genderContext(answers.gender);
  const { trackOption, trackCompleted } = useQuizAnalytics(step, quizKey, true);

  // Voiles affichés seulement si les pilules débordent réellement de la zone.
  //
  // On mesure la hauteur des PILULES, pas celle du conteneur de défilement : ce
  // dernier inclut son padding vertical, lequel suffisait à déclencher un faux
  // débordement sur les écrans à 8-10 options. Le chevron apparaissait alors sans
  // rien à révéler, et le voile mordait sur la dernière rangée.
  // Mesurer le contenu nu retire aussi toute boucle possible (le padding ne peut
  // plus influer sur la décision qui le fait apparaître).
  const [zoneHeight, setZoneHeight] = useState(0);
  const [pillsHeight, setPillsHeight] = useState(0);
  const overflows = pillsHeight > zoneHeight + 1;

  // Chevron d'affordance : visible tant qu'il reste du contenu sous le pli.
  const reduced = useReducedMotion();
  const [nearBottom, setNearBottom] = useState(false);
  const showHint = overflows && !nearBottom;
  const hintBob = useSharedValue(0);
  const hintFade = useSharedValue(0);

  useEffect(() => {
    hintFade.value = withTiming(showHint ? 1 : 0, { duration: 250 });
    if (showHint && !reduced) {
      // Respiration lente et continue (phase → sinus : boucle sans couture).
      hintBob.value = 0;
      hintBob.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(hintBob);
      hintBob.value = 0;
    }
    return () => cancelAnimation(hintBob);
  }, [showHint, reduced, hintBob, hintFade]);

  const hintStyle = useAnimatedStyle(() => ({
    opacity: hintFade.value * (0.55 + 0.25 * Math.sin(2 * Math.PI * hintBob.value)),
    transform: [{ translateY: 2.5 * Math.sin(2 * Math.PI * hintBob.value) }],
  }));

  const toggle = (key: string, position: number) => {
    // Le prochain état est calculé HORS de l'updater de setSelected : React est
    // libre d'appeler un updater plusieurs fois pour la même mise à jour, ce qui
    // émettrait l'événement en double et gonflerait le classement des options.
    const wasSelected = selected.includes(key);
    let next: string[];
    if (wasSelected) {
      next = selected.filter((k) => k !== key);
    } else if (key === exclusiveKey) {
      next = [key];
    } else if (maxSelections !== undefined && selected.length >= maxSelections) {
      // Plafond atteint : l'appui ne change rien, il n'est donc pas mesuré.
      // Une pilule grisée n'est pas un choix, et la compter fausserait le
      // classement des options en faveur des écrans plafonnés.
      return;
    } else {
      next = [...selected.filter((k) => k !== exclusiveKey), key];
    }
    trackOption(key, position, wasSelected, next.length);
    setSelected(next);
  };

  const handleContinue = () => {
    if (selected.length === 0) return;
    trackCompleted(selected.length);
    setAnswer(answerKey as keyof OnboardingAnswers, selected as never);
    router.push(nextRoute as never);
  };

  return (
    <QuestionScreenLayout
      step={step}
      title={t(`onboarding:quiz.${quizKey}.title`, { context: gctx })}
      subtitle={t(`onboarding:quiz.${quizKey}.hint`)}
      dense
      continueLabel={t('onboarding:continue')}
      continueDisabled={selected.length === 0}
      onContinue={handleContinue}
      onBack={goBack}
    >
      <View style={styles.scrollZone}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          onLayout={(e) => setZoneHeight(e.nativeEvent.layout.height)}
          onScroll={(e) => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            setNearBottom(contentOffset.y + layoutMeasurement.height >= contentSize.height - 20);
          }}
          scrollEventThrottle={48}
          contentContainerStyle={[styles.scrollContent, !overflows && styles.scrollCentered]}
        >
          <View
            style={styles.pillsWrap}
            onLayout={(e) => setPillsHeight(e.nativeEvent.layout.height)}
          >
            {optionKeys.map((key, index) => {
              const isSelected = selected.includes(key);
              const isDisabled =
                maxSelections !== undefined && !isSelected && selected.length >= maxSelections;
              return (
                <ChoicePill
                  key={key}
                  label={t(`onboarding:quiz.${quizKey}.options.${key}`, { context: gctx })}
                  selected={isSelected}
                  disabled={isDisabled}
                  onPress={() => toggle(key, index + 1)}
                />
              );
            })}
          </View>
        </ScrollView>

        {overflows && (
          <>
            <LinearGradient
              colors={[OnbColors.bg, 'rgba(255,255,255,0)']}
              style={[styles.fade, styles.fadeTop]}
              pointerEvents="none"
            />
            <LinearGradient
              colors={['rgba(255,255,255,0)', OnbColors.bg]}
              style={[styles.fade, styles.fadeBottom]}
              pointerEvents="none"
            />
            <Animated.View pointerEvents="none" style={[styles.scrollHint, hintStyle]}>
              <ChevronDown size={18} color={OnbColors.mutedLight} strokeWidth={2.2} />
            </Animated.View>
          </>
        )}
      </View>
    </QuestionScreenLayout>
  );
}

const styles = StyleSheet.create({
  scrollZone: {
    flex: 1,
    marginTop: 18,
  },
  scrollContent: {
    // Marge qui laisse les pilules glisser sous les voiles quand ça défile.
    paddingVertical: 26,
  },
  scrollCentered: {
    flexGrow: 1,
    justifyContent: 'center',
    // Sans défilement, il n'y a pas de voile sous lequel glisser : ce padding ne
    // servirait qu'à rapprocher les pilules des bords de la zone. Le retirer est
    // sans risque de boucle, `overflows` se mesurant sur les pilules nues.
    paddingVertical: 0,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 30,
  },
  fadeTop: {
    top: 0,
  },
  fadeBottom: {
    bottom: 0,
  },
  scrollHint: {
    position: 'absolute',
    bottom: 1,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
