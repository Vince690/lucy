import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Keyboard,
  ActivityIndicator,
  AppState,
  Platform,
  type FlatListProps,
  type LayoutChangeEvent,
} from 'react-native';
import { KeyboardGestureArea, useKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedRef,
  runOnUI,
  scrollTo,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Send, ArrowDown } from 'lucide-react-native';
import { ChatTypingIndicator } from '@/components/ChatTypingIndicator';
import { MessageBubble, MESSAGE_ENTERING, bubbleStyles, type BubbleFrame } from '@/components/MessageBubble';
import { MessageActionsOverlay, type MessageActionsTarget } from '@/components/MessageActionsOverlay';
import { MoodCheckInCards } from '@/components/MoodCheckInCards';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/utils/supabase';
import { sendChatMessage, LucyApiError, FREE_EXCHANGES_EXHAUSTED } from '@/utils/lucyApi';
import {
  loadLucyConversationId,
  saveLucyConversationId,
  saveLastMessageSentAt,
  savePendingLucyFirstMessage,
  bumpDailySentCount,
  consumePendingChatSurfaceReset,
  consumePendingLucyFirstMessage,
} from '@/utils/lucyConversationStorage';
import { FREE_EXCHANGES_LIMIT, hasReachedWall } from '@/constants/chatGate';
import { usePurchases } from '@/contexts/PurchasesContext';
import { hasPremium, isPurchasesConfigured } from '@/utils/purchases';
import { handOffWallPatch } from '@/utils/chatWallHandoff';
import { startOrangeZoom } from '@/utils/orangeTransition';
import { FirstMessageDeck } from '@/components/FirstMessageDeck';
import { fetchLatestMessages, fetchMessages, type DbMessage } from '@/utils/lucyMessages';
import {
  LUCY_BUBBLE_GAP_MS,
  LUCY_BURST_GRACE_MS,
  LUCY_BURST_MAX_HOLD_MS,
  lucyBubbleId,
  lucyBubbleTypingDelayMs,
  splitLucyBubbles,
} from '@/utils/lucyBubbles';
import { useFocusEffect, useRouter } from 'expo-router';
import { track } from '@/utils/analytics';
import { CHAT_DAILY_MESSAGE_THRESHOLD, maybeRequestReview } from '@/utils/appReview';
import { getMoodDateInTimezone, resolveUserTimezoneFromProfile } from '@/utils/lucyMoodStats';
import {
  MOOD_CHECKIN_EARLIEST_HOUR,
  clearMoodCheckInState,
  getHourInTimezone,
  hasUserMessageBefore,
  hasMoodEntryOn,
  insertLucyMessages,
  pickMoodCheckInTexts,
  readMoodCheckInState,
  saveMoodFromChat,
  writeMoodCheckInState,
} from '@/utils/moodCheckIn';

// ============================================================================
// Types
// ============================================================================

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  /** Erreur éventuelle sur ce message (affiché sous la bulle). */
  error?: string | null;
  /** true uniquement pour les messages envoyés/reçus pendant cette session (animation d'entrée). */
  isNew?: boolean;
}

interface DateSeparatorItem {
  id: string;
  type: 'date_separator';
  label: string;
}

/** Le carrousel des cinq cartes d'humeur, posé en bas du fil sous la question de Lucy. */
interface MoodCardsItem {
  id: 'mood_cards';
  type: 'mood_cards';
}

const MOOD_CARDS_ITEM: MoodCardsItem = { id: 'mood_cards', type: 'mood_cards' };

/** La pile de trois brouillons de premier message, sous l'accueil de Lucy (components/FirstMessageDeck). */
interface FirstCardsItem {
  id: 'first_cards';
  type: 'first_cards';
}

const FIRST_CARDS_ITEM: FirstCardsItem = { id: 'first_cards', type: 'first_cards' };

type ListItem = Message | DateSeparatorItem | MoodCardsItem | FirstCardsItem;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Messages en base → bulles à l'écran. Une réponse de Lucy est stockée en une ligne
 * avec ses retours à la ligne ; ici chaque ligne devient une bulle (voir utils/lucyBubbles).
 * Les messages de l'utilisateur restent entiers.
 */
function dbMessagesToBubbles(dbMessages: DbMessage[]): Message[] {
  const bubbles: Message[] = [];
  for (const m of dbMessages) {
    const timestamp = new Date(m.created_at);
    if (m.role === 'user') {
      bubbles.push({ id: m.id, text: m.content, isUser: true, timestamp });
      continue;
    }
    splitLucyBubbles(m.content).forEach((text, index) => {
      bubbles.push({ id: lucyBubbleId(m.id, index), text, isUser: false, timestamp });
    });
  }
  return bubbles;
}

// ============================================================================
// Zone de saisie
// ============================================================================

const INPUT_LINE_HEIGHT = 20;
const INPUT_VERTICAL_PADDING = 6.5;
/**
 * Le champ grandit jusqu'à cinq lignes, puis défile. La hauteur maximale est
 * un nombre ENTIER de lignes : avec un plafond arbitraire (100 pt), la
 * cinquième ligne n'ajoutait que quelques points — un « demi-étage » qui
 * cachait la moitié de la ligne et se voyait à chaque retour chariot.
 */
const INPUT_MAX_LINES = 5;
const INPUT_MAX_HEIGHT = INPUT_MAX_LINES * INPUT_LINE_HEIGHT + INPUT_VERTICAL_PADDING * 2;

const IS_IOS = Platform.OS === 'ios';
/** Zone de prise du geste clavier (Android) ; simple vue sur iOS. */
const ListArea: React.ComponentType<React.ComponentProps<typeof KeyboardGestureArea>> = IS_IOS
  ? ({ children, style }) => <View style={style}>{children}</View>
  : KeyboardGestureArea;
/** Espace entre le bas de la zone de saisie et le haut du clavier. */
const COMPOSER_KEYBOARD_GAP = 8;

/**
 * Marge sous la zone de saisie : 8 pt au-dessus du clavier tant qu'il est là,
 * et la zone de sécurité (barre home) seulement sur les derniers points, une
 * fois le clavier descendu plus bas qu'elle. Une interpolation sur tout le
 * trajet faisait grandir l'écart entre la saisie et le clavier pendant le geste.
 */
function composerBottomPadding(keyboard: number, safeBottom: number): number {
  'worklet';
  return Math.max(COMPOSER_KEYBOARD_GAP, safeBottom - keyboard);
}

/** Tout ce qui recouvre le bas du fil : clavier, rangée de saisie et sa marge basse. */
function coveredBottom(keyboard: number, composer: number, safeBottom: number): number {
  'worklet';
  return keyboard + composer + composerBottomPadding(keyboard, safeBottom);
}

/**
 * De combien la zone de saisie remonte pour une hauteur de clavier donnée
 * (iOS). Sa marge basse fixe vaut la zone de sécurité ; le clavier en avale
 * d'abord l'excédent, puis la pousse. Une translation plutôt qu'une marge
 * animée : elle se pose sans recalcul de mise en page, d'un seul coup.
 */
function composerShift(keyboard: number, safeBottom: number): number {
  'worklet';
  return keyboard + composerBottomPadding(keyboard, safeBottom) - composerBottomPadding(0, safeBottom);
}

// ============================================================================
// Composant principal
// ============================================================================

