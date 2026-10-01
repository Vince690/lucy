/**
 * Navigation arrière des écrans d'onboarding.
 *
 * En reprise de parcours, « C'est parti ? » fait un router.replace direct vers la première
 * question sans réponse : la pile de navigation est alors VIDE et router.back() lève
 * « The action GO_BACK was not handled ». Repli : on navigue explicitement vers l'écran
 * précédent du flow (les réponses persistées le pré-remplissent).
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ONBOARDING_ROUTE_BY_STEP } from '@/constants/onboardingFlow';

export function useOnboardingBack(step: number): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    const previous = ONBOARDING_ROUTE_BY_STEP[step - 1];
    if (previous) {
      router.replace(previous as never);
    }
  }, [router, step]);
}
