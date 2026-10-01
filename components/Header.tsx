import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Smile, Settings } from 'lucide-react-native';
import { LUCY_AVATAR_CROP } from '@/constants/lucyAvatar';

const AVATAR_SIZE = 46;
const BUTTON_SIZE = 40;
const ICON_SIZE = 24;
const ICON_COLOR = '#374151';
/**
 * Marge latérale alignée sur les bulles du fil (`messagesContainer` dans
 * app/(app)/index.tsx, paddingHorizontal 20) : rien dans le header ne doit
 * dépasser la ligne du bord gauche des bulles de Lucy, ni celle du bord droit
 * des bulles de l'utilisateur.
 */
const H_PADDING = 20;
/**
 * Correction optique : une forme ronde posée exactement sur la ligne des
 * bulles (rectangles à coins arrondis) donne l'impression de la dépasser.
 * Mesuré sur capture : la photo était pile sur la ligne, le rouage 2 pt à
 * l'intérieur, et l'œil voyait les deux déborder. On rentre donc de 2 pt.
 */
const OPTICAL_INSET = 2;
/**
 * Un bouton rond de 40 autour d'un pictogramme de 26 : pour que ce soit le
 * pictogramme, et non la zone de toucher invisible, qui s'aligne sur la marge,
 * on décale le bloc de la différence.
 */
const BUTTON_BLEED = (BUTTON_SIZE - ICON_SIZE) / 2;

type HeaderProps =
  | {
      /** Écran de chat, façon WhatsApp : Lucy à gauche, humeur et réglages à droite. */
      variant: 'chat';
      onMoodPress: () => void;
      onSettingsPress: () => void;
    }
  | {
      /** Toute autre page : flèche retour à gauche, titre centré. */
      variant?: 'default';
      onBackPress: () => void;
      title: string;
      titleStyle?: object;
    };

export function Header(props: HeaderProps) {
  const insets = useSafeAreaInsets();

  if (props.variant === 'chat') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.identity}>
          <View style={styles.avatarContainer}>
            <Image
              source={require('../assets/images/lucy-avatar.png')}
              style={styles.avatarImage}
              resizeMode="stretch"
            />
          </View>
          {/*
            Le nom seul, centré sur l'avatar. Le statut vivant viendra se glisser
            sous le nom sans rien déplacer : ce bloc gardera la même hauteur.
          */}
          <View style={styles.identityText}>
            <Text style={styles.avatarName}>Lucy</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            onPress={props.onMoodPress}
            hitSlop={4}
            accessibilityRole="button"
          >
            <Smile size={ICON_SIZE} color={ICON_COLOR} strokeWidth={2} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            onPress={props.onSettingsPress}
            hitSlop={4}
            accessibilityRole="button"
          >
            <Settings size={ICON_SIZE} color={ICON_COLOR} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Pressable
        style={({ pressed }) => [styles.iconButton, styles.backButton, pressed && styles.iconButtonPressed]}
        onPress={props.onBackPress}
        hitSlop={4}
        accessibilityRole="button"
      >
        <ArrowLeft size={ICON_SIZE} color={ICON_COLOR} strokeWidth={2} />
      </Pressable>

      <Text style={[styles.title, props.titleStyle]}>{props.title}</Text>

      <View style={styles.placeholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING + OPTICAL_INSET,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    width: '100%',
    maxWidth: '100%',
    // Au-dessus de l'écran de chat : quand le clavier monte, le fil est
    // translaté vers le haut et passe sous le header au lieu de le recouvrir.
    zIndex: 1,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityText: {
    flex: 1,
    justifyContent: 'center',
  },
  avatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  // Cadrage partagé, aligné sur l’icône de l’app : voir constants/lucyAvatar.
  avatarImage: {
    position: 'absolute',
    width: AVATAR_SIZE * LUCY_AVATAR_CROP.width,
    height: AVATAR_SIZE * LUCY_AVATAR_CROP.height,
    left: AVATAR_SIZE * LUCY_AVATAR_CROP.left,
    top: AVATAR_SIZE * LUCY_AVATAR_CROP.top,
  },
  avatarName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginRight: -BUTTON_BLEED,
  },
  backButton: {
    marginLeft: -BUTTON_BLEED,
  },
  iconButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: '#F3F4F6',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  placeholder: {
    width: BUTTON_SIZE - BUTTON_BLEED,
  },
});
