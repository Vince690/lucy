import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronLeft } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useTranslation(['auth']);
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    if (!email || !password) {
      setError(t('auth:signIn.fillAllFields'));
      return;
    }

    setLoading(true);
    setError('');

    const { error: signInError } = await signIn(email, password);

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
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
            <Text style={styles.title}>{t('auth:signIn.title')}</Text>
            <Text style={styles.subtitle}>{t('auth:signIn.subtitle')}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(400)} style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth:signIn.email')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth:signIn.emailPlaceholder')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!loading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth:signIn.password')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth:signIn.passwordPlaceholder')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!loading}
              />
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleSignIn}
              disabled={loading}
            >
              <Text style={styles.submitButtonText}>
                {loading ? t('auth:signIn.signingIn') : t('auth:signIn.signInButton')}
              </Text>
            </Pressable>

            <Pressable style={styles.signUpLink} onPress={() => router.replace('/(auth)/sign-up')}>
              <Text style={styles.signUpLinkText}>
                {t('auth:signIn.noAccount')}{' '}
                <Text style={styles.signUpLinkTextBold}>{t('auth:signIn.signUp')}</Text>
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
  signUpLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  signUpLinkText: {
    fontSize: 14,
    color: '#6B7280',
  },
  signUpLinkTextBold: {
    fontWeight: '600',
    color: '#F97316',
  },
});