export default function ChatScreen() {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const insets = useSafeAreaInsets();
  const { session, profile, patchProfile } = useAuth();
  const { customerInfo } = usePurchases();
  const router = useRouter();

  // Hauteur du clavier, en points. Cette seule valeur pilote la zone de
  // saisie, la marge basse du fil et le bouton « descendre » : les trois
  // bougent toujours ensemble.
  //
  // Sur iOS, elle ne change qu'une fois par ouverture ou fermeture : au signal
  // « le clavier va bouger », qu'iOS envoie depuis l'intérieur de sa propre
  // animation. Tout ce qui est posé à cet instant (translation de la saisie,
  // marge et position du fil) est animé par iOS avec la courbe exacte du
  // clavier, sans aucun calcul pendant le mouvement. C'est le principe de la
  // bibliothèque elle-même (KeyboardStickyView, KeyboardChatScrollView). Le
  // suivi image par image essayé avant donnait, sur iOS 26, une saisie en
  // avance de deux images puis figée, puis rattrapant d'un saut. Seul le geste
  // du doigt (keyboardDismissMode « interactive ») reste suivi image par
  // image : là, rien n'est animé, la saisie suit la position réelle.
  //
  // Sur iOS, le fil occupe tout l'écran jusqu'en bas, sous la zone de saisie
  // et sous le clavier, et ne bouge jamais. Il porte seulement une marge
  // interne (contentInset) de la hauteur de ce qui le recouvre. Pendant le
  // geste, c'est le doigt qui fait glisser le contenu, exactement de la
  // distance parcourue par le clavier : les messages restent collés à la zone
  // de saisie, et l'espace libéré en haut découvre la suite du fil, comme
  // quand on agrandit une fenêtre. L'ancien montage translatait la liste
  // entière en plus du geste : le contenu défilait deux fois plus vite que le
  // clavier. Il calculait aussi la translation depuis la position de la liste
  // dans son parent, sans compter le header : la zone de saisie restait
  // cachée sous le clavier.
  const keyboardHeight = useSharedValue(0);
  /**
   * Mur en cours (sixième envoi) : le fil et la barre ne suivent plus le clavier.
   * Un seul mouvement à l'écran, le disque orange ; le clavier, vue du système
   * qu'on ne peut pas recouvrir, se range tout seul et découvre le fond de
   * l'écran, pas le fil qui descend. Décision de Vincent du 27 septembre 2026,
   * après la vidéo du 26 et la simulation (un sol orange sous le clavier a été
   * essayé et refusé).
   *
   * Ne passe à vrai qu'au mur, et ne revient jamais à faux : l'écran se démonte
   * derrière le disque. Tant que c'est faux, le clavier est suivi exactement
   * comme avant — les quatre gardes ci-dessous ne font rien d'autre.
   */
  const wallFrozen = useSharedValue(false);
  /** Hauteur de la rangée de saisie (marge haute comprise), mesurée à l'écran ; change quand le champ prend des lignes. */
  const composerHeight = useSharedValue(0);
  /** Position de défilement brute du fil, telle que la liste la remonte (au départ, collé en bas). */
  const scrollOffset = useSharedValue(IS_IOS ? -insets.bottom : 0);
  /**
   * Position de défilement imposée au fil (iOS). Envoyée à la liste dans la
   * même image que sa marge interne : les deux changent d'un seul coup, sans
   * qu'une image ne montre le fil décollé de la zone de saisie. Elle ne bouge
   * que quand le fil doit suivre (collé en bas au départ, comme sur WhatsApp ;
   * quelqu'un remonté dans l'historique reste où il est) ; le reste du temps
   * elle garde sa dernière valeur, et la liste, qui ne voit rien changer,
   * laisse le doigt maître.
   */
  const pinnedOffset = useSharedValue(-insets.bottom);
  const listRef = useAnimatedRef<FlatList<ListItem>>();

  /** Marge interne au bas du fil (iOS) : elle borne le défilement sans déplacer le contenu. */
  const listInset = useDerivedValue(() =>
    coveredBottom(keyboardHeight.value, composerHeight.value, insets.bottom)
  );

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        if (!IS_IOS || wallFrozen.value) return;
        // Reçu depuis l'intérieur de l'animation du clavier, avec sa hauteur
        // d'arrivée : tout est posé maintenant, d'un coup, et iOS anime.
        const wasAtBottom =
          scrollOffset.value <= -coveredBottom(keyboardHeight.value, composerHeight.value, insets.bottom) + 1;
        keyboardHeight.value = e.height;
        if (wasAtBottom) {
          pinnedOffset.value = -coveredBottom(e.height, composerHeight.value, insets.bottom);
        }
      },
      onMove: (e) => {
        'worklet';
        // Android seulement : là, rien n'anime à notre place.
        if (!IS_IOS && !wallFrozen.value) keyboardHeight.value = e.height;
      },
      onInteractive: (e) => {
        'worklet';
        // Pendant le geste, rien d'autre : le doigt fait glisser le contenu.
        if (!wallFrozen.value) keyboardHeight.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        if (wallFrozen.value) return;
        if (!IS_IOS) {
          keyboardHeight.value = e.height;
          return;
        }
        // La hauteur d'arrivée est déjà posée depuis le départ. Celle reçue ici
        // peut être lue en cours de route sur iOS 26 (bibliothèque 1.18) : on ne
        // la reprend que si elle contredit le sens du mouvement.
        if ((e.height === 0) !== (keyboardHeight.value === 0)) {
          keyboardHeight.value = e.height;
        }
        const rest = -coveredBottom(keyboardHeight.value, composerHeight.value, insets.bottom);
        // Clavier repoussé à la main jusqu'en bas : sur les derniers points, la
        // zone de saisie s'arrête sur la barre home alors que le doigt continue,
        // et le dernier message finit un peu sous elle. On le ressort, sans
        // toucher à quelqu'un remonté loin dans l'historique.
        const under = scrollOffset.value - rest;
        if (keyboardHeight.value === 0 && under > 0 && under < 60) {
          scrollTo(listRef, 0, rest, true);
        }
      },
    },
    [insets.bottom]
  );

  /**
   * Le champ vient de prendre ou de rendre une ligne (iOS) : si le fil était
   * collé en bas, il le reste. Hauteur et position sont posées ensemble, côté
   * animation, pour partir dans la même image.
   */
  const followComposerResize = useCallback(
    (previous: number, next: number) => {
      'worklet';
      const keyboard = keyboardHeight.value;
      const wasAtBottom = scrollOffset.value <= -coveredBottom(keyboard, previous, insets.bottom) + 1;
      composerHeight.value = next;
      if (wasAtBottom) {
        pinnedOffset.value = -coveredBottom(keyboard, next, insets.bottom);
      }
    },
    // Les valeurs partagées et la référence sont stables : seule la zone de sécurité peut changer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insets.bottom]
  );
  const onComposerLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.height;
      const previous = composerHeight.value;
      if (next === previous) return;
      if (IS_IOS) {
        runOnUI(followComposerResize)(previous, next);
      } else {
        composerHeight.value = next;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followComposerResize]
  );

  /** Message mis en avant par un appui long (flou + bouton Copier). */
  const [actionTarget, setActionTarget] = useState<MessageActionsTarget | null>(null);
  /**
   * Cartes d'humeur visibles sous la question de Lucy. Elles disparaissent dès
   * qu'une carte est touchée, ou dès que la personne écrit autre chose : elle a
   * choisi de parler, l'humeur reste à portée par le bouton du header.
   */
  const [moodCardsVisible, setMoodCardsVisible] = useState(false);
  const moodCardsVisibleRef = useRef(false);
  moodCardsVisibleRef.current = moodCardsVisible;
  /**
   * Pile des trois brouillons de premier message : visible tant que la personne
   * n'a jamais rien écrit à Lucy, retirée au premier envoi (ou dès qu'une carte
   * est touchée — son texte va dans la barre).
   */
  const [firstCardsVisible, setFirstCardsVisible] = useState(false);
  /** La personne a-t-elle déjà écrit à Lucy, un jour ? Sert à la pile et à `first_message_sent`. */
  const hasUserMessageRef = useRef(true);
  /** Texte de la carte reprise telle quelle, pour dire d'où vient le premier message. */
  const pickedCardRef = useRef<{ index: number; text: string } | null>(null);

  // Porte du chat (constants/chatGate.ts). La fonction de mise à jour locale du
  // profil est lue par des rappels créés une seule fois.
  const patchProfileRef = useRef(patchProfile);
  patchProfileRef.current = patchProfile;
  /** Limite annoncée par le serveur ; celle de l'app en attendant. */
  const freeLimitRef = useRef(FREE_EXCHANGES_LIMIT);
  /** Le mur est parti : plus rien ne s'envoie, on navigue. */
  const wallRef = useRef(false);
  /** Bouton Envoyer, mesuré au moment du mur : le disque orange part de son centre. */
  const sendButtonRef = useRef<View>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  /**
   * Défilement interne du champ : seulement une fois le champ à sa hauteur
   * maximale. Avant, iOS laissait défiler un champ vide ou d'une ligne, et un
   * doigt posé dessus faisait glisser ce vide au lieu du fil.
   *
   * Décidé d'après la HAUTEUR DU CHAMP (onLayout), pas d'après la taille du
   * texte : l'événement de taille de contenu n'est envoyé que quand la mise en
   * page change, et à partir de la cinquième ligne elle ne change plus — le
   * défilement ne s'activait jamais, et le texte s'écrivait hors du cadre.
   */
  const [inputScrollable, setInputScrollable] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  /**
   * Vrai de l'envoi jusqu'à la dernière bulle de Lucy. Distinct de isTyping (les trois
   * points), qui s'éteint entre deux bulles : sans ce verrou, le bouton Envoyer
   * redeviendrait actif pendant ces courts silences.
   */
  const [isReplying, setIsReplying] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  /** Prêt à envoyer : conversation_id local chargé (ou pas de session). Évite une course DB vs AsyncStorage. */
  const [conversationStorageReady, setConversationStorageReady] = useState(false);
  const buttonScale = useSharedValue(1);
  /** Bouton « descendre » : piloté entièrement côté animation, sans passer par un état React. */
  const scrollButtonVisible = useSharedValue(false);
  /** Dernier état des messages, lu par l'appui long sans recréer le callback à chaque message. */
  const messagesRef = useRef<Message[]>([]);

  // conversation_id persisté entre les envois (même session)
  const sentCountRef = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  /** Pour détecter changement de compte / déconnexion et vider le fil (confidentialité). */
  const prevAuthUserIdRef = useRef<string | null | undefined>(undefined);
  /** Séquence du message le plus ancien chargé, utilisée pour la pagination "load more". */
  const oldestMsgSeqRef = useRef<number | undefined>(undefined);
  /** Empêche l'auto-scroll vers le bas lors d'un chargement de messages plus anciens. */
  const suppressScrollRef = useRef(false);
  /** true uniquement au premier focus (montage) : permet au useEffect de gérer la séquence de bienvenue sans doublon avec useFocusEffect. */
  const justMountedRef = useRef(true);

  // Envoie la séquence de bienvenue Lucy (4 messages en DB + animation dripfeed).
  // C'est la rencontre elle-même, depuis le 23 septembre 2026 : la personne arrive
  // ici au bout du slider « faire connaissance », sous le voile orange, et Lucy
  // écrit ses quatre premiers messages en direct. Rejouée aussi après une remise
  // à zéro de la mémoire. À la fin, la pile de brouillons de premier message.
  const sendWelcomeSequence = useCallback(async (
    userId: string,
    firstName: string,
    isCancelled: () => boolean,
  ) => {
    setIsTyping(true);
    try {
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({ user_id: userId })
        .select('id')
        .single();

      if (convErr || !conv || isCancelled()) { setIsTyping(false); return; }

      const contents = [
        firstName
          ? t('chat:welcomeSeq1', { name: firstName })
          : t('chat:welcomeSeq1NoName'),
        t('chat:welcomeSeq2'),
        t('chat:welcomeSeq3'),
        t('chat:welcomeSeq4'),
      ];

      const { data: insertedMsgs, error: insertErr } = await supabase
        .from('messages')
        .insert(
          contents.map((content, idx) => ({
            conversation_id: conv.id,
            user_id: userId,
            role: 'assistant' as const,
            content,
            msg_seq: idx + 1,
          }))
        )
        .select('id, content, msg_seq, created_at')
        .order('msg_seq', { ascending: true });

      if (insertErr || !insertedMsgs || isCancelled()) { setIsTyping(false); return; }

      await supabase
        .from('conversations')
        .update({ next_msg_seq: 5 })
        .eq('id', conv.id);

      conversationIdRef.current = conv.id;
      await saveLucyConversationId(userId, conv.id);
      oldestMsgSeqRef.current = 1;
      setHasMoreMessages(false);

      // Indicateur de frappe visible ~1600ms
      await new Promise<void>((r) => setTimeout(r, 1600));
      if (isCancelled()) { setIsTyping(false); return; }
      setIsTyping(false);

      // Dripfeed : immédiat, +1200ms, +800ms, +800ms
      const delays = [0, 1200, 800, 800];
      for (let i = 0; i < insertedMsgs.length; i++) {
        if (i > 0) await new Promise<void>((r) => setTimeout(r, delays[i]));
        if (isCancelled()) return;
        const msg = insertedMsgs[i];
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            text: msg.content,
            isUser: false,
            timestamp: new Date(msg.created_at),
            isNew: true,
          },
        ]);
      }

      // Une respiration après « tu veux parler de quoi ? », puis les brouillons.
      await new Promise<void>((r) => setTimeout(r, 700));
      if (isCancelled()) return;
      hasUserMessageRef.current = false;
      setFirstCardsVisible(true);
    } catch {
      if (!isCancelled()) setIsTyping(false);
    }
  }, [t]);

  /**
   * Première venue de la journée, rien d'enregistré : Lucy dit bonjour, pose la
   * question, et les cartes apparaissent sous elle. Appelé à l'ouverture de
   * l'écran et à chaque retour de l'arrière-plan — jamais au milieu d'une
   * session : quelqu'un qui parle à Lucy quand 6 h sonne n'est pas interrompu,
   * il sera salué à sa prochaine venue. Une seule fois par jour, répondue ou
   * non ; les cartes, elles, reviennent après un redémarrage tant qu'aucune
   * humeur n'est enregistrée (voir utils/moodCheckIn). Jamais le premier
   * jour : il faut un message de la personne envoyé un jour précédent.
   *
   * Les deux messages sont écrits en base, comme la bienvenue : ils font partie
   * de l'historique et Lucy sait qu'elle a posé la question.
   */
  const askingRef = useRef(false);
  const maybeAskMood = useCallback(async (userId: string, isCancelled: () => boolean) => {
    if (askingRef.current) return;
    askingRef.current = true;
    try {
      const conversationId = conversationIdRef.current;
      if (!conversationId) return;
      const timezone = resolveUserTimezoneFromProfile(profileRef.current);
      if (getHourInTimezone(timezone) < MOOD_CHECKIN_EARLIEST_HOUR) return;
      const ymd = getMoodDateInTimezone(timezone);

      const state = await readMoodCheckInState(userId, ymd);
      if (state?.status === 'done' || state?.status === 'asking') return;
      if (isCancelled()) return;

      if (await hasMoodEntryOn(userId, ymd)) {
        await writeMoodCheckInState(userId, { ymd, status: 'done' });
        return;
      }
      if (isCancelled()) return;

      // Jamais le premier jour : « te revoilà » s'adresse à quelqu'un qui
      // revient. Rien n'est mémorisé, on revérifie à la prochaine venue.
      if (!(await hasUserMessageBefore(userId, ymd, timezone))) return;
      if (isCancelled()) return;

      // Question déjà posée (autre montage, redémarrage) : seules les cartes reviennent.
      if (state?.status === 'asked') {
        setMoodCardsVisible(true);
        return;
      }
      if (pendingRef.current.length > 0) return;

      await writeMoodCheckInState(userId, { ymd, status: 'asking', at: Date.now() });
      const contents = pickMoodCheckInTexts(t, getHourInTimezone(timezone));

      setIsTyping(true);
      await wait(900);
      let inserted;
      try {
        inserted = await insertLucyMessages(userId, conversationId, contents);
      } catch (err) {
        // Rien d'écrit : on lève le verrou, la question sera retentée à la prochaine venue.
        await clearMoodCheckInState(userId).catch(() => {});
        throw err;
      }
      await writeMoodCheckInState(userId, { ymd, status: 'asked' });

      for (let index = 0; index < inserted.length; index++) {
        if (index > 0) {
          await wait(LUCY_BUBBLE_GAP_MS);
          setIsTyping(true);
          await wait(lucyBubbleTypingDelayMs(inserted[index].content));
        }
        if (isCancelled()) { setIsTyping(false); return; }
        setIsTyping(false);
        const msg = inserted[index];
        setMessages((prev) => [
          ...prev,
          { id: msg.id, text: msg.content, isUser: false, timestamp: new Date(msg.created_at), isNew: true },
        ]);
      }

      await wait(350);
      if (isCancelled()) return;
      setMoodCardsVisible(true);
      track('mood_checkin_shown');
    } catch (err) {
      setIsTyping(false);
      console.warn('[ChatScreen] question d’humeur :', err);
    } finally {
      askingRef.current = false;
    }
  }, [t]);
  const maybeAskMoodRef = useRef(maybeAskMood);
  maybeAskMoodRef.current = maybeAskMood;

  // Retour de l'arrière-plan : la venue suivante, au sens de maybeAskMood.
  // Seulement depuis « background » : ouvrir le centre de notifications ou le
  // sélecteur d'apps rend l'app « inactive », ce n'est pas partir puis revenir.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    let previous = AppState.currentState;
    let cancelled = false;
    const subscription = AppState.addEventListener('change', (state) => {
      const cameBack = state === 'active' && previous === 'background';
      previous = state;
      if (!cameBack || messagesRef.current.length === 0) return;
      maybeAskMoodRef.current(userId, () => cancelled);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [session?.user?.id]);

  // Charger le conversation_id local + historique initial, réinitialiser si changement de compte
  useEffect(() => {
    const userId = session?.user?.id ?? null;
    const prev = prevAuthUserIdRef.current;

    if (prev !== undefined && prev !== userId) {
      // Le compteur d'envois repart aussi : sans cela, quelqu'un qui change de
      // compte sur le même téléphone hériterait du rang de messages du
      // précédent, et `is_first_of_session` ne serait jamais vrai pour lui.
      sentCountRef.current = 0;
      conversationIdRef.current = null;
      oldestMsgSeqRef.current = undefined;
      setHasMoreMessages(false);
      setMessages([]);
      setIsLoadingHistory(true);
    }
    prevAuthUserIdRef.current = userId;

    if (!userId) {
      conversationIdRef.current = null;
      setConversationStorageReady(true);
      setMessages([]);
      setIsLoadingHistory(false);
      return;
    }

    let cancelled = false;
    setConversationStorageReady(false);
    setIsLoadingHistory(true);

    (async () => {
      try {
        // Étape 1 : lire le conversation_id depuis AsyncStorage (local, rapide)
        const cachedConvId = await loadLucyConversationId(userId);
        if (cancelled) return;

        // Un chargement complet rend le fanion « vider l'écran après reset » caduc :
        // on le consomme ici, sinon il restait posé (le Chat est reconstruit au
        // retour des Paramètres, et le premier focus l'ignore) et rejouait la
        // séquence de bienvenue des jours plus tard, dans une nouvelle conversation.
        await consumePendingChatSurfaceReset(userId);

        conversationIdRef.current = cachedConvId;
        setConversationStorageReady(true);

        // Étape 2 : une seule query DB — par conversation_id si connu, par user_id sinon
        let dbMessages, hasMore;

        if (cachedConvId) {
          const result = await fetchMessages(cachedConvId);
          if (cancelled) return;
          dbMessages = result.messages;
          hasMore = result.hasMore;
        } else {
          const result = await fetchLatestMessages(userId);
          if (cancelled) return;
          dbMessages = result.messages;
          hasMore = result.hasMore;
          if (result.conversationId) {
            conversationIdRef.current = result.conversationId;
            await saveLucyConversationId(userId, result.conversationId);
          }
        }

        // Continuité après le mur : le message que la personne voulait envoyer
        // au sixième envoi attend, pré-écrit dans la barre — comme si un
        // contretemps avait empêché de l'envoyer. Un appui sur Envoyer, et Lucy
        // répond en direct.
        const pendingFirst = await consumePendingLucyFirstMessage(userId);
        if (pendingFirst && !cancelled) {
          setInputText(pendingFirst);
        }

        if (dbMessages.length === 0) {
          // Fire-and-forget : finally gère setIsLoadingHistory(false)
          sendWelcomeSequence(userId, profile?.first_name ?? '', () => cancelled);
          return;
        }

        // isNew non défini → messages historiques, pas d'animation d'entrée
        oldestMsgSeqRef.current = dbMessages[0].msg_seq;
        setHasMoreMessages(hasMore);
        setMessages(dbMessagesToBubbles(dbMessages));
        // Rien d'écrit encore (app fermée après l'accueil, par exemple) : la pile
        // de brouillons revient. Un historique tronqué compte comme déjà écrit.
        hasUserMessageRef.current = hasMore || dbMessages.some((m) => m.role === 'user');
        setFirstCardsVisible(!hasUserMessageRef.current && !pendingFirst);
        // Première ouverture de la journée : Lucy demande l'humeur (voir maybeAskMood).
        maybeAskMoodRef.current(userId, () => cancelled);
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  // sendWelcomeSequence et profile sont stables / non-critiques ici — on ne veut pas relire AsyncStorage à chaque changement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Après reset mémoire (Paramètres), le Chat est souvent démonté : fanion AsyncStorage + focus
  useFocusEffect(
    useCallback(() => {
      const userId = session?.user?.id;
      if (!userId) return;

      // Au montage, le useEffect principal gère déjà le chargement (et la séquence de
      // bienvenue si besoin). On laisse passer ce premier focus sans agir pour éviter
      // que les deux hooks déclenchent sendWelcomeSequence simultanément.
      const isFirstMount = justMountedRef.current;
      justMountedRef.current = false;
      if (isFirstMount) return;

      let cancelled = false;

      if (moodCardsVisibleRef.current) {
        const ymd = getMoodDateInTimezone(resolveUserTimezoneFromProfile(profileRef.current));
        hasMoodEntryOn(userId, ymd)
          .then((has) => {
            if (!has || cancelled) return;
            setMoodCardsVisible(false);
            writeMoodCheckInState(userId, { ymd, status: 'done' }).catch(() => {});
          })
          .catch(() => {});
      }
      consumePendingChatSurfaceReset(userId).then(async (didReset) => {
        if (cancelled || !didReset) return;
        conversationIdRef.current = null;
        oldestMsgSeqRef.current = undefined;
        setHasMoreMessages(false);
        setMessages([]);
        // On vérifie en base avant de rejouer l'accueil : si le reset a bien eu lieu,
        // il n'y a plus rien ; sinon on réaffiche simplement le fil existant.
        try {
          const result = await fetchLatestMessages(userId);
          if (cancelled) return;
          if (result.messages.length === 0) {
            sendWelcomeSequence(userId, profile?.first_name ?? '', () => cancelled);
            return;
          }
          if (result.conversationId) {
            conversationIdRef.current = result.conversationId;
            await saveLucyConversationId(userId, result.conversationId);
          }
          oldestMsgSeqRef.current = result.messages[0].msg_seq;
          setHasMoreMessages(result.hasMore);
          setMessages(dbMessagesToBubbles(result.messages));
        } catch {
          // Réseau indisponible : on laisse l'écran vide plutôt que d'inventer un accueil.
        }
      });

      return () => {
        cancelled = true;
      };
    }, [session?.user?.id, sendWelcomeSequence, profile?.first_name])
  );

  // Charger les 50 messages précédents (pagination)
  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !conversationIdRef.current || oldestMsgSeqRef.current === undefined) return;

    setIsLoadingMore(true);
    try {
      const { messages: dbMessages, hasMore } = await fetchMessages(
        conversationIdRef.current,
        oldestMsgSeqRef.current
      );

      if (dbMessages.length > 0) {
        // Signal d'attachement : on relit ce à quoi on tient.
        track('chat_history_loaded_more', { loaded_count: dbMessages.length });
        const newMessages = dbMessagesToBubbles(dbMessages);
        oldestMsgSeqRef.current = dbMessages[0].msg_seq;
        suppressScrollRef.current = true;
        setMessages((prev) => [...newMessages, ...prev]);
      }
      setHasMoreMessages(hasMore);
    } catch {
      // L'utilisateur peut réessayer en appuyant à nouveau
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore]);

  // --------------------------------------------------------------------------
  // Envoi de message (POST /chat), avec rafale façon SMS
  // --------------------------------------------------------------------------
  //
  // Appuyer sur Envoyer ne lance pas la requête tout de suite. Le message s'affiche, les
  // trois points aussi, et l'app attend LUCY_BURST_GRACE_MS. Si l'utilisateur retape
  // pendant ce délai, les points s'effacent et la requête attend son prochain envoi (et
  // ainsi de suite), avec un plafond de LUCY_BURST_MAX_HOLD_MS compté depuis la première
  // lettre du message suivant. Un champ vidé relâche la requête après le même battement
  // LUCY_BURST_GRACE_MS, sauf nouvelle frappe, qui redonne un plafond entier. Tout ce qui a été retenu part ensuite en UNE requête, les messages séparés par
  // un retour à la ligne : une seule ligne en base, une seule réponse de Lucy. À l'écran,
  // les bulles restent telles qu'elles ont été envoyées ; au rechargement de l'historique,
  // une rafale réapparaît en une bulle avec des retours à la ligne (choix assumé).
  //
  // Passer l'app en arrière-plan ou quitter l'écran envoie immédiatement : sinon les
  // messages retenus n'existeraient que sur l'écran et seraient perdus.

  /** Messages affichés mais pas encore envoyés au serveur. */
  const pendingRef = useRef<{ optimisticId: string; text: string }[]>([]);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Vrai tant que des messages sont retenus : le bouton Envoyer reste actif. */
  const [isHolding, setIsHolding] = useState(false);
  // Les minuteurs et l'envoi en arrière-plan lisent la session et le profil du moment,
  // pas ceux figés à la création de la fonction.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const customerInfoRef = useRef(customerInfo);
  customerInfoRef.current = customerInfo;

  /**
   * Le mur va-t-il tomber à cet envoi ? L'app le SAIT d'avance : le serveur lui
   * a dit à chaque réponse où en est le quota (free_exchanges_used), et
   * RevenueCat si un abonnement est actif. Quand les deux disent « épuisé, pas
   * abonné », le disque orange part du bouton à l'instant de l'appui — comme sur
   * l'ancien écran factice — au lieu d'attendre le refus du serveur (une bulle,
   * les trois points, le clavier qui tombe, puis le flash : la vidéo de Vincent
   * du 25 septembre 2026).
   *
   * Ce n'est qu'une PRÉVISION d'affichage. Le serveur reste seul juge : l'envoi
   * part quand même (voir sendText), c'est son refus qui pose le marqueur du mur,
   * et un envoi qu'il refuse sans que l'app l'ait prévu passe par le même mur
   * (flushPending, 402). Rien ne se contourne en trafiquant l'app.
   */
  const wallExpectedNow = useCallback((): boolean => {
    if (Platform.OS === 'web' || !isPurchasesConfigured()) return false;
    if (hasPremium(customerInfoRef.current)) return false;
    const p = profileRef.current;
    if (hasReachedWall(p)) return true;
    return (p?.free_exchanges_used ?? 0) >= freeLimitRef.current;
  }, []);

  const clearBurstTimers = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    if (maxHoldTimerRef.current) {
      clearTimeout(maxHoldTimerRef.current);
      maxHoldTimerRef.current = null;
    }
  }, []);

  /** Envoie au serveur tout ce qui est retenu, en une requête. */
  const flushPending = useCallback(async () => {
    clearBurstTimers();
    const pending = pendingRef.current;
    pendingRef.current = [];
    setIsHolding(false);
    if (pending.length === 0) return;

    const accessToken = sessionRef.current?.access_token;
    if (!accessToken) {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          text: '',
          isUser: false,
          timestamp: new Date(),
          error: t('chat:errorSession'),
          isNew: true,
        },
      ]);
      return;
    }

    const text = pending.map((p) => p.text).join('\n');
    setIsReplying(true);
    setIsTyping(true);
    const requestStartedAt = Date.now();

    try {
      const response = await sendChatMessage(
        accessToken,
        text,
        conversationIdRef.current
      );

      conversationIdRef.current = response.conversation_id;

      // Porte du chat : le serveur dit où en est le quota d'échanges offerts. On
      // le reflète dans le profil en mémoire pour poser le mur au bon envoi, sans
      // relire la base ni attendre un refus.
      if (typeof response.free_exchanges_limit === 'number' && response.free_exchanges_limit > 0) {
        freeLimitRef.current = response.free_exchanges_limit;
      }
      if (typeof response.free_exchanges_used === 'number') {
        patchProfileRef.current({ free_exchanges_used: response.free_exchanges_used });
      }

      // La latence du backend se lit ici : un temps de réponse qui se dégrade
      // finit par se voir dans la rétention, autant les avoir côte à côte.
      track('chat_response_received', {
        latency_ms: Date.now() - requestStartedAt,
        is_error: false,
        chat_access: response.chat_access ?? null,
        free_exchanges_used: response.free_exchanges_used ?? null,
      });

      // Une réponse = une ligne en base, mais autant de bulles que de lignes à l'écran.
      // La première s'affiche tout de suite ; les suivantes arrivent une à une, avec les
      // trois points entre deux, comme quelqu'un qui enchaîne les SMS.
      const bubbles = splitLucyBubbles(response.assistant_message.content);
      const assistantTimestamp = new Date(response.assistant_message.created_at);
      const pushBubble = (index: number) => {
        setMessages((prev) => [
          ...prev,
          {
            id: lucyBubbleId(response.assistant_message.id, index),
            text: bubbles[index],
            isUser: false,
            timestamp: assistantTimestamp,
            isNew: true,
          },
        ]);
      };

      // Les bulles retenues prennent l'identifiant du message serveur (suffixé au-delà
      // de la première) et son horodatage, mais restent des bulles séparées.
      const optimisticIds = pending.map((p) => p.optimisticId);
      const userTimestamp = new Date(response.user_message.created_at);
      setIsTyping(false);
      setMessages((prev) =>
        prev.map((m) => {
          const index = optimisticIds.indexOf(m.id);
          if (index === -1) return m;
          return {
            ...m,
            id: index === 0 ? response.user_message.id : `${response.user_message.id}#${index}`,
            timestamp: userTimestamp,
          };
        })
      );
      pushBubble(0);

      // Sauvegardé avant l'enchaînement des bulles : quitter l'écran pendant qu'elles
      // arrivent ne doit pas faire perdre le fil.
      const userId = sessionRef.current?.user?.id;
      if (userId) {
        try {
          await saveLucyConversationId(userId, response.conversation_id);
          await saveLastMessageSentAt(userId, Date.now());
        } catch (persistErr) {
          console.warn('[ChatScreen] saveLucyConversationId:', persistErr);
        }
      }

      for (let index = 1; index < bubbles.length; index++) {
        await wait(LUCY_BUBBLE_GAP_MS);
        setIsTyping(true);
        await wait(lucyBubbleTypingDelayMs(bubbles[index]));
        setIsTyping(false);
        pushBubble(index);
      }

      if (userId) {
        // Notation de l'app. Placé ICI et pas au moment de l'envoi : c'est le
        // seul endroit où l'on sait que l'échange a abouti. Demander une note
        // pendant que Lucy « tape », ou après une réponse en erreur, dépenserait
        // une des trois cartouches annuelles au pire moment.
        //
        // Conséquence assumée : un message dont la réponse échoue ne compte pas,
        // et une rafale compte pour un. Il faut donc quinze échanges RÉUSSIS, pas
        // quinze envois. C'est le sens voulu — une journée pleine d'erreurs n'est
        // pas une journée satisfaite.
        try {
          const profileNow = profileRef.current;
          const todayYmd = getMoodDateInTimezone(resolveUserTimezoneFromProfile(profileNow));
          const dailyCount = await bumpDailySentCount(userId, todayYmd);
          // Égalité stricte : au 16ᵉ message la question a déjà été posée, et
          // `>=` la reposerait à chaque message du reste de la journée.
          // `null` (stockage inaccessible) ne déclenche rien, volontairement.
          if (dailyCount === CHAT_DAILY_MESSAGE_THRESHOLD) {
            // Pas de `recentMood` ici : l'écran de chat ne connaît pas l'humeur
            // du jour. `todayYmd` laisse le module retrouver celle que le mood
            // tracker a mémorisée — quinze messages dans une journée peuvent
            // aussi bien être du plaisir qu'une crise.
            maybeRequestReview('chat_daily_volume', {
              accountCreatedAt: profileNow?.created_at,
              todayYmd,
            }).catch(() => {});
          }
        } catch (reviewErr) {
          console.warn('[ChatScreen] compteur de notation :', reviewErr);
        }
      }
    } catch (err) {
      const errorKey = getErrorKey(err);
      track('chat_response_received', {
        latency_ms: Date.now() - requestStartedAt,
        is_error: true,
        error_key: errorKey,
      });

      // Le serveur a refusé : échanges offerts épuisés, pas d'abonnement. C'est
      // le mur. Rien n'a été écrit : le texte attendra dans la barre après
      // l'achat. La bulle affichée reste sous le disque orange, l'écran se
      // démonte avec elle.
      if (err instanceof LucyApiError && err.code === FREE_EXCHANGES_EXHAUSTED) {
        if (Platform.OS === 'web') {
          // Pas de StoreKit sur le web : le mur n'y mène nulle part, on le dit.
          const optimisticIds = pending.map((p) => p.optimisticId);
          setMessages((prev) => [
            ...prev.filter((m) => !optimisticIds.includes(m.id)),
            { id: `error-${Date.now()}`, text: '', isUser: false, timestamp: new Date(), error: t('chat:errorFreeExhausted'), isNew: true },
          ]);
        } else {
          hitWallRef.current(text, err.body);
        }
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          text: '',
          isUser: false,
          timestamp: new Date(),
          error: t(errorKey),
          isNew: true,
        },
      ]);
    } finally {
      setIsTyping(false);
      setIsReplying(false);
    }
  }, [t, clearBurstTimers]);

  /**
   * Le mur — sixième envoi sans abonnement (voir constants/chatGate.ts). Deux
   * chemins y mènent : la prévision de l'app à l'appui (wallExpectedNow, le cas
   * normal, sans latence), ou le refus du serveur (402) quand l'app ne l'avait
   * pas vu venir. Le serveur pose le marqueur dans les deux cas.
   *
   * Le message n'a pas été écrit : il est gardé pour être pré-rempli dans la
   * barre après l'achat (savePendingLucyFirstMessage). Le disque orange part du
   * centre du bouton Envoyer, mesuré AVANT de ranger le clavier (mesuré après, il
   * partait du bas de l'écran). Le disque couvre l'écran
   * (components/OrangeTransitionLayer), et l'écran cadeau apparaît dessous, sous
   * son propre voile orange qui se dissout : cadeau → frise de l'essai → paywall.
   *
   * Le marqueur du mur n'est PAS écrit dans le profil ici : la garde de la racine
   * referme l'app dès qu'elle le voit, et si elle le voit avant que l'écran cadeau
   * soit monté, elle saute au paywall (cadeau et frise perdus). Le chat dépose la
   * retouche (utils/chatWallHandoff), l'écran cadeau l'applique une fois en place.
   */
  const hitWall = useCallback((text: string, body: { free_exchanges_used?: number; free_exchanges_limit?: number; chat_wall_reached_at?: string } | null) => {
    if (wallRef.current) return;
    wallRef.current = true;
    clearBurstTimers();
    pendingRef.current = [];
    setIsHolding(false);
    setIsTyping(false);
    setIsReplying(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    const limit = body?.free_exchanges_limit;
    if (typeof limit === 'number' && limit > 0) freeLimitRef.current = limit;
    track('chat_wall_reached', {
      free_exchanges_used: body?.free_exchanges_used ?? profileRef.current?.free_exchanges_used ?? null,
      free_exchanges_limit: freeLimitRef.current,
      message_length: text.length,
      session_message_count: sentCountRef.current,
    });

    const userId = sessionRef.current?.user?.id;
    if (userId && text) {
      savePendingLucyFirstMessage(userId, text).catch(() => {});
    }

    const go = () => {
      handOffWallPatch({
        chat_wall_reached_at: body?.chat_wall_reached_at ?? new Date().toISOString(),
        free_exchanges_used: Math.max(body?.free_exchanges_used ?? 0, freeLimitRef.current),
      });
      router.replace('/(onboarding)/gift');
    };
    // Le bouton est mesuré LÀ OÙ IL EST, clavier ouvert ; puis le clavier se range
    // à l'instant même où le disque part. Le clavier est une vue du système, rien
    // dans l'app ne le recouvre : il faut bien qu'il tombe quelque part, et il vaut
    // mieux que ce soit pendant que le disque grossit (chute ~250 ms, disque
    // 480 ms) plutôt qu'après, sur un écran déjà tout orange, où sa chute passait
    // pour un bug (vidéo de Vincent du 26 septembre 2026). Pendant ce temps, le
    // fil et la barre restent EXACTEMENT où ils sont (wallFrozen) : un seul
    // mouvement, le disque. À l'arrivée sur l'écran cadeau, le clavier est parti
    // depuis longtemps : le voile se dissout sans attendre.
    const launch = (origin: { x: number; y: number; size: number }) => {
      wallFrozen.value = true;
      startOrangeZoom(origin, go);
      Keyboard.dismiss();
    };
    const node = sendButtonRef.current;
    if (node) {
      node.measureInWindow((x, y, w, h) => {
        if (Number.isFinite(x) && Number.isFinite(y) && w > 0) {
          launch({ x: x + w / 2, y: y + h / 2, size: w });
        } else {
          launch({ x: 0, y: 0, size: 36 });
        }
      });
    } else {
      launch({ x: 0, y: 0, size: 36 });
    }
  }, [clearBurstTimers, router, wallFrozen]);
  const hitWallRef = useRef(hitWall);
  hitWallRef.current = hitWall;

  // Les minuteurs et l'écouteur d'arrière-plan appellent toujours la version courante.
  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;

  // Arrière-plan ou écran quitté : ce qui est retenu part tout de suite.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && pendingRef.current.length > 0) {
        flushPendingRef.current();
      }
    });
    return () => {
      subscription.remove();
      if (pendingRef.current.length > 0) {
        flushPendingRef.current();
      }
    };
  }, []);

  /** Envoie un texte comme si la personne l'avait tapé : bouton Envoyer, ou carte d'humeur touchée. */
  const sendText = useCallback((text: string) => {
    if (!text) return;
    if (wallRef.current) return;

    if (session?.user?.id && !conversationStorageReady) {
      return;
    }

    // Écrire, c'est renoncer aux brouillons : la pile s'efface.
    setFirstCardsVisible(false);

    // Écrire autre chose que répondre aux cartes : elles s'effacent pour la journée.
    if (moodCardsVisibleRef.current) {
      moodCardsVisibleRef.current = false;
      setMoodCardsVisible(false);
      track('mood_checkin_dismissed');
      const dismissUserId = sessionRef.current?.user?.id;
      if (dismissUserId) {
        const ymd = getMoodDateInTimezone(resolveUserTimezoneFromProfile(profileRef.current));
        writeMoodCheckInState(dismissUserId, { ymd, status: 'done' }).catch(() => {});
      }
    }

    if (!session?.access_token) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: '',
          isUser: false,
          timestamp: new Date(),
          error: t('chat:errorSession'),
          isNew: true,
        },
      ]);
      return;
    }

    // Sixième envoi prévu : le mur tout de suite, à l'appui, ni bulle ni trois
    // points. L'envoi part quand même, en silence, pour que le serveur tranche
    // et pose le marqueur ; sa réponse rejoint le profil par le relais du mur.
    // S'il acceptait malgré tout (le quota local était faux), le message aurait
    // été livré et répondu : il se lira dans le fil après l'abonnement.
    if (wallExpectedNow()) {
      const accessToken = session.access_token;
      const conversationId = conversationIdRef.current;
      hitWallRef.current(text, null);
      sendChatMessage(accessToken, text, conversationId)
        .then((response) => {
          if (typeof response.free_exchanges_used === 'number') {
            handOffWallPatch({ free_exchanges_used: response.free_exchanges_used });
          }
        })
        .catch((err) => {
          if (err instanceof LucyApiError && err.code === FREE_EXCHANGES_EXHAUSTED) {
            const body = err.body;
            handOffWallPatch({
              ...(typeof body?.chat_wall_reached_at === 'string' ? { chat_wall_reached_at: body.chat_wall_reached_at } : {}),
              ...(typeof body?.free_exchanges_used === 'number' ? { free_exchanges_used: body.free_exchanges_used } : {}),
            });
          }
          // Autre erreur (réseau, 503) : le serveur n'a pas posé le marqueur.
          // Le mur est quand même montré ; sans marqueur, la prochaine ouverture
          // rouvre l'app et le prochain envoi refera la même chose. Pas de faille :
          // rien n'est passé.
        });
      return;
    }

    // 1. Optimistic UI : afficher immédiatement le message user
    const optimisticId = Date.now().toString();
    const userMessage: Message = {
      id: optimisticId,
      text,
      isUser: true,
      timestamp: new Date(),
      isNew: true,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');

    buttonScale.value = withSpring(0.9, { duration: 100 }, () => {
      buttonScale.value = withSpring(1);
    });

    // JAMAIS le contenu du message — seulement sa longueur et son rang dans la
    // session. C'est assez pour mesurer l'engagement, et rien de ce qui est
    // confié à Lucy ne quitte l'app.
    // Compteur porté par une ref, et non lu dans `messages` : ce useCallback ne
    // se recrée pas à chaque message, et une lecture directe capturerait donc
    // un état figé au premier rendu — le rang serait faux dès le 2ᵉ envoi.
    sentCountRef.current += 1;
    track('chat_message_sent', {
      message_length: text.length,
      session_message_count: sentCountRef.current,
      is_first_of_session: sentCountRef.current === 1,
      free_exchanges_used: profileRef.current?.free_exchanges_used ?? null,
    });

    // Tout premier message à Lucy, jamais : l'étape de l'entonnoir qui suit le
    // slider. Une carte reprise telle quelle et un message écrit à la main ne
    // disent pas la même chose de l'engagement ; `was_edited` rattrape la carte
    // retouchée avant l'envoi. Le contenu, lui, ne part jamais.
    // Après une remise à zéro de la mémoire, l'accueil rejoue mais le compteur
    // du serveur, lui, n'a pas bougé : ce n'est pas un premier message.
    if (!hasUserMessageRef.current && (profileRef.current?.free_exchanges_used ?? 0) === 0) {
      hasUserMessageRef.current = true;
      const picked = pickedCardRef.current;
      const fromCard = picked !== null && picked.text.trim() === text;
      track('first_message_sent', {
        input_method: fromCard ? 'suggestion' : 'typed',
        suggestion_index: fromCard ? picked.index + 1 : null,
        was_edited: picked !== null && !fromCard,
        message_length: text.length,
      });
    }

    // 2. Rétention : les trois points tout de suite, la requête après le délai de grâce.
    // Le plafond ne court pas encore : il démarre à la première frappe du message suivant.
    pendingRef.current.push({ optimisticId, text });
    setIsHolding(true);
    setIsTyping(true);
    clearBurstTimers();
    graceTimerRef.current = setTimeout(() => flushPendingRef.current(), LUCY_BURST_GRACE_MS);
  }, [session, t, buttonScale, conversationStorageReady, clearBurstTimers, wallExpectedNow]);

  const sendMessage = useCallback(() => sendText(inputText.trim()), [sendText, inputText]);

  /**
   * Carte touchée : l'humeur est enregistrée comme depuis le mood tracker, puis
   * la phrase correspondante part à Lucy comme un message ordinaire, pour
   * qu'elle rebondisse dessus. Un enregistrement raté n'empêche pas l'envoi :
   * la conversation d'abord, le mood tracker garde la main pour corriger.
   */
  const handleMoodSelect = useCallback(async (mood: number) => {
    moodCardsVisibleRef.current = false;
    setMoodCardsVisible(false);
    const userId = sessionRef.current?.user?.id;
    if (userId) {
      const timezone = resolveUserTimezoneFromProfile(profileRef.current);
      const ymd = getMoodDateInTimezone(timezone);
      writeMoodCheckInState(userId, { ymd, status: 'done' }).catch(() => {});
      try {
        await saveMoodFromChat(userId, mood, ymd, timezone);
      } catch (err) {
        console.warn('[ChatScreen] enregistrement de l’humeur :', err);
      }
    }
    track('mood_checkin_answered', { mood_value: mood });
    sendText(t(`chat:moodSent.${mood}`));
  }, [sendText, t]);

  /** Carte de la pile touchée : son texte va dans la barre, à envoyer ou retoucher. */
  const handleFirstCardPick = useCallback((text: string, _card: unknown, index: number) => {
    pickedCardRef.current = { index, text };
    setFirstCardsVisible(false);
    setInputText(text);
  }, []);

  // Frappe pendant la rétention (règle du 9 septembre 2026) :
  //   - première lettre du message suivant : les points s'effacent et le plafond de
  //     LUCY_BURST_MAX_HOLD_MS démarre à cet instant ; la requête attend l'envoi ou le plafond ;
  //   - champ redevenu vide (lettres tapées par mégarde puis effacées) : le plafond s'arrête,
  //     les points reviennent, et la requête part après LUCY_BURST_GRACE_MS sans frappe ;
  //   - nouvelle frappe pendant ce battement : on repart comme à la première lettre, avec un
  //     plafond neuf de LUCY_BURST_MAX_HOLD_MS.
  const handleInputChange = useCallback((value: string) => {
    setInputText(value);
    if (pendingRef.current.length === 0) return;

    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }

    if (value.trim().length > 0) {
      setIsTyping(false);
      if (!maxHoldTimerRef.current) {
        maxHoldTimerRef.current = setTimeout(() => flushPendingRef.current(), LUCY_BURST_MAX_HOLD_MS);
      }
      return;
    }

    if (maxHoldTimerRef.current) {
      clearTimeout(maxHoldTimerRef.current);
      maxHoldTimerRef.current = null;
    }
    setIsTyping(true);
    graceTimerRef.current = setTimeout(() => flushPendingRef.current(), LUCY_BURST_GRACE_MS);
  }, []);

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const timeLocale =
    i18n.language?.startsWith('fr') ? 'fr-FR' : i18n.language?.startsWith('en') ? 'en-US' : undefined;

  // Zone de saisie : sur iOS, posée par-dessus le bas du fil, marge basse
  // fixe, et seulement translatée — collée 8 pt au-dessus du clavier ouvert.
  // Une translation part sans recalcul de mise en page, dans la même image
  // que la demande, même si un rendu React est en cours à cet instant. Sur
  // Android, elle reste dans le flux, sa marge basse suit le clavier et c'est
  // le conteneur qui prend une marge basse de la hauteur du clavier.
  const composerAnimatedStyle = useAnimatedStyle(() =>
    IS_IOS
      ? {
          paddingBottom: composerBottomPadding(0, insets.bottom),
          transform: [{ translateY: -composerShift(keyboardHeight.value, insets.bottom) }],
        }
      : {
          paddingBottom: composerBottomPadding(keyboardHeight.value, insets.bottom),
          transform: [{ translateY: 0 }],
        }
  );
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: IS_IOS ? 0 : keyboardHeight.value,
  }));
  // Marge interne et position du fil (iOS seulement ; Android les ignore).
  // Des propriétés natives de la liste, sans recalcul de mise en page. La
  // position est toujours envoyée, avec sa dernière valeur : si elle
  // disparaissait d'un rendu, la liste la croirait remise à zéro.
  const listAnimatedProps = useAnimatedProps<FlatListProps<ListItem>>(() =>
    IS_IOS
      ? {
          contentInset: { top: listInset.value, left: 0, bottom: 0, right: 0 },
          scrollIndicatorInsets: { top: listInset.value, left: 0, bottom: 0, right: 0 },
          contentOffset: { x: 0, y: pinnedOffset.value },
        }
      : {}
  );

  // Deux styles séparés : l'apparition ne dépend que de la visibilité, la
  // position que du clavier. Réunis, chaque image de clavier relancerait le
  // fondu.
  const scrollButtonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(scrollButtonVisible.value ? 1 : 0, { duration: 200 }),
    transform: [{ scale: withSpring(scrollButtonVisible.value ? 1 : 0.8) }],
  }));
  const scrollButtonPositionStyle = useAnimatedStyle(() =>
    IS_IOS
      ? {
          bottom: coveredBottom(0, composerHeight.value, insets.bottom) + 16,
          transform: [{ translateY: -composerShift(keyboardHeight.value, insets.bottom) }],
        }
      : { bottom: 16, transform: [{ translateY: 0 }] }
  );
  const scrollButtonAnimatedProps = useAnimatedProps(() => ({
    pointerEvents: scrollButtonVisible.value ? ('auto' as const) : ('none' as const),
  }));

  const openMessageActions = useCallback((id: string, frame: BubbleFrame) => {
    const item = messagesRef.current.find((m) => m.id === id);
    if (!item) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Le clavier se range : l'overlay couvre tout l'écran, il n'a rien à y faire.
    Keyboard.dismiss();
    setActionTarget({
      id: item.id,
      text: item.text,
      isUser: item.isUser,
      timeLabel: formatTimeLabel(item.timestamp, timeLocale),
      frame,
    });
  }, [timeLocale]);

  // Sur une FlatList inversée, le bas du fil (messages récents) est à -marge
  // interne sur iOS, à 0 ailleurs. Le seuil est évalué côté animation : aucun
  // rendu React pendant un défilement ou un geste clavier, où un rendu
  // pourrait faire sauter l'animation native.
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.y;
    const fromBottom = event.contentOffset.y + (IS_IOS ? listInset.value : 0);
    const shouldShow = fromBottom > 100;
    if (shouldShow !== scrollButtonVisible.value) {
      scrollButtonVisible.value = shouldShow;
    }
  });

  /** Position « collé en bas » du fil, lue côté JS. */
  const bottomOffset = useCallback(() => (IS_IOS ? -listInset.value : 0), [listInset]);

  const scrollToBottom = () => {
    listRef.current?.scrollToOffset({ offset: bottomOffset(), animated: true });
  };

  // Auto-scroll vers le bas à chaque nouveau message, sauf lors d'un "load more"
  useEffect(() => {
    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      return;
    }
    listRef.current?.scrollToOffset({ offset: bottomOffset(), animated: true });
  }, [messages, isTyping, moodCardsVisible, firstCardsVisible, bottomOffset, listRef]);

  messagesRef.current = messages;

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.id === 'typing') {
      return <ChatTypingIndicator />;
    }
    if ('type' in item && item.type === 'mood_cards') {
      return <MoodCheckInCards onSelect={handleMoodSelect} />;
    }
    if ('type' in item && item.type === 'first_cards') {
      return (
        <FirstMessageDeck
          answers={profileRef.current?.onboarding_answers}
          gender={profileRef.current?.gender}
          onPick={handleFirstCardPick}
        />
      );
    }
    if ('type' in item && item.type === 'date_separator') {
      return (
        <View style={styles.dateSeparator}>
          <Text style={styles.dateSeparatorText}>{item.label}</Text>
        </View>
      );
    }
    const message = item as Message;
    if (message.error) {
      return (
        <Animated.View
          entering={message.isNew ? MESSAGE_ENTERING : undefined}
          style={[bubbleStyles.messageBubble, bubbleStyles.aiMessage, styles.errorBubble]}
        >
          <Text style={styles.errorText}>{message.error}</Text>
        </Animated.View>
      );
    }
    return (
      <MessageBubble
        id={message.id}
        text={message.text}
        isUser={message.isUser}
        timeLabel={formatTimeLabel(message.timestamp, timeLocale)}
        isNew={message.isNew}
        onLongPress={openMessageActions}
        hidden={actionTarget?.id === message.id}
      />
    );
  }, [timeLocale, openMessageActions, actionTarget?.id, handleMoodSelect, handleFirstCardPick]);

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // Données inversées pour la FlatList inversée : index 0 = message le plus récent = bas de l'écran
  const displayMessages = useMemo<ListItem[]>(() => {
    // Insérer les séparateurs de date dans l'ordre chronologique
    const items: ListItem[] = [];
    let prevDateKey: string | null = null;

    for (const msg of messages) {
      const dateKey = getDateKey(msg.timestamp);
      if (dateKey !== prevDateKey) {
        items.push({
          id: `sep-${dateKey}`,
          type: 'date_separator',
          label: formatDateLabel(msg.timestamp, i18n.language, t),
        });
        prevDateKey = dateKey;
      }
      items.push(msg);
    }

    // Inverser pour la FlatList inversée (plus récent en index 0 = bas)
    const reversed = [...items].reverse();

    // Les cartes d'humeur, tout en bas, sous la question de Lucy
    if (moodCardsVisible) {
      reversed.unshift(MOOD_CARDS_ITEM);
    }
    // Les brouillons de premier message, tout en bas, sous l'accueil de Lucy
    if (firstCardsVisible) {
      reversed.unshift(FIRST_CARDS_ITEM);
    }

    // Indicateur "en train d'écrire" en bas (index 0), sans séparateur
    if (isTyping) {
      reversed.unshift({ id: 'typing', text: '', isUser: false, timestamp: new Date() } as Message);
    }

    return reversed;
  }, [messages, isTyping, moodCardsVisible, firstCardsVisible, i18n.language, t]);

  // Sur FlatList inversée : ListFooterComponent apparaît visuellement en HAUT (au-dessus des vieux msgs)
  // Le contenu doit être contre-roté avec scaleY(-1) pour ne pas apparaître à l'envers.
  const listFooterComponent = useMemo(() => {
    if (isLoadingMore) {
      return <ActivityIndicator size="small" color="#F97316" style={styles.loadMoreSpinner} />;
    }
    if (hasMoreMessages) {
      return (
        <Pressable onPress={loadMoreMessages} style={styles.loadMoreButton}>
          <Text style={styles.loadMoreText}>{t('chat:loadMore')}</Text>
        </Pressable>
      );
    }
    return null;
  }, [isLoadingMore, hasMoreMessages, loadMoreMessages, t]);

  // --------------------------------------------------------------------------
  // Rendu
  // --------------------------------------------------------------------------

  return (
    <Animated.View style={[styles.container, containerAnimatedStyle]}>
      {/* Sur Android, la zone de prise rend le clavier repoussable au doigt
          (interpolator « ios » : il suit le doigt dès qu'il le touche). Sur
          iOS, c'est la liste elle-même qui le fait (keyboardDismissMode), et
          la zone n'est pas montée : montée sans rôle, elle a un bug connu sur
          iOS 26 (faux événement de geste clavier fermé, corrigé en 1.21). */}
      <ListArea style={styles.listArea} interpolator="ios">
        <Animated.FlatList
          ref={listRef}
          data={displayMessages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          inverted
          extraData={actionTarget}
          ListFooterComponent={listFooterComponent}
          ListEmptyComponent={
            isLoadingHistory ? (
              <View style={styles.historyLoadingContainer}>
                <ActivityIndicator size="large" color="#F97316" />
              </View>
            ) : null
          }
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContainer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          animatedProps={listAnimatedProps}
          onScroll={onScroll}
          scrollEventThrottle={16}
        />

        <Animated.View
          style={[styles.scrollToBottomButton, scrollButtonAnimatedStyle, scrollButtonPositionStyle]}
          animatedProps={scrollButtonAnimatedProps}
        >
          <Pressable
            onPress={scrollToBottom}
            style={styles.scrollButtonPressable}
          >
            <ArrowDown size={21} color="#FFFFFF" strokeWidth={2.5} />
          </Pressable>
        </Animated.View>
      </ListArea>

      {/* Champ fin en capsule, bouton d'envoi posé à sa droite : le champ peut
          être aussi fin que sur WhatsApp sans que le bouton rétrécisse. */}
      <Animated.View
        style={[styles.inputContainer, IS_IOS && styles.inputContainerOverlay, composerAnimatedStyle]}
      >
        <View style={styles.inputRow} onLayout={onComposerLayout}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={handleInputChange}
              placeholder={t('chat:placeholder')}
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
              scrollEnabled={inputScrollable}
              onLayout={(e) => {
                const atMax = e.nativeEvent.layout.height >= INPUT_MAX_HEIGHT - 0.5;
                if (atMax !== inputScrollable) setInputScrollable(atMax);
              }}
            />
          </View>
          <Animated.View style={buttonAnimatedStyle}>
              <Pressable
                ref={sendButtonRef}
                style={[
                  styles.sendButton,
                  inputText.trim() && (!session?.user?.id || conversationStorageReady)
                    ? styles.sendButtonActive
                    : styles.sendButtonInactive,
                ]}
                onPress={sendMessage}
                disabled={
                  !inputText.trim() ||
                  isReplying ||
                  (isTyping && !isHolding) ||
                  (Boolean(session?.user?.id) && !conversationStorageReady)
                }
              >
                <Send
                  size={20}
                  color={
                    inputText.trim() && (!session?.user?.id || conversationStorageReady)
                      ? '#FFFFFF'
                      : '#9CA3AF'
                  }
                  strokeWidth={2}
                />
              </Pressable>
            </Animated.View>
        </View>
      </Animated.View>

      <MessageActionsOverlay target={actionTarget} onClose={() => setActionTarget(null)} />
    </Animated.View>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatTimeLabel(date: Date | undefined, locale: string | undefined): string | null {
  if (!date) return null;
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatDateLabel(date: Date, lang: string, t: (key: string) => string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return t('chat:dateToday');
  if (isSameDay(date, yesterday)) return t('chat:dateYesterday');

  const locale = lang.startsWith('fr') ? 'fr-FR' : 'en-US';
  const sameYear = date.getFullYear() === today.getFullYear();

  return date.toLocaleDateString(locale, sameYear
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' }
  );
}

/** Mappe une erreur API à la clé i18n correspondante. */
function getErrorKey(err: unknown): string {
  if (err instanceof LucyApiError) {
    switch (err.statusCode) {
      case 401:
        return 'chat:errorSession';
      case 402:
        return 'chat:errorFreeExhausted';
      case 429:
        return 'chat:errorRateLimit';
      case 502:
      case 503:
      case 504:
        // 503 couvre aussi `subscription_unverifiable` : RevenueCat injoignable
        // au moment de vérifier l'abonnement. « Réessaie », pas le mur.
        return 'chat:errorServer';
    }
    if (err.code === 'network_error' || err.code === 'timeout') {
      return 'chat:errorNetwork';
    }
  }
  return 'chat:errorGeneric';
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: '100%',
  },
  // Sur iOS, le fil descend jusqu'au bas de l'écran, sous la zone de saisie
  // et le clavier : c'est sa marge interne qui garde les messages visibles.
  listArea: {
    flex: 1,
    width: '100%',
  },
  messagesList: {
    flex: 1,
    width: '100%',
  },
  messagesContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 16,
    width: '100%',
  },
  historyLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  loadMoreText: {
    fontSize: 14,
    color: '#F97316',
    fontWeight: '500',
  },
  loadMoreSpinner: {
    paddingVertical: 16,
  },
  errorBubble: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#991B1B',
  },
  inputContainer: {
    backgroundColor: '#FFFFFF',
  },
  // iOS : posée par-dessus le bas du fil, puis translatée de la hauteur du clavier.
  inputContainerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  // La rangée mesurée (champ + bouton + marge haute) : sa hauteur ne dépend
  // pas de la marge basse animée, qui ne doit pas déclencher de mesure.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  // Capsule fine : la hauteur vient du texte (20 pt) plus 6,5 pt au-dessus et
  // en dessous, soit 36 pt bordure comprise — exactement le bouton à côté,
  // bas alignés : un point de plus et le champ semblait dépasser en haut.
  inputWrapper: {
    flex: 1,
    justifyContent: 'center',
    // Rien ne sort de la capsule, quoi qu'il arrive au texte à l'intérieur.
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    minHeight: 36,
  },
  textInput: {
    fontSize: 16,
    lineHeight: INPUT_LINE_HEIGHT,
    color: '#374151',
    maxHeight: INPUT_MAX_HEIGHT,
    paddingTop: INPUT_VERTICAL_PADDING,
    paddingBottom: INPUT_VERTICAL_PADDING,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    // L'avion de lucide est un triangle dont la pointe monte à droite : sa boîte
    // est centrée dans le rond, mais le plus petit cercle qui l'entoure, lui, est
    // décalé de 1,5 pt vers le haut à droite (calculé sur le tracé, puis mesuré
    // sur capture du simulateur). Ces marges internes à droite et en haut
    // ramènent ce cercle au centre du bouton au quart de pixel près (mesuré
    // sur capture à 3x : les trois pointes sont à 7,7-7,9 pt du bord). Valeurs
    // calibrées sur capture, pas calculées : l'icône se cale sur la grille de
    // pixels, et une marge de 3 pt la déplaçait de 2,5 à 2,8 pt. Pas de
    // `transform` sur l'icône : le rendu SVG l'applique deux fois.
    paddingRight: 0.5,
    paddingTop: 0.5,
  },
  sendButtonActive: {
    backgroundColor: '#F97316',
  },
  sendButtonInactive: {
    backgroundColor: '#E5E7EB',
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 20,
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: 'rgba(156, 163, 175, 0.85)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  scrollButtonPressable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSeparator: {
    alignSelf: 'center',
    backgroundColor: '#E9E4DC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 10,
  },
  dateSeparatorText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
});
