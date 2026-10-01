import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  Platform,
  ActivityIndicator,
  FlatList,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withSpring,
  withTiming,
  withDelay,
  FadeIn,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Line, Circle, Text as SvgText, Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { supabase, type MoodEntry as SupabaseMoodEntry } from '@/utils/supabase';
import { useFocusEffect } from 'expo-router';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { File as FSFile, Paths } from 'expo-file-system/next';
import { Share as ShareIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { track } from '@/utils/analytics';
import { maybeRequestReview, rememberTodayMood } from '@/utils/appReview';
import { MOOD_EMOJIS, MOOD_COLORS } from '@/constants/moods';
import {
  addCalendarDaysToYmd,
  diffCalendarDaysYmd,
  getMoodDateInTimezone,
  resolveUserTimezoneFromProfile,
  upsertUserMoodStat,
} from '@/utils/lucyMoodStats';

const { width: screenWidth } = Dimensions.get('window');

interface MoodEntry {
  date: string;
  mood: number;
  modified: boolean;
}

// Même identité que les cartes du chat : voir constants/moods.
const moodEmojis = MOOD_EMOJIS;
const moodColors = MOOD_COLORS;

// ── Gamification helpers ──────────────────────────────────────────────────────

/** Streak = jours consécutifs se terminant aujourd'hui ou hier (flamme non réinitialisée avant que l'utilisateur ait eu le temps de logger). */
function computeStreak(entries: MoodEntry[], timezone: string): number {
  const today = getMoodDateInTimezone(timezone);
  const dateSet = new Set(entries.map((e) => e.date));

  // Si l'utilisateur n'a pas encore loggé aujourd'hui, on part d'hier
  let checkDate = dateSet.has(today) ? today : addCalendarDaysToYmd(today, -1);

  let streak = 0;
  // Borne : une série ne peut pas compter plus de jours qu'il n'y a d'entrées.
  // Elle n'est jamais atteinte tant qu'addCalendarDaysToYmd recule vraiment —
  // mais cette boucle a déjà gelé l'app une fois, quand ce n'était pas le cas
  // aux fuseaux UTC+12 et au-delà. Un écran figé est le pire mode de panne
  // possible ; la garde le rend structurellement impossible.
  while (dateSet.has(checkDate) && streak < dateSet.size) {
    streak++;
    checkDate = addCalendarDaysToYmd(checkDate, -1);
  }
  return streak;
}

/** Score bien-être = moyenne des 7 derniers jours ramenée sur 100. Null si aucune entrée récente. */
function computeWellbeingScore(entries: MoodEntry[], timezone: string): number | null {
  const today = getMoodDateInTimezone(timezone);
  const recent = entries.filter((e) => {
    const diff = diffCalendarDaysYmd(e.date, today);
    return diff >= 0 && diff < 7;
  });
  if (recent.length === 0) return null;
  const avg = recent.reduce((sum, e) => sum + e.mood, 0) / recent.length;
  return Math.round((avg / 5) * 100);
}

// ── Badges ────────────────────────────────────────────────────────────────────

const BADGE_CARD_WIDTH = 80;
const BADGE_CARD_GAP = 32;
const BADGE_SNAP_INTERVAL = BADGE_CARD_WIDTH + BADGE_CARD_GAP;
// -40 = marges écran (20px × 2), le carousel occupe screenWidth - 40
const BADGE_SNAP_PADDING = (screenWidth - 40 - BADGE_CARD_WIDTH) / 2;
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

interface BadgeDef {
  id: string;
  emoji: string;
  priority: number;
  type: 'streak' | 'count' | 'mood5';
  threshold: number;
}

interface BadgeStatus {
  def: BadgeDef;
  unlocked: boolean;
  unlockDate?: string;
  progress: number; // 0–1
}

const BADGE_DEFS: BadgeDef[] = [
  { id: 'first',    emoji: '🌱', priority: 1, type: 'count',  threshold: 1  },
  { id: 'mood5',    emoji: '⭐', priority: 2, type: 'mood5',  threshold: 1  },
  { id: 'streak3',  emoji: '🔥', priority: 3, type: 'streak', threshold: 3  },
  { id: 'count10',  emoji: '📅', priority: 4, type: 'count',  threshold: 10 },
  { id: 'streak7',  emoji: '🏆', priority: 5, type: 'streak', threshold: 7  },
  { id: 'count30',  emoji: '💪', priority: 6, type: 'count',  threshold: 30 },
  { id: 'streak30', emoji: '💎', priority: 7, type: 'streak', threshold: 30 },
];

function computeBadgeStatuses(entries: MoodEntry[], _timezone: string, currentStreak: number): BadgeStatus[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  function findStreakUnlock(threshold: number): string | undefined {
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diff = diffCalendarDaysYmd(sorted[i - 1].date, sorted[i].date);
      if (diff === 1) { streak++; if (streak >= threshold) return sorted[i].date; }
      else streak = 1;
    }
    return undefined;
  }

  return BADGE_DEFS.map((def) => {
    if (def.type === 'count') {
      const unlocked = sorted.length >= def.threshold;
      return { def, unlocked, unlockDate: unlocked ? sorted[def.threshold - 1].date : undefined, progress: Math.min(1, sorted.length / def.threshold) };
    }
    if (def.type === 'mood5') {
      const first = sorted.find((e) => e.mood === 5);
      return { def, unlocked: !!first, unlockDate: first?.date, progress: first ? 1 : 0 };
    }
    const unlockDate = findStreakUnlock(def.threshold);
    return { def, unlocked: !!unlockDate, unlockDate, progress: Math.min(1, currentStreak / def.threshold) };
  });
}

// Priorité d'affichage sur le point calendrier : streak d'abord, puis count, puis mood5
const CALENDAR_PRIORITY: Record<string, number> = {
  streak30: 1, streak7: 2, streak3: 3,
  count30: 4, count10: 5, first: 6, mood5: 7,
};

