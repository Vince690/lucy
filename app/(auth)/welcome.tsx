import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Image, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import * as WebBrowser from 'expo-web-browser';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

export default function WelcomeScreen() {
  const router = useRouter();
  const { t } = useTranslation(['auth']);
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [loading, setLoading] = useState(false);
  const [dimensions, setDimensions] = useState({
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  });

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions({ width: window.width, height: window.height });
    });

    return () => subscription?.remove();
  }, []);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      alert(error.message);
    }
    setLoading(false);
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    const { error } = await signInWithApple();
    if (error) {
      alert(error.message);
    }
    setLoading(false);
  };

  const screenWidth = dimensions.width;
  const screenHeight = dimensions.height;

  const logoSize = Math.min(screenWidth * 1.0, screenHeight * 0.675);
  const logoLeft = -(logoSize * 0.38);
  const logoTop = screenHeight * 0.15;

  const isSmallScreen = screenWidth < 350;
  const isShortScreen = screenHeight / screenWidth < 1.5;
  const rightColumnMaxWidth = isSmallScreen ? screenWidth * 0.8 : screenWidth * 0.78;
  const buttonsGap = isShortScreen ? 12 : 16;

  return (
    <View style={styles.container}>
      <Image
        source={require('@/assets/images/lucy-logo.png')}
        style={[
          styles.backgroundLogo,
          {
            width: logoSize,
            height: logoSize,
            left: logoLeft,
            top: logoTop,
          },
        ]}
        resizeMode="contain"
        accessibilityElementsHidden={true}
        importantForAccessibility="no"
      />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Connexion reléguée en haut à droite : discrète, elle libère le bloc du bas. */}
        <Pressable style={styles.topSignIn} onPress={() => router.push('/(auth)/sign-in')} hitSlop={8}>
          <Text style={styles.topSignInText}>{t('auth:welcome.signIn')}</Text>
        </Pressable>
        <View style={styles.contentRow}>
          <View style={styles.leftColumn} />
          <Animated.View
            entering={FadeIn.delay(200)}
            style={[styles.rightColumn, { maxWidth: rightColumnMaxWidth }]}
          >
            <View style={styles.header}>
              <Text style={styles.title}>{t('auth:welcome.title')}</Text>
              <Text style={styles.subtitle}>{t('auth:welcome.subtitle')}</Text>
            </View>
          </Animated.View>
        </View>
        <View style={styles.buttonsOverlay}>
          <Animated.View entering={FadeInDown.delay(400)} style={[styles.buttonsContainer, { gap: buttonsGap }]}>
            <Pressable
              style={[styles.oauthButton, styles.googleButton]}
              onPress={handleGoogleSignIn}
              disabled={loading}
            >
              <Image
                source={require('@/assets/images/google-logo.png')}
                style={styles.oauthLogo}
              />
              <Text style={styles.oauthButtonText}>
                {t('auth:welcome.continueWithGoogle')}
              </Text>
            </Pressable>

            {Platform.OS === 'ios' && (
              <Pressable
                style={[styles.oauthButton, styles.appleButton]}
                onPress={handleAppleSignIn}
                disabled={loading}
              >
                <Image
                  source={require('@/assets/images/apple-logo.png')}
                  style={[styles.oauthLogo, styles.appleLogo]}
                />
                <Text style={[styles.oauthButtonText, styles.appleButtonText]}>
                  {t('auth:welcome.continueWithApple')}
                </Text>
              </Pressable>
            )}

            <Pressable
              style={styles.emailButton}
              onPress={() => router.push('/(auth)/sign-up')}
            >
              <Text style={styles.emailButtonText}>
                {t('auth:welcome.signUpWithEmail')}
              </Text>
            </Pressable>

            {/* CGU + RGPD des inscriptions OAuth : « Continuer avec… » vaut
                acceptation — la mention doit donc être visible ici, avec les liens.
                `aiNotice` ferme la phrase : « tu comprends que Lucy est une IA »
                (règlement IA, art. 50 : le dire au plus tard à la première
                interaction). La mention OpenAI a été retirée d'ici le 15 sept. 2026
                à la demande de Vincent ; la règle App Store 5.1.2(i) exige toujours
                de nommer le tiers et d'obtenir un accord actif AVANT le premier
                envoi — à porter par l'écran qui précède le premier message. */}
            <Text style={styles.legalNotice}>
              {t('auth:welcome.legalNotice')}{' '}
              <Text
                style={styles.legalLink}
                onPress={() =>
                  WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-terms')
                }
              >
                {t('auth:welcome.legalTerms')}
              </Text>{' '}
              {t('auth:welcome.legalAnd')}{' '}
              <Text
                style={styles.legalLink}
                onPress={() =>
                  WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-privacy')
                }
              >
                {t('auth:welcome.legalLink')}
              </Text>
              , {t('auth:welcome.aiNotice')}
            </Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    position: 'relative',
  },
  backgroundLogo: {
    position: 'absolute',
    opacity: 0.80,
    zIndex: 0,
  },
  safeArea: {
    flex: 1,
    zIndex: 1,
  },
  topSignIn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  topSignInText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftColumn: {
    flex: 1,
    minWidth: 0,
  },
  rightColumn: {
    flex: 1.15,
    paddingLeft: 0,
    paddingRight: 30,
    justifyContent: 'center',
  },
  header: {
    gap: 10,
    width: '100%',
  },
  title: {
    fontSize: 35,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'left',
    width: '100%',
  },
  subtitle: {
    fontSize: 19,
    fontWeight: '500',
    color: '#4E5259',
    textAlign: 'left',
    lineHeight: 21,
    width: '100%',
  },
  buttonsOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 20,
    backgroundColor: 'transparent',
  },
  buttonsContainer: {
    width: '100%',
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  oauthLogo: {
    width: 20,
    height: 20,
  },
  appleLogo: {
    tintColor: '#FFFFFF',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
  },
  appleButton: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  oauthButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  appleButtonText: {
    color: '#FFFFFF',
  },
  emailButton: {
    backgroundColor: '#F97316',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  emailButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  legalNotice: {
    marginTop: 4,
    // 11 px et non 10,5 : la règle 5.1.2(i) demande une divulgation *claire*.
    // Un demi-point ne change rien à la discrétion du bloc et retire l'argument
    // « mention illisible » à un reviewer.
    fontSize: 11,
    lineHeight: 16,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  legalLink: {
    color: '#6B7280',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
