import React, { memo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Keyboard } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

/**
 * Animation d'entrée des messages de la session, construite UNE fois : un
 * builder recréé à chaque rendu changerait l'identité de la prop et casserait
 * la mémoïsation de chaque bulle.
 */
export const MESSAGE_ENTERING = FadeIn.duration(250).springify();

/** Position d'une bulle à l'écran, en coordonnées de la fenêtre. */
export interface BubbleFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BubbleContentProps {
  text: string;
  isUser: boolean;
  timeLabel: string | null;
}

interface MessageBubbleProps extends BubbleContentProps {
  id: string;
  /** Message envoyé ou reçu pendant cette session : animation d'entrée. */
  isNew?: boolean;
  /** Appui long : reçoit l'id et la position exacte de la bulle, pour la remettre au même endroit dans l'overlay. */
  onLongPress?: (id: string, frame: BubbleFrame) => void;
  /**
   * Bulle rendue invisible mais toujours en place. Pendant l'appui long, la
   * copie nette est posée par-dessus l'écran flouté : si l'original restait
   * visible dessous, son flou déborderait tout autour comme un halo.
   */
  hidden?: boolean;
}

/** Intérieur de la bulle (texte + heure), partagé entre le fil et l'overlay d'appui long. */
export function BubbleContent({ text, isUser, timeLabel }: BubbleContentProps) {
  return (
    <>
      <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.aiMessageText]}>
        {text}
      </Text>
      {timeLabel ? <Text style={styles.timestamp}>{timeLabel}</Text> : null}
    </>
  );
}

/**
 * Bulle de message du fil. L'animation d'entrée est portée par un conteneur
 * pleine largeur, la bulle elle-même s'aligne dedans — ainsi la mesure faite
 * à l'appui long correspond exactement au rectangle coloré, pas à la ligne.
 *
 * Mémoïsée : toutes ses props sont des primitives ou des callbacks stables.
 * Sans cela, chaque lettre tapée dans la zone de saisie redessinait toutes
 * les bulles visibles — du travail inutile qui se voyait pendant les gestes.
 */
const dismissKeyboard = () => Keyboard.dismiss();

export const MessageBubble = memo(function MessageBubble({
  id, text, isUser, timeLabel, isNew, onLongPress, hidden,
}: MessageBubbleProps) {
  const bubbleRef = useRef<View>(null);

  const handleLongPress = () => {
    if (!onLongPress) return;
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      onLongPress(id, { x, y, width, height });
    });
  };

  return (
    <Animated.View entering={isNew ? MESSAGE_ENTERING : undefined}>
      <Pressable
        ref={bubbleRef}
        // La bulle capte le toucher pour l'appui long : la liste ne le voit
        // plus et ne replierait pas le clavier (keyboardShouldPersistTaps
        // « handled »). Un toucher simple le replie donc ici, comme WhatsApp.
        onPress={dismissKeyboard}
        onLongPress={handleLongPress}
        delayLongPress={320}
        style={[
          styles.messageBubble,
          isUser ? styles.userMessage : styles.aiMessage,
          hidden && styles.hidden,
        ]}
      >
        <BubbleContent text={text} isUser={isUser} timeLabel={timeLabel} />
      </Pressable>
    </Animated.View>
  );
});

export const bubbleStyles = StyleSheet.create({
  messageBubble: {
    maxWidth: '80%',
    marginVertical: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#F97316',
    borderBottomRightRadius: 6,
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#EDE8E0',
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  aiMessageText: {
    color: '#374151',
  },
  hidden: {
    opacity: 0,
  },
  timestamp: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.4)',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
});

const styles = bubbleStyles;
