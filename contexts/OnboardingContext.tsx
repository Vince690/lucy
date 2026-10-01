/**
 * OnboardingContext — réponses du parcours d'onboarding (identité + quiz introspectif).
 *
 * Remplace la chaîne de params de navigation (fragile sur 15 écrans). Les réponses sont
 * persistées dans AsyncStorage : si l'app est fermée à la question 8, l'utilisateur
 * reprend à la question 8 (via firstIncompleteRoute depuis « C'est parti ? »).
 *
 * Vidé (resetAnswers) à la complétion de l'onboarding, au bout du slider « faire
 * connaissance » (utils/onboardingCompletion.ts). Les réponses du quiz nourrissent le
 * reveal personnalisé, puis partent dans `profiles.onboarding_answers` pour Lucy.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import type { TraitKey } from '@/utils/lucyMemoryOnboarding';

export interface OnboardingAnswers {
  // Identité
  firstName?: string;
  /** Format YYYY-MM-DD */
  dateOfBirth?: string;
  gender?: string;
  timezone?: string;
  // Quiz introspectif (clés d'options des locales onboarding:quiz.*)
  traits?: TraitKey[];
  mood?: string;
  energy?: string;
  concerns?: string[];
  stress?: string;
  /** À qui l'utilisateur peut parler quand quelque chose l'embête. */
  talkTo?: string;
  /** Facilité à se confier. */
  openness?: string;
  goals?: string[];
  pride?: string[];
  understood?: string[];
}

// v3 : réponses enveloppées avec le user_id de leur auteur ({ userId, answers }) —
// purgées si le compte ne correspond plus (suppression/recréation de compte).
const STORAGE_KEY = 'onboarding_answers_v3';

/**
 * Valide chaque champ relu depuis AsyncStorage : un ancien format ou une valeur
 * corrompue est simplement ignorée (la question sera reposée) plutôt que de planter.
 */
function sanitizeStoredAnswers(raw: unknown): OnboardingAnswers {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const strArr = (v: unknown) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')
      ? (v as string[])
      : undefined;
  return {
    firstName: str(r.firstName),
    dateOfBirth: str(r.dateOfBirth),
    gender: str(r.gender),
    timezone: str(r.timezone),
    traits: strArr(r.traits) as OnboardingAnswers['traits'],
    mood: str(r.mood),
    energy: str(r.energy),
    concerns: strArr(r.concerns),
    stress: str(r.stress),
    talkTo: str(r.talkTo),
    openness: str(r.openness),
    goals: strArr(r.goals),
    pride: strArr(r.pride),
    understood: strArr(r.understood),
  };
}

interface OnboardingContextValue {
  answers: OnboardingAnswers;
  /** false tant que la relecture AsyncStorage n'a pas abouti. */
  hydrated: boolean;
  setAnswer: <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => void;
  resetAnswers: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  // Hydratation LIÉE AU COMPTE : les réponses persistées portent le user_id de leur
  // auteur. Si elles appartiennent à un autre compte (compte supprimé puis recréé,
  // changement d'utilisateur sur le même téléphone), on les PURGE : l'onboarding
  // reprend proprement du début au lieu d'hériter de réponses orphelines.
  useEffect(() => {
    if (!userId) return;
    hydratedRef.current = false;
    setHydrated(false);
    setAnswers({});
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as { userId?: unknown; answers?: unknown };
        if (parsed && parsed.userId === userId) {
          setAnswers(sanitizeStoredAnswers(parsed.answers));
        } else {
          AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
        }
      })
      .catch((err) => console.error('[onboarding] answers hydration failed:', err))
      .finally(() => {
        hydratedRef.current = true;
        setHydrated(true);
      });
  }, [userId]);

  // Persistance à chaque changement (après hydratation, pour ne pas écraser avec {}).
  useEffect(() => {
    if (!hydratedRef.current || !userId) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, answers })).catch((err) =>
      console.error('[onboarding] answers persist failed:', err),
    );
  }, [answers, userId]);

  const setAnswer = useCallback(
    <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => {
      setAnswers((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetAnswers = useCallback(() => {
    setAnswers({});
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  return (
    <OnboardingContext.Provider value={{ answers, hydrated, setAnswer, resetAnswers }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding doit être utilisé sous <OnboardingProvider>');
  }
  return ctx;
}
