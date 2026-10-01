/**
 * Écran « Ton compte » — la sortie du paywall, en trois variantes.
 *
 * POURQUOI IL EXISTE. Quand le paywall barre l'app, la personne y serait
 * enfermée : ni déconnexion, ni suppression de compte, alors que la guideline
 * 5.1.1(v) exige que la suppression reste atteignable depuis l'app. Trois cas
 * (depuis le 24 septembre 2026), lus dans l'état RevenueCat :
 *   - `lapsed`  : abonnement terminé (résiliation arrivée à terme). Ouvert par
 *                 la croix du paywall. « Tes conversations sont intactes. »
 *   - `billing` : abonnement terminé sur un PAIEMENT REFUSÉ (carte sans fonds,
 *                 expirée). Le paywall pousse cette fiche DE LUI-MÊME à son
 *                 arrivée (depuis le 27 septembre 2026) : la personne veut
 *                 payer, elle n'a pas à chercher la croix. Le bouton ouvre les
 *                 abonnements Apple : Apple retente le prélèvement tout seul,
 *                 l'accès revient sans rien refaire. Pas de bouton « Retour » :
 *                 le paywall ne lui sert à rien, et la fiche se referme par un
 *                 glissé vers le bas.
 *   - `wall`    : les cinq échanges offerts sont passés, jamais acheté. Ouvert
 *                 par le lien « Gérer mon compte » du paywall (pas de croix pour
 *                 le mur).
 *
 * FORME (refonte du 27 septembre 2026, maquettes
 * https://claude.ai/artifact/FKsSrhgRE9QQTDxi9ZSw36). Le haut garde le cadre —
 * visage, titre, sous-titre, jours passés ensemble — pour qu'on sache où l'on
 * est. Le vide du milieu, qui portait une citation en italique, est devenu un
 * fil : Lucy y écrit deux ou trois bulles, avec le rendu et la cadence exacts
 * du chat (mêmes styles de bulle, même indicateur « Lucy écrit », mêmes délais).
 * Le bouton est celui de l'onboarding (dégradé, halo). Les actions de compte
 * tiennent sur deux lignes, toutes dans le même gris lisible : la suppression
 * n'est pas cachée (5.1.1(v)), elle est juste dernière. Le bouton et les
 * actions n'apparaissent qu'une fois la dernière bulle posée (cinq secondes au
 * plus) : décision de Vincent du 27 septembre 2026 — des boutons visibles
 * d'emblée, personne ne lit les bulles. Mouvement réduit : tout est là d'emblée.
 *
 * « Retrouver Lucy » et le glissé vers le bas ramènent au PAYWALL, jamais à
 * l'app : cet écran est poussé par-dessus lui.
 *
 * CE QU'IL N'EST PAS : une porte dérobée vers l'app. On n'y accède pas aux
 * fonctionnalités, et il ne complète jamais l'onboarding. Le seul chemin qui
 * rouvre l'accès reste un abonnement actif — repris ici par « Retrouver Lucy »
 * (retour au paywall) ou par la restauration d'un achat existant.
 *
 * TON. C'est l'ultime écran avant une suppression : il peut faire douter, pas
 * retenir. Lucy constate (elle est là, elle se souvient, l'essai est offert),
 * elle ne supplie pas et ne culpabilise pas — l'étude De Freitas et al. (HBS,
 * 2025) sur les adieux des compagnons IA montre que le ton qui retient fait
 * rester sur le moment et partir pour de bon ensuite. Elle ne dit que du vrai :
 * pas de « sans engagement » (faux si l'on n'annule pas), et l'essai n'est
 * promis que si le paywall sait que la personne y a droit.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Purchases from 'react-native-purchases';
import {
  PREMIUM_ENTITLEMENT_ID,
  hasBillingIssue,
  hasPremium,
  isPurchasesConfigured,
} from '@/utils/purchases';
import { usePurchases } from '@/contexts/PurchasesContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { STORE_NAME, STORE_SUBSCRIPTIONS_URL } from '@/utils/store';
import { LUCY_BUBBLE_GAP_MS, lucyBubbleTypingDelayMs } from '@/utils/lucyBubbles';
import { ChatTypingIndicator } from '@/components/ChatTypingIndicator';
import { MESSAGE_ENTERING, bubbleStyles } from '@/components/MessageBubble';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { OnbColors, OnbRadius, OnbSpacing } from '@/constants/onboardingTheme';
import { LUCY_AVATAR_CROP as AVATAR_CROP } from '@/constants/lucyAvatar';

const MS_PER_DAY = 86_400_000;

/** Le fil respire un instant avant que Lucy « écrive » : l'écran finit d'arriver. */
const FIRST_BUBBLE_DELAY_MS = 500;

