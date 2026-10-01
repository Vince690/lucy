import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { getLastMessageSentAt } from './lucyConversationStorage';

const LAST_SCHEDULED_KEY = '@lucy/last_scheduled_hash';
const LAST_SCHEDULED_TIME_KEY = '@lucy/last_scheduled_time';
const SKIP_DATE_KEY = '@lucy/skip_date';
const RESCHEDULE_DEBOUNCE_MS = 30 * 60 * 1000; // 30 minutes
const NOTIFICATION_HOUR = 20;
const NOTIFICATION_MINUTE = 50;
const CHAIN_DAYS = 30;
const REMINDER_TYPE = 'daily-reminder';
const TALK_WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Configure foreground notification behavior at module init
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isDailyReminder = notification.request.content.data?.type === REMINDER_TYPE;
    // L'utilisateur est déjà dans l'app : la relance du soir n'a pas de sens, on ne l'affiche pas.
    if (isDailyReminder && AppState.currentState === 'active') {
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- Message content ---

type Lang = 'fr' | 'en';

const P1_MESSAGES: Record<Lang, string[]> = {
  fr: [
    'Comment tu vas ce soir, {name} ? 🌙',
    'Lucy est là pour toi ce soir, {name} 💙',
  ],
  en: [
    'How are you tonight, {name}? 🌙',
    "Lucy's here for you tonight, {name} 💙",
  ],
};

const P2_MESSAGES: Record<Lang, string[]> = {
  fr: [
    '{name}, Lucy pense à toi ce soir 🌙',
    "Pas d'obligation, mais Lucy serait contente de te voir 🌼",
    "Comment tu vas, {name} ? Lucy est là si t'as envie de parler 💙",
    '{name}… Tout va bien ? On est là 🌿',
  ],
  en: [
    "{name}, Lucy's thinking of you tonight 🌙",
    "No pressure, but Lucy would love to see you 🌼",
    "How are you, {name}? Lucy's here if you want to chat 💙",
    '{name}… All good? We\'re here 🌿',
  ],
};

function buildNotificationBody(firstName: string, dayIndex: number, lang: string): string {
  const l: Lang = lang === 'fr' ? 'fr' : 'en';
  const name = firstName || 'toi';

  let template: string;
  if (dayIndex <= 1) {
    // P1: days 0 and 1
    const pool = P1_MESSAGES[l];
    template = pool[dayIndex % pool.length];
  } else {
    // P2: day 2+
    const pool = P2_MESSAGES[l];
    template = pool[dayIndex % pool.length];
  }

  return template.replace(/{name}/g, name);
}

// --- Permission handling ---

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('lucy-reminders', {
      name: 'Lucy reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// --- Chain scheduling ---

function buildContentHash(firstName: string, lang: string): string {
  return `${firstName}|${lang}`;
}

export async function scheduleNotificationChain(firstName: string, lang: string): Promise<void> {
  // Check permission first — silently abort if not granted
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Debounce: skip if same content scheduled recently (< 30 min ago)
  const newHash = buildContentHash(firstName, lang);
  try {
    const [savedHash, savedTimeStr] = await Promise.all([
      AsyncStorage.getItem(LAST_SCHEDULED_KEY),
      AsyncStorage.getItem(LAST_SCHEDULED_TIME_KEY),
    ]);

    if (savedHash === newHash && savedTimeStr) {
      const elapsed = Date.now() - parseInt(savedTimeStr, 10);
      if (elapsed < RESCHEDULE_DEBOUNCE_MS) return;
    }
  } catch {
    // AsyncStorage error — proceed with scheduling
  }

  // Cancel all existing scheduled notifications
  await Notifications.cancelAllScheduledNotificationsAsync();

  // Determine starting day
  const now = new Date();
  const todayFiringTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    NOTIFICATION_HOUR,
    NOTIFICATION_MINUTE,
    0,
  );
  // If today's notification time has already passed, start from tomorrow
  const startOffset = now < todayFiringTime ? 0 : 1;

  // Jour à sauter (déjà discuté avec Lucy ce soir) — mémorisé par skipTonightReminderIfAlreadyTalked()
  let skipDate: string | null = null;
  try {
    skipDate = await AsyncStorage.getItem(SKIP_DATE_KEY);
    if (skipDate && skipDate < dateKey(now)) {
      await AsyncStorage.removeItem(SKIP_DATE_KEY);
      skipDate = null;
    }
  } catch {
    skipDate = null;
  }

  // Schedule up to 30 notifications
  for (let i = 0; i < CHAIN_DAYS; i++) {
    const dayOffset = startOffset + i;
    const fireDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dayOffset,
      NOTIFICATION_HOUR,
      NOTIFICATION_MINUTE,
      0,
    );

    const fireDateKey = dateKey(fireDate);
    if (fireDateKey === skipDate) continue;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Lucy',
        body: buildNotificationBody(firstName, i, lang),
        sound: 'default',
        data: { type: REMINDER_TYPE, date: fireDateKey },
        ...(Platform.OS === 'android' ? { channelId: 'lucy-reminders' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireDate,
      },
    });
  }

  // Persist hash + timestamp
  try {
    await Promise.all([
      AsyncStorage.setItem(LAST_SCHEDULED_KEY, newHash),
      AsyncStorage.setItem(LAST_SCHEDULED_TIME_KEY, String(Date.now())),
    ]);
  } catch {
    // Non-critical
  }
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  try {
    await Promise.all([
      AsyncStorage.removeItem(LAST_SCHEDULED_KEY),
      AsyncStorage.removeItem(LAST_SCHEDULED_TIME_KEY),
      AsyncStorage.removeItem(SKIP_DATE_KEY),
    ]);
  } catch {
    // Non-critical
  }
}

/**
 * À appeler quand l'app passe en arrière-plan. Si on est dans les 2h avant
 * l'heure de la relance du soir et que l'utilisateur a déjà écrit à Lucy
 * pendant cette fenêtre, on annule la relance du jour (et on mémorise ce
 * choix pour que la reprogrammation automatique ne la remette pas).
 */
export async function skipTonightReminderIfAlreadyTalked(userId: string): Promise<void> {
  const now = new Date();
  const todayFiringTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    NOTIFICATION_HOUR,
    NOTIFICATION_MINUTE,
    0,
  );
  const windowStart = new Date(todayFiringTime.getTime() - TALK_WINDOW_BEFORE_MS);

  if (now < windowStart || now >= todayFiringTime) return;

  const lastMessageAt = await getLastMessageSentAt(userId);
  if (!lastMessageAt || lastMessageAt < windowStart.getTime()) return;

  const todayKey = dateKey(now);

  try {
    await AsyncStorage.setItem(SKIP_DATE_KEY, todayKey);
  } catch {
    // Non-critical — au pire la relance de ce soir s'affichera quand même.
  }

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notification of scheduled) {
      const data = notification.content.data;
      if (data?.type === REMINDER_TYPE && data?.date === todayKey) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }
  } catch {
    // Non-critical
  }
}
