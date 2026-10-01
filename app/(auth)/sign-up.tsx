import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronLeft, Check } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import Animated, { FadeInDown } from 'react-native-reanimated';

export default function SignUpScreen() {
  const router = useRouter();
  const { t } = useTranslation(['auth']);
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Consentement RGPD explicite (données d'humeur = données de santé) : recueilli
  // ICI, à la création du compte — le paywall n'en fait qu'horodater la confirmation.
  const [consentGiven, setConsentGiven] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validatePassword = (pwd: string): boolean => {
    if (pwd.length < 8) return false;
    return true;
  };

  const handleSignUp = async () => {
    if (!email || !password || !confirmPassword) {
      setError(t('auth:signUp.fillAllFields'));
      return;
    }

    if (!validatePassword(password)) {
      setError(t('auth:signUp.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth:signUp.passwordsDontMatch'));
      return;
    }

    if (!consentGiven) {
      setError(t('auth:signUp.consentRequired'));
      return;
    }

    setLoading(true);
    setError('');

    const { error: signUpError } = await signUp(email, password);

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
    } else {
      router.replace('/(auth)/email-confirmation');
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <ChevronLeft size={24} color="#111827" />
          </Pressable>

          <Animated.View entering={FadeInDown.delay(200)} style={styles.header}>
            <Text style={styles.title}>{t('auth:signUp.title')}</Text>
            <Text style={styles.subtitle}>{t('auth:signUp.subtitle')}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(400)} style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth:signUp.email')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth:signUp.emailPlaceholder')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!loading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth:signUp.password')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth:signUp.passwordPlaceholder')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!loading}
              />
              <Text style={styles.hint}>{t('auth:signUp.passwordHint')}</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth:signUp.confirmPassword')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth:signUp.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                editable={!loading}
              />
            </View>

            <View style={styles.consentRow}>
              <Pressable
                style={[styles.checkbox, consentGiven && styles.checkboxChecked]}
                onPress={() => setConsentGiven((prev) => !prev)}
                hitSlop={8}
                disabled={loading}
              >
                {consentGiven && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
              </Pressable>
              <Text style={styles.consentText} onPress={() => setConsentGiven((prev) => !prev)}>
                {t('auth:signUp.consentPrefix')}{' '}
                <Text
                  style={styles.consentLink}
                  onPress={() =>
                    WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-terms')
                  }
                >
                  {t('auth:signUp.consentTerms')}
                </Text>{' '}
                {t('auth:signUp.consentText')}{' '}
                <Text
                  style={styles.consentLink}
                  onPress={() =>
                    WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-privacy')
                  }
                >
                  {t('auth:signUp.consentLink')}
                </Text>
                {/* « je comprends que Lucy est une IA » (règlement IA, art. 50),
                    rattaché à la case à cocher. La mention OpenAI a été retirée
                    d'ici le 15 sept. 2026 (voir welcome.tsx). */}
                , {t('auth:signUp.aiNotice')}
              </Text>
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleSignUp}
              disabled={loading}
            >
              <Text style={styles.submitButtonText}>
                {loading ? t('auth:signUp.creatingAccount') : t('auth:signUp.signUpButton')}
              </Text>
            </Pressable>

            <Pressable style={styles.signInLink} onPress={() => router.replace('/(auth)/sign-in')}>
              <Text style={styles.signInLinkText}>
                {t('auth:signUp.alreadyHaveAccount')}{' '}
                <Text style={styles.signInLinkTextBold}>{t('auth:signUp.signIn')}</Text>
              </Text>
            </Pressable>
          </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
  },
  form: {
    gap: 24,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  hint: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#F97316',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#F97316',
  },
  consentText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
  },
  consentLink: {
    color: '#F97316',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  errorContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
  },
  submitButton: {
    backgroundColor: '#F97316',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  signInLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  signInLinkText: {
    fontSize: 14,
    color: '#6B7280',
  },
  signInLinkTextBold: {
    fontWeight: '600',
    color: '#F97316',
  },
});