function computeBadgeUnlockMap(statuses: BadgeStatus[]): Map<string, BadgeStatus[]> {
  const map = new Map<string, BadgeStatus[]>();
  [...statuses]
    .filter((s) => s.unlocked && s.unlockDate)
    .sort((a, b) => (CALENDAR_PRIORITY[a.def.id] ?? 99) - (CALENDAR_PRIORITY[b.def.id] ?? 99))
    .forEach((s) => {
      const date = s.unlockDate!;
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(s);
    });
  return map;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#22C55E', '#86EFAC', '#4ADE80', '#FBBF24', '#FDE68A', '#FB923C', '#FFFFFF'];
// Pré-calculé une seule fois pour éviter les re-rendus
const CONFETTI_CONFIGS = Array.from({ length: 18 }, (_, i) => ({
  angle: (i / 18) * Math.PI * 2 + (i % 2 === 0 ? 0.15 : -0.15),
  distance: 45 + (i % 4) * 20,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 5 + (i % 3) * 3,
  isCircle: i % 3 !== 0,
  delay: i * 22,
}));

interface ConfettiParticleProps {
  angle: number; distance: number; color: string;
  size: number; isCircle: boolean; delay: number; trigger: number;
}

function ConfettiParticle({ angle, distance, color, size, isCircle, delay, trigger }: ConfettiParticleProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (trigger === 0) return;
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration: 750 }));
  }, [trigger, progress, delay]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const opacity = p < 0.55 ? p / 0.55 : Math.max(0, 1 - (p - 0.55) / 0.45);
    return {
      transform: [
        { translateX: Math.cos(angle) * distance * p },
        { translateY: Math.sin(angle) * distance * p - 28 * p },
        { rotate: `${p * 200}deg` },
        { scale: 1 - p * 0.25 },
      ],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size, height: size,
          borderRadius: isCircle ? size / 2 : 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

function ConfettiOverlay({ trigger }: { trigger: number }) {
  if (trigger === 0) return null;
  return (
    <View
      style={{ position: 'absolute', right: 46, top: 112 }}
      pointerEvents="none"
    >
      {CONFETTI_CONFIGS.map((cfg, i) => (
        <ConfettiParticle key={i} {...cfg} trigger={trigger} />
      ))}
    </View>
  );
}

// ── HeroCard ──────────────────────────────────────────────────────────────────

interface HeroCardProps {
  streak: number;
  score: number | null;
}

function HeroCard({ streak, score }: HeroCardProps) {
  const { t } = useTranslation(['mood']);

  const streakSubtitle =
    streak === 0
      ? t('mood:streak.subtitleZero')
      : streak === 1
      ? t('mood:streak.subtitleOne')
      : t('mood:streak.subtitle');

  return (
    <Animated.View entering={FadeIn.delay(50)} style={styles.heroCard}>
      <LinearGradient
        colors={['#FF8C00', '#C45A00', '#FB923C']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroGradient}
      >
        {/* Streak */}
        <View style={styles.heroBlock}>
          <View style={styles.heroNumberRow}>
            <Text style={styles.heroEmoji}>🔥</Text>
            <Text style={styles.heroNumber}>{streak}</Text>
          </View>
          <Text style={styles.heroLabel}>{t('mood:streak.title')}</Text>
          <Text style={styles.heroSubtitle}>{streakSubtitle}</Text>
        </View>

        <View style={styles.heroDivider} />

        {/* Score bien-être */}
        <View style={styles.heroBlock}>
          {score !== null ? (
            <View style={styles.heroNumberRow}>
              <Text style={styles.heroEmoji}>✨</Text>
              <Text style={styles.heroNumber}>{score}</Text>
            </View>
          ) : (
            <Text style={styles.heroNumberSmall}>{t('mood:score.noData')}</Text>
          )}
          <Text style={styles.heroLabel}>{t('mood:score.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('mood:score.subtitle')}</Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

export default function MoodTrackerScreen() {
  const { t } = useTranslation(['mood']);
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [moodEntries, setMoodEntries] = useState<MoodEntry[]>([]);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** Même fuseau que profiles.timezone (backend) + fallback — utilisé pour mood_entries et user_mood_stats. */
  const resolvedTimezone = useMemo(
    () => resolveUserTimezoneFromProfile(profile),
    [profile],
  );

  const streak = useMemo(() => computeStreak(moodEntries, resolvedTimezone), [moodEntries, resolvedTimezone]);
  const wellbeingScore = useMemo(() => computeWellbeingScore(moodEntries, resolvedTimezone), [moodEntries, resolvedTimezone]);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const [selectedBadges, setSelectedBadges] = useState<BadgeStatus[] | null>(null);
  const badgeStatuses = useMemo(
    () => computeBadgeStatuses(moodEntries, resolvedTimezone, streak),
    [moodEntries, resolvedTimezone, streak],
  );
  const badgeMap = useMemo(() => computeBadgeUnlockMap(badgeStatuses), [badgeStatuses]);

  const getTodayLocalDate = useCallback(
    () => getMoodDateInTimezone(resolvedTimezone),
    [resolvedTimezone],
  );

  const getTodayEntry = () => {
    const todayDate = getTodayLocalDate();
    return moodEntries.find((entry) => entry.date === todayDate);
  };

  const canSaveMood = () => {
    const todayEntry = getTodayEntry();
    if (!todayEntry) return true;
    return selectedMood !== todayEntry.mood;
  };

  const loadMoodEntries = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('mood_entries')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (fetchError) throw fetchError;

      const entries: MoodEntry[] = (data || []).map((entry: SupabaseMoodEntry) => ({
        date: entry.date,
        mood: entry.mood,
        modified: entry.modified,
      }));

      setMoodEntries(entries);
    } catch (err) {
      console.error('Error loading mood entries:', err);
      setError(t('mood:errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveMood = async () => {
    if (!selectedMood || !canSaveMood() || isSaving || !user) return;

    try {
      setIsSaving(true);
      setError(null);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      const todayDate = getTodayLocalDate();
      const todayEntry = getTodayEntry();

      if (todayEntry) {
        const { error: updateError } = await supabase
          .from('mood_entries')
          .update({ mood: selectedMood, modified: true })
          .eq('date', todayDate)
          .eq('user_id', user.id);

        if (updateError) throw updateError;

        setMoodEntries((prev) =>
          prev.map((entry) =>
            entry.date === todayDate
              ? { ...entry, mood: selectedMood }
              : entry
          )
        );
      } else {
        const { error: insertError } = await supabase
          .from('mood_entries')
          .insert([{
            date: todayDate,
            mood: selectedMood,
            modified: false,
            user_id: user.id
          }]);

        if (insertError) throw insertError;

        setMoodEntries((prev) => [
          { date: todayDate, mood: selectedMood, modified: false },
          ...prev,
        ]);
      }

      // La valeur numérique suffit ; une note écrite ne sort jamais de l'app.
      track('mood_entry_saved', {
        mood_value: selectedMood,
        is_first_entry: moodEntries.length === 0,
        entries_count: moodEntries.length + 1,
      });

      // Écriture mémoire Lucy (non-bloquante) — même mood_date que mood_entries ci-dessus.
      upsertUserMoodStat(user.id, selectedMood, resolvedTimezone).catch((e) => {
        console.error('[moodTracker] upsertUserMoodStat error:', e);
      });

      // Notation de l'app — deux des trois déclencheurs naissent ici. Toute la
      // suite est non-bloquante : rien de ce qui concerne la notation ne doit
      // retarder l'écran de succès ni faire échouer l'enregistrement.
      rememberTodayMood(selectedMood, todayDate).catch(() => {});

      // `moodEntries` est encore l'ancienne liste dans cette closure : les
      // setMoodEntries ci-dessus ne se voient qu'au rendu suivant. On rejoue
      // donc la même mise à jour pour calculer la série incluant aujourd'hui —
      // sans quoi le 7ᵉ jour serait vu comme le 6ᵉ et le déclencheur ne
      // partirait jamais.
      const updatedEntries = todayEntry
        ? moodEntries.map((entry) =>
            entry.date === todayDate ? { ...entry, mood: selectedMood } : entry,
          )
        : [{ date: todayDate, mood: selectedMood, modified: false }, ...moodEntries];
      const updatedStreak = computeStreak(updatedEntries, resolvedTimezone);

      // Un seul appel, jamais deux. Les deux conditions tombent souvent le même
      // jour — remplir sept jours d'affilée et mettre 5 n'a rien d'exclusif — et
      // le second appel ne ferait qu'émettre un `too_soon` parasite.
      // La série passe devant : elle est plus rare, donc plus signifiante.
      // Égalité stricte à 7 : au-delà, la personne l'a déjà eue à 7 jours, et
      // `>=` la relancerait tous les jours de sa série.
      const reviewTrigger =
        updatedStreak === 7 ? 'mood_streak' : selectedMood === 5 ? 'mood_five' : null;

      if (reviewTrigger) {
        maybeRequestReview(reviewTrigger, {
          accountCreatedAt: profile?.created_at,
          recentMood: selectedMood,
        }).catch(() => {});
      }

      setShowSuccessMessage(true);
      setSelectedMood(null);
      setTimeout(() => setShowSuccessMessage(false), 3000);
    } catch (err) {
      console.error('Error saving mood:', err);
      setError(t('mood:errors.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      loadMoodEntries();
    }, [user])
  );

  useEffect(() => {
    const todayDate = getTodayLocalDate();
    const todayEntry = moodEntries.find((entry) => entry.date === todayDate);
    if (todayEntry) {
      setSelectedMood(todayEntry.mood);
    }
  }, [moodEntries, getTodayLocalDate]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F97316" />
        <Text style={styles.loadingText}>{t('mood:loading')}</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, 20),
          paddingBottom: Math.max(insets.bottom, 20)
        }
      ]}
    >
      {error && (
        <Animated.View entering={FadeIn} style={styles.errorMessage}>
          <Text style={styles.errorMessageText}>{error}</Text>
        </Animated.View>
      )}

      <HeroCard streak={streak} score={wellbeingScore} />

      <Animated.View entering={FadeIn.delay(100)} style={styles.selectorCard}>
        <ConfettiOverlay trigger={confettiTrigger} />

        <Text style={styles.selectorQuestion}>{t('mood:selector.question')}</Text>

        <MoodSelector
          selectedMood={selectedMood}
          onSelectMood={setSelectedMood}
          onConfettiTrigger={() => setConfettiTrigger((n) => n + 1)}
        />

        {showSuccessMessage && (
          <Animated.View entering={FadeIn} style={styles.successMessage}>
            <Text style={styles.successMessageText}>
              {t('mood:selector.saved')}
            </Text>
          </Animated.View>
        )}

        <Pressable
          style={[
            styles.saveButton,
            selectedMood && canSaveMood() && !isSaving
              ? { backgroundColor: moodColors[selectedMood - 1] }
              : styles.saveButtonDisabled,
          ]}
          onPress={handleSaveMood}
          disabled={isSaving || !selectedMood || !canSaveMood()}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>
              {t('mood:selector.saveButton')}
            </Text>
          )}
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(150)} style={styles.section}>
        {moodEntries.length > 0 ? (
          <MoodChart entries={moodEntries} timezone={resolvedTimezone} />
        ) : (
          <EmptyState />
        )}
      </Animated.View>

      {moodEntries.length > 0 && (
        <Animated.View entering={FadeIn.delay(200)} style={styles.calendarCard}>
          <PresenceCalendar
            entries={moodEntries}
            timezone={resolvedTimezone}
            badgeMap={badgeMap}
            onBadgeTap={setSelectedBadges}
          />
          <BadgeCarousel statuses={badgeStatuses} />
        </Animated.View>
      )}

      <InsightsCard entries={moodEntries} timezone={resolvedTimezone} />
    </ScrollView>
    <BadgeModal badges={selectedBadges} onClose={() => setSelectedBadges(null)} />
    </>
  );
}

