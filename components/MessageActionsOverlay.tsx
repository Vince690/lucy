import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Copy, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { BubbleContent, bubbleStyles, type BubbleFrame, type BubbleContentProps } from './MessageBubble';

export interface MessageActionsTarget extends BubbleContentProps {
  /** Identifiant du message, pour masquer l'original dans le fil pendant l'overlay. */
  id: string;
  frame: BubbleFrame;
}

interface MessageActionsOverlayProps {
  target: MessageActionsTarget | null;
  onClose: () => void;
}

const MENU_HEIGHT = 48;
const MENU_WIDTH = 168;
const MENU_GAP = 10;
/** Coins bien ronds, comme le menu de WhatsApp. */
const MENU_RADIUS = 20;
/** Marge minimale entre le menu et le bord de l'écran. */
const EDGE = 12;
/**
 * Liseré blanc autour de la bulle mise en avant, tracé À L'EXTÉRIEUR de son
 * rectangle d'origine : la bulle beige de Lucy se fondait dans le fond grisé
 * par le flou. Le cadre s'agrandit d'autant, le contenu ne bouge pas d'un pixel.
 */
const RING = 2;

/**
 * Appui long sur un message, à la manière de WhatsApp : tout l'écran se
 * floute, la bulle reste nette exactement là où elle était, telle quelle,
 * et un petit menu apparaît en fondu au-dessus (ou en dessous s'il n'y a
 * pas la place). Pas de rebond, pas d'ombre : le geste doit rester discret.
 *
 * Un seul choix pour l'instant, « Copier ». Répondre ou réagir n'aurait pas
 * de sens tant que Lucy répond à un message à la fois — ce serait de la
 * décoration.
 */
export function MessageActionsOverlay({ target, onClose }: MessageActionsOverlayProps) {
  const { t } = useTranslation('chat');
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [copied, setCopied] = useState(false);

  if (!target) return null;

  const { frame, isUser } = target;

  // Menu au-dessus de la bulle si la place le permet, sinon en dessous.
  const topLimit = insets.top + EDGE;
  const fitsAbove = frame.y - MENU_GAP - MENU_HEIGHT >= topLimit;
  const menuTop = fitsAbove
    ? frame.y - MENU_GAP - MENU_HEIGHT
    : Math.min(frame.y + frame.height + MENU_GAP, screenHeight - insets.bottom - EDGE - MENU_HEIGHT);

  // Aligné sur le bord de la bulle côté expéditeur : droite pour soi, gauche pour Lucy.
  const rawLeft = isUser ? frame.x + frame.width - MENU_WIDTH : frame.x;
  const menuLeft = Math.max(EDGE, Math.min(rawLeft, screenWidth - EDGE - MENU_WIDTH));

  const handleCopy = async () => {
    if (copied) return;

    try {
      await Clipboard.setStringAsync(target.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 450);
    } catch {
      onClose();
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        style={StyleSheet.absoluteFill}
      >
        <BlurView intensity={45} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.scrim} />
        {/* Toucher n'importe où ailleurs referme. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View
          pointerEvents="none"
          style={[
            bubbleStyles.messageBubble,
            isUser ? bubbleStyles.userMessage : bubbleStyles.aiMessage,
            styles.floatingBubble,
            {
              top: frame.y - RING,
              left: frame.x - RING,
              width: frame.width + RING * 2,
              borderRadius: bubbleStyles.messageBubble.borderRadius + RING,
              ...(isUser
                ? { borderBottomRightRadius: bubbleStyles.userMessage.borderBottomRightRadius + RING }
                : { borderBottomLeftRadius: bubbleStyles.aiMessage.borderBottomLeftRadius + RING }),
            },
          ]}
        >
          <BubbleContent text={target.text} isUser={isUser} timeLabel={target.timeLabel} />
        </View>

        {/* Le menu apparaît en fondu, sans rebond : il est là, puis il ne bouge plus. */}
        <Animated.View
          entering={FadeIn.duration(120)}
          style={[styles.menu, { top: menuTop, left: menuLeft }]}
        >
          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('copy')}
          >
            <Text style={styles.menuLabel}>{copied ? t('copied') : t('copy')}</Text>
            {copied
              ? <Check size={18} color="#16A34A" strokeWidth={2.4} />
              : <Copy size={18} color="#374151" strokeWidth={2} />
            }
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Voile blanc léger : le flou seul grise le fond, et la bulle beige de Lucy
  // s'y perdait. On éclaircit plutôt que d'assombrir.
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  floatingBubble: {
    position: 'absolute',
    marginVertical: 0,
    borderWidth: RING,
    borderColor: '#FFFFFF',
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    borderRadius: MENU_RADIUS,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  menuItem: {
    flex: 1,
    borderRadius: MENU_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  menuItemPressed: {
    backgroundColor: '#F3F4F6',
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
});