/** Numéro du jour calendaire local (minuit à minuit) qui contient cet instant. */
function localDayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}

/**
 * Jours passés ensemble = jours calendaires entre le début et la fin, les deux
 * bornes incluses (du 1er au 10 septembre : 10). Jamais moins de 1.
 */
function daysBetweenInclusive(startMs: number, endMs: number): number {
  return Math.max(1, localDayIndex(endMs) - localDayIndex(startMs) + 1);
}

/**
 * Le fil de Lucy : ses bulles arrivent une à une, précédées des trois points,
 * à la cadence du chat (0,6 s + 25 ms par caractère, plafond 2,5 s, puis 400 ms
 * de pause). Mêmes composants que le fil : la personne voit exactement ce
 * qu'elle vient de quitter. Mouvement réduit : tout est là d'emblée.
 */
function LucyThread({
  texts,
  reduced,
  onDone,
}: {
  texts: string[];
  reduced: boolean;
  /** Dernière bulle posée (et sa pause écoulée) : les actions peuvent arriver. */
  onDone: () => void;
}) {
  const [shown, setShown] = useState(reduced ? texts.length : 0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) fn();
        }, ms),
      );
    };
    let at = FIRST_BUBBLE_DELAY_MS;
    texts.forEach((text, index) => {
      after(at, () => setTyping(true));
      at += lucyBubbleTypingDelayMs(text);
      after(at, () => {
        setTyping(false);
        setShown(index + 1);
      });
      at += LUCY_BUBBLE_GAP_MS;
    });
    after(at, onDone);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [texts, reduced, onDone]);

  return (
    <View style={styles.thread}>
      {texts.slice(0, shown).map((text, index) => (
        <Animated.View key={index} entering={reduced ? undefined : MESSAGE_ENTERING}>
          <View style={[bubbleStyles.messageBubble, bubbleStyles.aiMessage]}>
            <Text style={[bubbleStyles.messageText, bubbleStyles.aiMessageText]}>{text}</Text>
          </View>
        </Animated.View>
      ))}
      {typing && <ChatTypingIndicator />}
    </View>
  );
}

/** La ligne de réassurance sous le bouton, avec sa partie en gras (balisée `__x__`). */
function TrustLine({ text }: { text: string }) {
  const parts = text.split('__');
  return (
    <Text style={styles.trust}>
      {parts.length === 3 ? (
        <>
          {parts[0]}
          <Text style={styles.trustStrong}>{parts[1]}</Text>
          {parts[2]}
        </>
      ) : (
        text
      )}
    </Text>
  );
}