interface MoodSelectorProps {
  selectedMood: number | null;
  onSelectMood: (mood: number) => void;
  onConfettiTrigger: () => void;
}

function MoodSelector({ selectedMood, onSelectMood, onConfettiTrigger }: MoodSelectorProps) {
  const { t } = useTranslation(['mood']);

  const handlePress = (mood: number) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onSelectMood(mood);
    if (mood === 5 && selectedMood !== 5) {
      onConfettiTrigger();
    }
  };

  return (
    <View style={styles.moodSelector}>
      {[1, 2, 3, 4, 5].map((mood) => (
        <MoodButton
          key={mood}
          mood={mood}
          isSelected={selectedMood === mood}
          onPress={() => handlePress(mood)}
          label={t(`mood:levels.${mood}`)}
        />
      ))}
    </View>
  );
}

interface MoodButtonProps {
  mood: number;
  isSelected: boolean;
  onPress: () => void;
  label: string;
}

function MoodButton({ mood, isSelected, onPress, label }: MoodButtonProps) {
  const scale = useSharedValue(1);
  const color = moodColors[mood - 1];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withTiming(0.91, { duration: 70 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(isSelected ? 1.04 : 1, { damping: 40, stiffness: 280 });
  };

  // Maintenir le scale légèrement élevé quand sélectionné
  useEffect(() => {
    scale.value = withSpring(isSelected ? 1.04 : 1, { damping: 40, stiffness: 280 });
  }, [isSelected, scale]);

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={animatedStyle}>
        {isSelected ? (
          <LinearGradient
            colors={[color, color + 'CC']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[
              styles.moodButton,
              {
                shadowColor: color,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.5,
                shadowRadius: 10,
                elevation: 8,
                borderColor: color,
              },
            ]}
          >
            <Text style={styles.moodEmojiSelected}>{moodEmojis[mood - 1]}</Text>
            <Text style={styles.moodLabelSelected}>{label}</Text>
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.moodButton,
              {
                backgroundColor: color + '14',
                borderColor: color + '50',
              },
            ]}
          >
            <Text style={styles.moodEmoji}>{moodEmojis[mood - 1]}</Text>
            <Text style={[styles.moodLabel, { color: color }]}>{label}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────────

interface Insight {
  key: string;
  prefix: string;
  highlight: string;
  suffix: string;
  icon: string;
  accent: string;
}

function computeInsights(
  entries: MoodEntry[],
  timezone: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Insight[] {
  if (entries.length < 5) return [];
  const today = getMoodDateInTimezone(timezone);
  const insights: Insight[] = [];

  // ── 1. Meilleur jour de la semaine ──
  const byDow: number[][] = Array.from({ length: 7 }, () => []);
  entries.forEach((e) => {
    const [ey, em, ed] = e.date.split('-').map(Number);
    const isoDay = (new Date(Date.UTC(ey, em - 1, ed)).getUTCDay() + 6) % 7;
    byDow[isoDay].push(e.mood);
  });
  const dowAverages = byDow.map((moods) =>
    moods.length >= 1 ? moods.reduce((s, m) => s + m, 0) / moods.length : null,
  );
  const bestDowIdx = dowAverages.reduce<number | null>((best, avg, i) => {
    if (avg === null) return best;
    if (best === null || avg > (dowAverages[best] ?? 0)) return i;
    return best;
  }, null);
  if (bestDowIdx !== null) {
    const dayNames = t('mood:insights.daysOfWeek', { returnObjects: true }) as unknown as string[];
    insights.push({
      key: 'bestDay',
      prefix: t('mood:insights.bestDayPre'),
      highlight: dayNames[bestDowIdx],
      suffix: '',
      icon: '✨',
      accent: '#F97316',
    });
  }

  // ── 2. Tendance semaine courante vs moyenne globale ──
  const globalAvg = entries.reduce((s, e) => s + e.mood, 0) / entries.length;
  const weekEntries = entries.filter((e) => {
    const d = diffCalendarDaysYmd(e.date, today);
    return d >= 0 && d < 7;
  });
  if (weekEntries.length >= 3) {
    const weekAvg = weekEntries.reduce((s, e) => s + e.mood, 0) / weekEntries.length;
    const isAbove = weekAvg >= globalAvg;
    insights.push({
      key: isAbove ? 'aboveAverage' : 'belowAverage',
      prefix: t(isAbove ? 'mood:insights.aboveAveragePre' : 'mood:insights.belowAveragePre'),
      highlight: t(isAbove ? 'mood:insights.aboveAverageHigh' : 'mood:insights.belowAverageHigh'),
      suffix: t(isAbove ? 'mood:insights.aboveAveragePost' : 'mood:insights.belowAveragePost'),
      icon: isAbove ? '📈' : '📉',
      accent: isAbove ? '#22C55E' : '#3B82F6',
    });
  }

  // ── 3. Record de streak ──
  const sortedDates = [...entries.map((e) => e.date)].sort();
  let maxStreak = 1;
  let cur = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const diff = diffCalendarDaysYmd(sortedDates[i - 1], sortedDates[i]);
    if (diff === 1) { cur++; maxStreak = Math.max(maxStreak, cur); }
    else cur = 1;
  }
  if (maxStreak >= 3) {
    insights.push({
      key: 'bestStreak',
      prefix: t('mood:insights.bestStreakPre'),
      highlight: `${maxStreak} ${t('mood:insights.bestStreakUnit', { count: maxStreak })}`,
      suffix: t('mood:insights.bestStreakSuffix'),
      icon: '🏅',
      accent: '#F97316',
    });
  }

  // ── 4. Progression 7j vs 7j précédents ──
  const last7 = entries.filter((e) => { const d = diffCalendarDaysYmd(e.date, today); return d >= 0 && d < 7; });
  const prev7 = entries.filter((e) => { const d = diffCalendarDaysYmd(e.date, today); return d >= 7 && d < 14; });
  if (last7.length >= 3 && prev7.length >= 3) {
    const avgLast = last7.reduce((s, e) => s + e.mood, 0) / last7.length;
    const avgPrev = prev7.reduce((s, e) => s + e.mood, 0) / prev7.length;
    const delta = avgLast - avgPrev;
    if (Math.abs(delta) >= 0.4) {
      const isImproving = delta > 0;
      insights.push({
        key: isImproving ? 'improving' : 'declining',
        prefix: t(isImproving ? 'mood:insights.improvingPre' : 'mood:insights.decliningPre'),
        highlight: t(isImproving ? 'mood:insights.improvingHigh' : 'mood:insights.decliningHigh'),
        suffix: t(isImproving ? 'mood:insights.improvingPost' : 'mood:insights.decliningPost'),
        icon: isImproving ? '🌱' : '💙',
        accent: isImproving ? '#22C55E' : '#3B82F6',
      });
    }
  }

  return insights.slice(0, 3);
}

// ── Bento Grid ────────────────────────────────────────────────────────────────

function BentoTile({ insight, large }: { insight: Insight; large: boolean }) {
  return (
    <View style={[styles.bentoTile, large ? styles.bentoLarge : styles.bentoSmall]}>
      <Text style={{ fontSize: large ? 28 : 22, marginBottom: 6 }}>{insight.icon}</Text>
      <Text style={large ? styles.bentoPrefixLg : styles.bentoPrefixSm}>{insight.prefix}</Text>
      <Text style={[large ? styles.bentoHighlightLg : styles.bentoHighlightSm, { color: insight.accent }]}>
        {insight.highlight}
      </Text>
      {!!insight.suffix && (
        <Text style={large ? styles.bentoPrefixLg : styles.bentoPrefixSm}>{insight.suffix}</Text>
      )}
    </View>
  );
}

function BentoGrid({ insights }: { insights: Insight[] }) {
  const [first, ...rest] = insights;
  return (
    <View style={styles.bentoGrid}>
      {first && <BentoTile insight={first} large />}
      {rest.length > 0 && (
        <View style={styles.bentoRow}>
          {rest.map((insight) => (
            <BentoTile key={insight.key} insight={insight} large={false} />
          ))}
        </View>
      )}
    </View>
  );
}

function FakeBentoGrid() {
  return (
    <View style={styles.bentoGrid}>
      <View style={[styles.bentoTile, styles.bentoLarge]} />
      <View style={styles.bentoRow}>
        <View style={[styles.bentoTile, styles.bentoSmall]} />
        <View style={[styles.bentoTile, styles.bentoSmall]} />
      </View>
    </View>
  );
}

function InsightsLocked({ entriesCount }: { entriesCount: number }) {
  const { t } = useTranslation(['mood']);
  const daysLeft = Math.max(0, 5 - entriesCount);

  return (
    <Animated.View entering={FadeIn.delay(175)} style={styles.insightsCard}>
      <FakeBentoGrid />
      <BlurView intensity={10} tint="light" style={[StyleSheet.absoluteFill, styles.insightsBlur]}>
        <View style={styles.insightsLockContent}>
          <Text style={styles.insightsLockEmoji}>🔒</Text>
          <Text style={styles.insightsLockTitle}>{t('mood:insights.title')}</Text>
          <Text style={styles.insightsLockSubtitle}>
            <Text style={styles.insightsLockSubNormal}>{t('mood:insights.lockedPrefix') + ' '}</Text>
            <Text style={styles.insightsLockSubBold}>{t('mood:insights.lockedDays', { count: daysLeft })}</Text>
          </Text>
        </View>
      </BlurView>
    </Animated.View>
  );
}

interface InsightsCardProps {
  entries: MoodEntry[];
  timezone: string;
}

function InsightsCard({ entries, timezone }: InsightsCardProps) {
  const { t } = useTranslation(['mood']);

  if (entries.length < 5) {
    return <InsightsLocked entriesCount={entries.length} />;
  }

  const insights = computeInsights(entries, timezone, t as (key: string, opts?: Record<string, unknown>) => string);
  if (insights.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.delay(175)} style={styles.insightsCard}>
      <BentoGrid insights={insights} />
    </Animated.View>
  );
}

// ── Badge components ──────────────────────────────────────────────────────────

const MODAL_WIDTH = Math.min(screenWidth - 64, 290);

function BadgeModalContent({ badge }: { badge: BadgeStatus }) {
  const { t } = useTranslation(['mood']);
  const months = t('mood:badges.months', { returnObjects: true }) as unknown as string[];
  const dateStr = badge.unlockDate
    ? (() => { const [, m, d] = badge.unlockDate!.split('-').map(Number); return `${d} ${months[m - 1]}`; })()
    : '';
  return (
    <View style={[styles.modalContent, { width: MODAL_WIDTH - 2 }]}>
      <Text style={styles.modalEmoji}>{badge.def.emoji}</Text>
      <Text style={styles.modalBadgeName}>{t(`mood:badges.${badge.def.id}.name`)}</Text>
      <Text style={styles.modalBadgeDesc}>{t(`mood:badges.${badge.def.id}.desc`)}</Text>
      {!!dateStr && <Text style={styles.modalBadgeDate}>{dateStr}</Text>}
    </View>
  );
}

function BadgeModal({ badges, onClose }: { badges: BadgeStatus[] | null; onClose: () => void }) {
  if (!badges || badges.length === 0) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable onPress={() => {}} style={styles.modalCard}>
          {badges.length === 1 ? (
            <BadgeModalContent badge={badges[0]} />
          ) : (
            <FlatList
              horizontal
              pagingEnabled
              data={badges}
              keyExtractor={(b) => b.def.id}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => <BadgeModalContent badge={item} />}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BadgeEmojiItem({
  item,
  index,
  scrollX,
}: {
  item: BadgeStatus;
  index: number;
  scrollX: SharedValue<number>;
}) {
  const animStyle = useAnimatedStyle(() => {
    // distance normalisée : 0 = centré, 1 = un item d'écart
    const dist = Math.min(1, Math.abs(scrollX.value - index * BADGE_SNAP_INTERVAL) / BADGE_SNAP_INTERVAL);
    // scale : 1.42 au centre, 1.0 à un intervalle de distance
    const scale = 1.0 + 0.42 * (1 - dist);
    // courbure parabolique roulette vers le bas pour les items non-centrés
    const translateY = 20 * dist * dist;
    return { transform: [{ scale }, { translateY }] };
  });

  return (
    <Animated.View style={[styles.badgeEmojiWrap, animStyle]}>
      <Text style={styles.badgeEmojiFloat}>{item.def.emoji}</Text>
      {!item.unlocked && (
        <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFill} />
      )}
    </Animated.View>
  );
}

function BadgeCarousel({ statuses }: { statuses: BadgeStatus[] }) {
  const { t } = useTranslation(['mood']);
  const scrollRef = useRef<ScrollView>(null);
  const firstLockedIndex = statuses.findIndex((s) => !s.unlocked);
  const initialIdx = firstLockedIndex >= 0 ? firstLockedIndex : statuses.length - 1;
  const [activeIndex, setActiveIndex] = useState(initialIdx);
  const prevActiveIndex = useRef(initialIdx);
  const scrollStartX = useRef(0);
  const scrollStartIdx = useRef(initialIdx);
  const isSnapping = useRef(false);
  const scrollX = useSharedValue(initialIdx * BADGE_SNAP_INTERVAL);

  useEffect(() => {
    if (prevActiveIndex.current !== activeIndex) {
      prevActiveIndex.current = activeIndex;
      if (statuses[activeIndex]?.unlocked) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  }, [activeIndex, statuses]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  useEffect(() => {
    if (initialIdx > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: initialIdx * BADGE_SNAP_INTERVAL, animated: false });
      }, 80);
    }
  }, [initialIdx]);

  const snapToIndex = useCallback(
    (idx: number) => {
      const target = Math.max(0, Math.min(idx, statuses.length - 1));
      isSnapping.current = true;
      scrollRef.current?.scrollTo({ x: target * BADGE_SNAP_INTERVAL, animated: true });
      setActiveIndex(target);
    },
    [statuses.length],
  );

  const current = statuses[activeIndex];
  const pct = Math.round(current.progress * 100);
  const desc = t(`mood:badges.${current.def.id}.desc`);
  const displayDesc =
    !current.unlocked && current.def.type === 'mood5'
      ? `${desc} ${t('mood:badges.continue')}`
      : desc;

  return (
    <View style={styles.badgeSection}>
      <AnimatedScrollView
        ref={scrollRef as React.Ref<ScrollView>}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={styles.badgeScrollContent}
        onScrollBeginDrag={(e) => {
          isSnapping.current = false;
          scrollStartX.current = e.nativeEvent.contentOffset.x;
          scrollStartIdx.current = Math.round(scrollStartX.current / BADGE_SNAP_INTERVAL);
        }}
        onScrollEndDrag={(e) => {
          const { contentOffset, velocity } = e.nativeEvent;
          const vx = (velocity as { x: number } | undefined)?.x ?? 0;
          const dx = contentOffset.x - scrollStartX.current;
          const start = scrollStartIdx.current;
          if (vx > 0.1 || dx > BADGE_SNAP_INTERVAL * 0.15) {
            snapToIndex(start + 1);
          } else if (vx < -0.1 || dx < -BADGE_SNAP_INTERVAL * 0.15) {
            snapToIndex(start - 1);
          } else {
            snapToIndex(start);
          }
        }}
        onMomentumScrollEnd={(e) => {
          if (isSnapping.current) return;
          const idx = Math.round(e.nativeEvent.contentOffset.x / BADGE_SNAP_INTERVAL);
          setActiveIndex(Math.max(0, Math.min(idx, statuses.length - 1)));
        }}
      >
        {statuses.map((item, index) => (
          <React.Fragment key={item.def.id}>
            {index > 0 && <View style={{ width: BADGE_CARD_GAP }} />}
            <BadgeEmojiItem item={item} index={index} scrollX={scrollX} />
          </React.Fragment>
        ))}
      </AnimatedScrollView>
      <View style={styles.badgeFadeLeft} pointerEvents="none">
        <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.badgeFadeRight} pointerEvents="none">
        <LinearGradient colors={['rgba(255,255,255,0)', '#FFFFFF']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </View>
      <Animated.View key={activeIndex} entering={FadeIn.duration(200)} style={styles.badgeInfo}>
        <Text style={styles.badgeInfoName}>{t(`mood:badges.${current.def.id}.name`)}</Text>
        {!current.unlocked && (
          <View style={styles.badgeInfoProgressRow}>
            <View style={styles.badgeInfoTrack}>
              <View style={[styles.badgeInfoFill, { width: `${pct}%` as `${number}%` }]} />
            </View>
            <Text style={styles.badgeInfoPct}>{pct}%</Text>
          </View>
        )}
        <Text style={styles.badgeInfoDesc}>{displayDesc}</Text>
      </Animated.View>
    </View>
  );
}

// ── PresenceCalendar ──────────────────────────────────────────────────────────

interface PresenceCalendarProps {
  entries: MoodEntry[];
  timezone: string;
  badgeMap: Map<string, BadgeStatus[]>;
  onBadgeTap: (badges: BadgeStatus[]) => void;
}

function PresenceCalendar({ entries, timezone, badgeMap, onBadgeTap }: PresenceCalendarProps) {
  const { t } = useTranslation(['mood']);
  const today = getMoodDateInTimezone(timezone);
  const entryMap = useMemo(
    () => new Map(entries.map((e) => [e.date, e.mood])),
    [entries],
  );

  // Calcule la grille : on remonte au lundi de la semaine d'il y a 4 semaines
  const grid = useMemo(() => {
    // Jour de semaine de today (0 = lun … 6 = dim, en base ISO)
    const [ty, tm, td] = today.split('-').map(Number);
    const todayDate = new Date(Date.UTC(ty, tm - 1, td));
    const isoDay = (todayDate.getUTCDay() + 6) % 7; // 0=lun, 6=dim

    // Lundi de la semaine la plus ancienne affichée (4 semaines en arrière)
    const startDate = new Date(todayDate);
    startDate.setUTCDate(startDate.getUTCDate() - isoDay - 28);

    // Génère 5 semaines × 7 jours
    const days: { date: string; mood: number | null; isToday: boolean; isFuture: boolean }[] = [];
    for (let i = 0; i < 35; i++) {
      const d = new Date(startDate);
      d.setUTCDate(startDate.getUTCDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        date: dateStr,
        mood: entryMap.get(dateStr) ?? null,
        isToday: dateStr === today,
        isFuture: dateStr > today,
      });
    }

    // Découpe en semaines
    const weeks: typeof days[] = [];
    for (let w = 0; w < 5; w++) weeks.push(days.slice(w * 7, w * 7 + 7));
    return weeks;
  }, [today, entryMap]);

  // Nombre d'humeurs dans les cinq semaines AFFICHÉES, et non dans le mois
  // civil. Compté depuis `grid` elle-même : le chiffre ne peut alors jamais
  // diverger des points visibles juste en dessous, ce qui arrivait chaque
  // début de mois — « 1 humeur ce mois-ci » sous une grille en montrant trois.
  const gridCount = useMemo(
    () => grid.reduce((n, week) => n + week.filter((d) => d.mood !== null).length, 0),
    [grid],
  );

  const DAY_SIZE = (screenWidth - 40 - 32 - 6 * 6) / 7; // card padding + gaps

  const dayLabels: string[] = t('mood:calendar.days', { returnObjects: true }) as string[];

  return (
    <>
      <View style={styles.calendarHeader}>
        <Text style={styles.calendarTitle}>{t('mood:calendar.title')}</Text>
        <Text style={styles.calendarCount}>
          {t('mood:calendar.entriesCount', { count: gridCount })}{' '}
          <Text style={styles.calendarCountSub}>{t('mood:calendar.overFiveWeeks')}</Text>
        </Text>
      </View>

      {/* Jours de la semaine */}
      <View style={styles.calendarDayRow}>
        {dayLabels.map((label, i) => (
          <View key={i} style={[styles.calendarDayCell, { width: DAY_SIZE }]}>
            <Text style={styles.calendarDayLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Grille */}
      {grid.map((week, wi) => (
        <View key={wi} style={styles.calendarWeekRow}>
          {week.map((day, di) => {
            const bg = day.isFuture
              ? 'transparent'
              : day.mood !== null
              ? moodColors[day.mood - 1]
              : '#E5E7EB';

            const isBadgeDay = badgeMap.has(day.date) && !day.isFuture;
            const badgeBorderColor = isBadgeDay && day.mood ? moodColors[day.mood - 1] : '#9CA3AF';

            if (isBadgeDay) {
              return (
                <Pressable
                  key={di}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onBadgeTap(badgeMap.get(day.date)!); }}
                  style={[
                    styles.calendarDotWrap,
                    { width: DAY_SIZE, height: DAY_SIZE, borderColor: badgeBorderColor },
                    day.isToday && styles.calendarDotToday,
                  ]}
                >
                  <View style={[
                    styles.calendarDot,
                    styles.calendarDotBadge,
                    { width: DAY_SIZE - 4, height: DAY_SIZE - 4, borderRadius: (DAY_SIZE - 4) / 2 },
                  ]}>
                    <Text style={{ fontSize: Math.floor((DAY_SIZE - 4) * 0.5), lineHeight: DAY_SIZE - 4 }}>
                      {badgeMap.get(day.date)![0].def.emoji}
                    </Text>
                  </View>
                </Pressable>
              );
            }

            return (
              <View
                key={di}
                style={[
                  styles.calendarDotWrap,
                  { width: DAY_SIZE, height: DAY_SIZE },
                  day.isToday && styles.calendarDotToday,
                ]}
              >
                <View
                  style={[
                    styles.calendarDot,
                    { width: DAY_SIZE - 4, height: DAY_SIZE - 4, borderRadius: (DAY_SIZE - 4) / 2 },
                    day.isFuture
                      ? styles.calendarDotFuture
                      : { backgroundColor: bg },
                    day.mood !== null && !day.isFuture && {
                      shadowColor: bg,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.4,
                      shadowRadius: 4,
                      elevation: 3,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}

type TimeRange = 'week' | 'month' | '3months';

interface MoodChartProps {
  entries: MoodEntry[];
  /** Fuseau aligné sur profiles / mood_entries / user_mood_stats */
  timezone: string;
}

function buildMixedPath(coords: { x: number; y: number; mood: number }[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    if (p1.mood === p2.mood) {
      // Même valeur → droite
      d += ` L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    } else {
      // Valeur différente → courbe Catmull-Rom
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
  }
  return d;
}

function getTickIndices(range: TimeRange): number[] {
  switch (range) {
    case 'week':
      return [0, 1, 2, 3, 4, 5, 6];
    case 'month':
      return [0, 2, 6, 9, 13, 16, 20, 23, 29];
    case '3months':
      return [0, 9, 19, 29, 39, 49, 59, 69, 79, 89];
    default:
      return [];
  }
}

type LineCoord = { x: number; y: number; mood: number; originalIndex: number };

/**
 * Jour du mois d'une date ISO, sans zéro initial : « 2026-09-04 » → « 4 ».
 *
 * L'axe n'affichait auparavant que le RANG de la case dans la fenêtre (1 à 7,
 * 1 à 30). Ces nombres ressemblaient à s'y méprendre à des quantièmes et n'en
 * étaient pas : en vue Semaine, le point du jour tombait invariablement sur
 * « 7 » — non pas parce qu'on était dimanche, mais parce que la fenêtre se
 * termine toujours aujourd'hui.
 */
function dayOfMonthLabel(ymd: string): string {
  return String(Number(ymd.slice(8, 10)));
}

function getGapThreshold(range: TimeRange): number {
  switch (range) {
    case 'month': return 10;
    case '3months': return 30;
    default: return Infinity;
  }
}

function splitIntoSegments(coords: LineCoord[], maxGap: number): LineCoord[][] {
  if (coords.length === 0) return [];
  const segments: LineCoord[][] = [];
  let current: LineCoord[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const gap = coords[i].originalIndex - coords[i - 1].originalIndex;
    if (gap > maxGap) {
      segments.push(current);
      current = [coords[i]];
    } else {
      current.push(coords[i]);
    }
  }
  segments.push(current);
  return segments;
}

function MoodChart({ entries, timezone }: MoodChartProps) {
  const { t } = useTranslation(['mood']);
  const chartRef = React.useRef<View>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');

  const cardInnerWidth = screenWidth - 80;
  const chartHeight = 210;
  const pLeft = 40;
  const pRight = 8;
  const pTop = 10;
  const pBottom = 28;
  const plotWidth = cardInnerWidth - pLeft - pRight;
  const plotHeight = chartHeight - pTop - pBottom;

  const getDaysCount = () => {
    switch (timeRange) {
      case 'week': return 7;
      case 'month': return 30;
      case '3months': return 90;
      default: return 30;
    }
  };

  const allDates = entries.map((e) => e.date).sort();
  const todayStr = getMoodDateInTimezone(timezone);
  const firstStr = allDates.length > 0 ? allDates[0] : todayStr;
  const daysSinceFirstEntry = Math.max(0, diffCalendarDaysYmd(firstStr, todayStr));
  const daysCount = getDaysCount();

  // La courbe part de la première entrée (gauche) et grandit vers la droite.
  // Quand l'historique dépasse N jours, on bascule en fenêtre glissante.
  const rangeStartStr = daysSinceFirstEntry >= daysCount
    ? addCalendarDaysToYmd(todayStr, -(daysCount - 1))
    : firstStr;
  const totalDays = daysSinceFirstEntry >= daysCount
    ? daysCount
    : daysSinceFirstEntry + 1;

  const dateRange = Array.from({ length: totalDays }, (_, i) =>
    addCalendarDaysToYmd(rangeStartStr, i),
  );

  const chartData = dateRange.map((date) => {
    const entry = entries.find((e) => e.date === date);
    return { date, mood: entry?.mood || null };
  });

  // Espacement dynamique : tous les points tiennent dans la largeur fixe, sans défilement
  const pointSpacing = daysCount > 1 ? plotWidth / (daysCount - 1) : plotWidth;
  const contentWidth = cardInnerWidth;

  const getX = (index: number) => pLeft + index * pointSpacing;
  const getY = (mood: number) => pTop + plotHeight - ((mood - 1) * plotHeight) / 4;
  const bottomY = pTop + plotHeight;

  const validPoints = chartData
    .map((point, index) => ({ ...point, originalIndex: index }))
    .filter((point) => point.mood !== null);

  const lineCoords: LineCoord[] = validPoints.map((p) => ({
    x: getX(p.originalIndex), y: getY(p.mood!), mood: p.mood!, originalIndex: p.originalIndex,
  }));
  const chartSegments = splitIntoSegments(lineCoords, getGapThreshold(timeRange));

  const tickIndices = getTickIndices(timeRange);

  const handleShare = async () => {
    if (!chartRef.current) return;
    try {
      setIsSharing(true);
      const tempUri = await captureRef(chartRef, { format: 'png', quality: 1 });
      const namedFile = new FSFile(Paths.cache, `look-at-my-mood-${todayStr}.png`);
      if (namedFile.exists) namedFile.delete();
      new FSFile(tempUri).copy(namedFile);
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        // Le seul canal de croissance organique de Lucy aujourd'hui : il mérite
        // d'être compté. La feuille de partage ne dit pas où l'image atterrit,
        // et c'est très bien ainsi.
        track('mood_chart_shared');
        await Sharing.shareAsync(namedFile.uri, { mimeType: 'image/png', UTI: 'public.png' });
      }
    } catch (error) {
      console.error('Error sharing chart:', error);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <View ref={chartRef} style={styles.chartContainer}>
      <View style={styles.chartHeader}>
        <Text style={styles.chartTitle}>{t('mood:chart.title')}</Text>
        <Pressable style={styles.shareButton} onPress={handleShare} disabled={isSharing}>
          {isSharing ? (
            <ActivityIndicator size="small" color="#F97316" />
          ) : (
            <ShareIcon size={18} color="#C4C4C8" />
          )}
        </Pressable>
      </View>

      <View style={styles.chartScrollView}>
        <Svg width={contentWidth} height={chartHeight}>
          <Defs>
            <SvgLinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#F97316" stopOpacity="0.15" />
              <Stop offset="100%" stopColor="#F97316" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>

          {[1, 2, 3, 4, 5].map((level) => (
            <Line
              key={level}
              x1={pLeft}
              y1={getY(level)}
              x2={contentWidth - pRight}
              y2={getY(level)}
              stroke="#F0F0F5"
              strokeWidth="1"
            />
          ))}

          {chartSegments.map((seg, si) => {
            const lPath = buildMixedPath(seg);
            const aPath = seg.length > 1
              ? `${lPath} L ${seg[seg.length - 1].x.toFixed(1)} ${bottomY} L ${seg[0].x.toFixed(1)} ${bottomY} Z`
              : '';
            return (
              <React.Fragment key={`seg-${si}`}>
                {aPath ? <Path d={aPath} fill="url(#areaGrad)" /> : null}
                {lPath ? (
                  <Path d={lPath} stroke="#F97316" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
              </React.Fragment>
            );
          })}

          {validPoints.map((point, i) => {
            const x = getX(point.originalIndex);
            const y = getY(point.mood!);
            const isLast = i === validPoints.length - 1;
            // Pour le mois et les 3 mois, les points sont trop serrés — on affiche seulement aujourd'hui
            if (!isLast && timeRange !== 'week') return null;
            return (
              <Circle
                key={point.originalIndex}
                cx={x}
                cy={y}
                r={isLast ? 5 : 3.5}
                fill="#FFFFFF"
                stroke="#F97316"
                strokeWidth={isLast ? 2.5 : 1.8}
              />
            );
          })}

          {[1, 2, 3, 4, 5].map((level) => (
            <SvgText
              key={`emoji-${level}`}
              x={pLeft - 12}
              y={getY(level) + 6}
              fontSize="16"
              textAnchor="end"
            >
              {moodEmojis[level - 1]}
            </SvgText>
          ))}

          {tickIndices.map((idx, pos) => {
            const anchor =
              pos === 0 ? 'start' :
              pos === tickIndices.length - 1 ? 'end' : 'middle';
            return (
              <SvgText
                key={`tick-${idx}`}
                x={getX(idx)}
                y={bottomY + 18}
                fontSize="11"
                textAnchor={anchor}
                fill="#8E8E93"
              >
                {dayOfMonthLabel(addCalendarDaysToYmd(rangeStartStr, idx))}
              </SvgText>
            );
          })}
        </Svg>
      </View>

      <View style={styles.segmentedControl}>
        {(['week', 'month', '3months'] as TimeRange[]).map((range) => (
          <Pressable
            key={range}
            style={[styles.segmentedButton, timeRange === range && styles.segmentedButtonActive]}
            onPress={() => { setTimeRange(range); Haptics.selectionAsync(); }}
          >
            <Text style={[styles.segmentedText, timeRange === range && styles.segmentedTextActive]}>
              {t(`mood:chart.timeRange.${range === '3months' ? 'threeMonths' : range}`)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function EmptyState() {
  const { t } = useTranslation(['mood']);

  return (
    <Animated.View entering={FadeIn} style={styles.emptyState}>
      <Text style={styles.emptyStateEmoji}>📊</Text>
      <Text style={styles.emptyStateTitle}>{t('mood:chart.empty.title')}</Text>
      <Text style={styles.emptyStateMessage}>
        {t('mood:chart.empty.message')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  // ── Selector card ────────────────────────────────────────────────────────────
  selectorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  selectorQuestion: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1C1C1E',
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  moodSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  moodButton: {
    width: 60,
    height: 88,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  moodEmoji: {
    fontSize: 30,
    marginBottom: 6,
  },
  moodEmojiSelected: {
    fontSize: 34,
    marginBottom: 6,
  },
  moodLabel: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  moodLabelSelected: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  saveButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  successMessage: {
    backgroundColor: '#D1FAE5',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  successMessageText: {
    color: '#065F46',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  warningMessage: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  warningMessageText: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  chartContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  chartScrollView: {
    marginBottom: 4,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  chartTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.3,
  },
  shareButton: {
    padding: 6,
    borderRadius: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    padding: 2,
    marginTop: 14,
  },
  segmentedButton: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentedButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentedText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  segmentedTextActive: {
    color: '#1C1C1E',
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  emptyStateEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  // ── Badge Carousel ───────────────────────────────────────────────────────────
  badgeSection: {
    marginTop: 12,
    marginHorizontal: -16,
    position: 'relative',
  },
  badgeFadeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 52,
    zIndex: 10,
  },
  badgeFadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 52,
    zIndex: 10,
  },
  badgeScrollContent: {
    paddingHorizontal: BADGE_SNAP_PADDING,
    alignItems: 'center',
    paddingVertical: 12,
  },
  badgeEmojiWrap: {
    width: BADGE_CARD_WIDTH,
    height: BADGE_CARD_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 12,
  },
  badgeEmojiFloat: {
    fontSize: 45,
  },
  badgeInfo: {
    alignItems: 'center',
    paddingHorizontal: 72,
    marginTop: 18,
    paddingBottom: 4,
  },
  badgeInfoName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 10,
  },
  badgeInfoProgressRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12,
  },
  badgeInfoTrack: {
    width: 90,
    height: 4,
    backgroundColor: '#F3F4F6',
    borderRadius: 2,
    overflow: 'hidden',
  },
  badgeInfoFill: {
    height: 4,
    backgroundColor: '#1C1C1E',
    borderRadius: 2,
  },
  badgeInfoPct: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  badgeInfoDesc: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 19,
  },
  // ── Badge Modal ──────────────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: MODAL_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    overflow: 'hidden',
  },
  modalContent: {
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 8,
  },
  modalEmoji: {
    fontSize: 64,
    marginBottom: 4,
  },
  modalBadgeName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1C1C1E',
    textAlign: 'center',
  },
  modalBadgeDesc: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  modalBadgeDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F97316',
    marginTop: 4,
  },
  // ── Presence Calendar (badge dot) ────────────────────────────────────────────
  calendarDotBadge: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Insights ─────────────────────────────────────────────────────────────────
  insightsCard: {
    backgroundColor: '#F2F4F7',
    borderRadius: 24,
    padding: 8,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  // Bento Grid
  bentoGrid: {
    gap: 8,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bentoTile: {
    borderRadius: 18,
    padding: 16,
    gap: 4,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  bentoLarge: {
    minHeight: 130,
  },
  bentoSmall: {
    flex: 1,
    minHeight: 116,
  },
  bentoIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  bentoPrefixLg: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
    lineHeight: 20,
  },
  bentoHighlightLg: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  bentoPrefixSm: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    lineHeight: 19,
  },
  bentoHighlightSm: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  // Locked state
  insightsBlur: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightsLockEmoji: {
    fontSize: 44,
    marginBottom: 2,
  },
  insightsLockContent: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  insightsLockTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1C1C1E',
    textAlign: 'center',
    marginTop: 2,
  },
  insightsLockSubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  insightsLockSubNormal: {
    fontWeight: '400',
    color: '#374151',
  },
  insightsLockSubBold: {
    fontWeight: '800',
    color: '#1C1C1E',
  },
  // ── Presence Calendar ────────────────────────────────────────────────────────
  calendarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  calendarHeader: {
    marginBottom: 16,
  },
  calendarTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  calendarCount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F97316',
  },
  calendarCountSub: {
    fontWeight: '500',
    color: '#9CA3AF',
  },
  calendarDayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calendarDayCell: {
    alignItems: 'center',
  },
  calendarDayLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  calendarWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calendarDotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  calendarDotToday: {
    borderColor: '#F97316',
  },
  calendarDot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDotFuture: {
    backgroundColor: 'transparent',
  },
  // ── Hero Card ─────────────────────────────────────────────────────────────────
  heroCard: {
    marginBottom: 24,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  heroGradient: {
    flexDirection: 'row',
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  heroBlock: {
    flex: 1,
    alignItems: 'center',
  },
  heroNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  heroDivider: {
    width: 1,
    height: 48,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignSelf: 'center',
  },
  heroEmoji: {
    fontSize: 26,
  },
  heroNumber: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 42,
  },
  heroNumberSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginBottom: 4,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 3,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  errorMessage: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorMessageText: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