export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { profile, signOut } = useAuth();
  const { customerInfo, subscriptionLapsed, refreshCustomerInfo } = usePurchases();
  const handleDeleteAccount = useDeleteAccount();
  const [restoring, setRestoring] = useState(false);
  // Vrai une fois le fil écrit : les actions apparaissent alors, et restent
  // même si le fil repart (variante changée par une réponse RevenueCat tardive).
  const [threadDone, setThreadDone] = useState(false);
  const handleThreadDone = useCallback(() => setThreadDone(true), []);
  // Le bloc des actions est monté dès le départ (il tient sa place, le fil ne
  // saute pas) mais invisible ; il se révèle en fondu quand le fil est écrit.
  const actionsReveal = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!threadDone) return;
    actionsReveal.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
  }, [threadDone, actionsReveal]);
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: actionsReveal.value,
    transform: [{ translateY: (1 - actionsReveal.value) * 10 }],
  }));

  // Le paywall transmet ce qu'il sait de l'essai et du rappel, pour que la
  // fiche dise exactement ce qu'il affiche lui-même : `trialDays` vide quand
  // l'essai est déjà consommé ou que les prix ne sont pas connus (le paywall
  // n'annonce alors pas d'essai non plus) ; `reminder` à '1' si les
  // notifications sont acceptées, seul cas où l'on promet un rappel.
  const params = useLocalSearchParams<{ trialDays?: string; reminder?: string }>();
  const parsedTrial = Number.parseInt(params.trialDays ?? '', 10);
  const trialDays = Number.isFinite(parsedTrial) && parsedTrial > 0 ? parsedTrial : null;
  const reminderOn = params.reminder === '1';

  const firstName = (profile?.first_name ?? '').trim();

  // Variante de l'écran (voir l'en-tête).
  const mode: 'lapsed' | 'billing' | 'wall' = !subscriptionLapsed
    ? 'wall'
    : hasBillingIssue(customerInfo)
      ? 'billing'
      : 'lapsed';

  // Les bulles de Lucy selon la variante. Prénom en tête quand on l'a : c'est
  // à cette personne qu'elle parle. Mémoïsées : le fil en dépend pour ne pas
  // repartir de zéro à chaque rendu.
  const bubbles = useMemo(() => {
    const named = (key: string) =>
      firstName ? t(`onboarding:account.${key}`, { firstName }) : t(`onboarding:account.${key}NoName`);
    if (mode === 'billing') {
      return [named('billingBubble1'), t('onboarding:account.billingBubble2', { store: STORE_NAME })];
    }
    if (mode === 'lapsed') {
      return [named('lapsedBubble')];
    }
    return [
      named('wallBubble1'),
      t('onboarding:account.wallBubble2'),
      trialDays != null
        ? t('onboarding:account.wallBubble3', { days: trialDays })
        : t('onboarding:account.wallBubble3NoTrial'),
    ];
  }, [mode, firstName, trialDays, t]);

  /**
   * Abonnements de la boutique : la feuille système quand elle existe (iOS 15+,
   * Android), sinon la page du compte. C'est là que la boutique signale le
   * paiement en attente et propose de mettre à jour le moyen de paiement.
   */
  const handleManageBilling = useCallback(async () => {
    try {
      if (isPurchasesConfigured()) {
        await Purchases.showManageSubscriptions();
        return;
      }
    } catch (e) {
      console.warn('[account] showManageSubscriptions :', e);
    }
    Linking.openURL(STORE_SUBSCRIPTIONS_URL).catch(() => {});
  }, []);

  // Jours passés ensemble : tous les jours où l'abonnement (essai compris) était
  // actif, du premier achat à la dernière date de fin. On s'arrête à la fin de
  // l'accès, pas au jour de la résiliation ni à aujourd'hui : quelqu'un qui
  // revient trois mois après ne se voit pas compter trois mois d'absence.
  // Limite connue : entre deux abonnements séparés par un trou, le trou est
  // compté (RevenueCat ne donne pas l'historique des périodes). Repli, si
  // l'entitlement manquait, sur la création du compte — cet écran ne s'ouvre
  // qu'une fois RevenueCat interrogé, ce cas est théorique. Aucune requête.
  const premium = customerInfo?.entitlements.all[PREMIUM_ENTITLEMENT_ID];
  const daysTogether =
    premium?.expirationDateMillis != null
      ? daysBetweenInclusive(premium.originalPurchaseDateMillis, premium.expirationDateMillis)
      : profile?.created_at
        ? daysBetweenInclusive(new Date(profile.created_at).getTime(), Date.now())
        : 0;

  /** Retour au paywall. `back()` préserve la pile ; sinon on la repose. */
  const handleResubscribe = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(onboarding)/paywall');
  }, [router]);

  /**
   * Restauration. Pas de navigation ici : si l'entitlement redevient actif,
   * `subscriptionLapsed` retombe à faux et la garde de `app/_layout.tsx` pose
   * elle-même `/(app)`. Naviguer en plus courserait cette garde.
   */
  const handleRestore = useCallback(async () => {
    if (restoring) return;
    Haptics.selectionAsync().catch(() => {});

    if (!isPurchasesConfigured()) {
      Alert.alert('', t('onboarding:paywall.restoreNone'));
      return;
    }

    setRestoring(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (hasPremium(customerInfo)) {
        await refreshCustomerInfo();
      } else {
        Alert.alert('', t('onboarding:paywall.restoreNone'));
      }
    } catch (e) {
      console.warn('[account] restorePurchases :', e);
      Alert.alert('', t('onboarding:paywall.restoreError'));
    } finally {
      setRestoring(false);
    }
  }, [restoring, t, refreshCustomerInfo]);

  const handleSignOut = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    Alert.alert(
      t('settings:logout.confirmTitle'),
      t('settings:logout.confirmMessage'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('settings:logout.confirm'),
          style: 'destructive',
          onPress: () => {
            signOut().catch(() => {});
          },
        },
      ]
    );
  }, [t, signOut]);

  const avatarSize = 88;

  const title =
    mode === 'wall'
      ? t('onboarding:account.wallTitle')
      : mode === 'billing'
        ? t('onboarding:account.billingTitle')
        : t('onboarding:account.title');
  const subtitle =
    mode === 'wall'
      ? t('onboarding:account.wallSubtitle')
      : mode === 'billing'
        ? t('onboarding:account.billingSubtitle')
        : t('onboarding:account.subtitle');

  // La ligne sous le bouton ne vaut que pour le mur, et seulement si l'essai
  // est acquis : on ne promet rien qu'on ne tient (ni essai, ni rappel).
  const trustLine =
    mode === 'wall' && trialDays != null
      ? t(reminderOn ? 'onboarding:account.trustReminder' : 'onboarding:account.trust', {
          days: trialDays,
        })
      : null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 24) + 28,
            paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) + 12,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(600)} style={styles.header}>
          <View
            style={[
              styles.avatarRing,
              { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
            ]}
          >
            <Image
              source={require('../../assets/images/lucy-avatar.png')}
              style={{
                position: 'absolute',
                width: avatarSize * AVATAR_CROP.width,
                height: avatarSize * AVATAR_CROP.height,
                left: avatarSize * AVATAR_CROP.left,
                top: avatarSize * AVATAR_CROP.top,
              }}
              resizeMode="stretch"
            />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {mode === 'lapsed' && daysTogether >= 1 && (
            <View style={styles.daysPill}>
              <Text style={styles.daysLabel}>
                {t('onboarding:account.daysTogether', { count: daysTogether })}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Le fil : les bulles s'ancrent en bas, contre le bouton, comme dans le
            chat. La clé relance le fil si la variante change sous nos pieds
            (RevenueCat qui répond pendant l'affichage). */}
        <LucyThread
          key={bubbles.join('\n')}
          texts={bubbles}
          reduced={reduced}
          onDone={handleThreadDone}
        />

        {/* Les actions n'arrivent qu'une fois le fil écrit (voir l'en-tête).
            Le bloc garde sa place dès le départ : le fil ne saute pas quand
            elles apparaissent. */}
        <Animated.View
          style={[styles.actions, actionsStyle]}
          pointerEvents={threadDone ? 'auto' : 'none'}
        >
          {mode === 'billing' ? (
            <OnboardingButton
              label={t('onboarding:account.billingCta')}
              onPress={handleManageBilling}
              disabled={restoring}
            />
          ) : (
            <OnboardingButton
              label={t('onboarding:account.resubscribe')}
              onPress={handleResubscribe}
              disabled={restoring}
            />
          )}

          {trustLine != null && <TrustLine text={trustLine} />}

          <View style={styles.linkRow}>
            <Pressable
              onPress={handleRestore}
              disabled={restoring}
              hitSlop={8}
              style={styles.link}
              accessibilityRole="button"
            >
              {restoring ? (
                <ActivityIndicator size="small" color={OnbColors.muted} />
              ) : (
                <Text style={styles.linkLabel}>{t('onboarding:account.restore')}</Text>
              )}
            </Pressable>
            <Text style={styles.linkDot}>·</Text>
            <Pressable
              onPress={handleSignOut}
              hitSlop={8}
              style={styles.link}
              accessibilityRole="button"
            >
              <Text style={styles.linkLabel}>{t('onboarding:account.signOut')}</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={handleDeleteAccount}
            hitSlop={8}
            style={[styles.link, styles.deleteLink]}
            accessibilityRole="button"
          >
            <Text style={styles.linkLabel}>{t('onboarding:account.deleteAccount')}</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OnbColors.bg,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: OnbSpacing.screenX,
  },
  header: {
    alignItems: 'center',
    gap: 14,
  },
  avatarRing: {
    borderWidth: 2.5,
    borderColor: OnbColors.primary,
    overflow: 'hidden',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
    letterSpacing: -0.3,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: OnbColors.muted,
    textAlign: 'center',
    marginTop: -6,
  },
  daysPill: {
    backgroundColor: OnbColors.bgWarmDeep,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: OnbRadius.pill,
    marginTop: 2,
  },
  daysLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: OnbColors.primaryDeep,
  },
  // Le fil prend tout le milieu et pousse ses bulles vers le bas, contre le
  // bouton. Hauteur minimale : trois bulles et l'indicateur, pour que le bouton
  // ne remonte pas pendant que Lucy écrit.
  thread: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    minHeight: 150,
    marginTop: 22,
    marginBottom: 18,
  },
  actions: {
    gap: 0,
  },
  trust: {
    fontSize: 12.5,
    lineHeight: 18,
    color: OnbColors.muted,
    textAlign: 'center',
    marginTop: 10,
  },
  trustStrong: {
    fontWeight: '700',
    color: OnbColors.inkSoft,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  link: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  linkLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: OnbColors.muted,
  },
  linkDot: {
    fontSize: 14,
    fontWeight: '600',
    color: OnbColors.hairline,
    marginHorizontal: 8,
  },
  deleteLink: {
    alignSelf: 'center',
    marginTop: 2,
  },
});
