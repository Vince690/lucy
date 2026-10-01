import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Localization from 'expo-localization';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';

const GENDER_OPTIONS = ['male', 'female', 'other', 'prefer_not_to_say'];

const parseProfileDate = (dateStr?: string): Date => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export default function EditProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation(['settings', 'common']);
  const { profile, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState(profile?.first_name || '');
  const [dateOfBirth, setDateOfBirth] = useState(parseProfileDate(profile?.date_of_birth));
  const [showDatePicker, setShowDatePicker] = useState(Platform.OS === 'ios');
  const [selectedGender, setSelectedGender] = useState(profile?.gender || '');
  const [timezone, setTimezone] = useState(profile?.timezone || '');
  const [timezoneDetected, setTimezoneDetected] = useState(false);
  const detectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  const formatDate = (date: Date) =>
    date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const handleDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDateOfBirth(selectedDate);
  };

  // La détection est synchrone et instantanée : si le fuseau trouvé est celui
  // déjà affiché, rien ne bouge à l'écran et le bouton paraît mort. On accuse
  // donc réception explicitement (vibration + libellé « Détecté » bref).
  const handleDetectTimezone = () => {
    const detected = Localization.getCalendars()[0]?.timeZone || 'UTC';
    setTimezone(detected);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTimezoneDetected(true);
    if (detectedTimer.current) clearTimeout(detectedTimer.current);
    detectedTimer.current = setTimeout(() => setTimezoneDetected(false), 1600);
  };

  useEffect(() => () => {
    if (detectedTimer.current) clearTimeout(detectedTimer.current);
  }, []);

  const handleSave = async () => {
    if (!firstName.trim()) return;
    setSaving(true);
    const { error } = await updateProfile({
      first_name: firstName.trim(),
      date_of_birth: [
        dateOfBirth.getFullYear(),
        String(dateOfBirth.getMonth() + 1).padStart(2, '0'),
        String(dateOfBirth.getDate()).padStart(2, '0'),
      ].join('-'),
      gender: selectedGender || 'prefer_not_to_say',
      timezone,
    });
    setSaving(false);
    if (error) {
      Alert.alert(
        t('settings:editProfile.errorTitle'),
        t('settings:editProfile.errorMessage'),
      );
    } else {
      router.back();
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
      keyboardShouldPersistTaps="handled"
    >
      <Animated.View entering={FadeInDown.delay(100)} style={styles.section}>
        <Text style={styles.label}>{t('settings:editProfile.firstName')}</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder={t('settings:editProfile.firstNamePlaceholder')}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="words"
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(150)} style={styles.section}>
        <Text style={styles.label}>{t('settings:editProfile.dateOfBirth')}</Text>
        {Platform.OS === 'android' && !showDatePicker && (
          <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.inputText}>{formatDate(dateOfBirth)}</Text>
          </Pressable>
        )}
        {showDatePicker && (
          <DateTimePicker
            value={dateOfBirth}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleDateChange}
            maximumDate={new Date()}
            minimumDate={new Date(1900, 0, 1)}
          />
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200)} style={styles.section}>
        <Text style={styles.label}>{t('settings:editProfile.gender')}</Text>
        <View style={styles.optionsContainer}>
          {GENDER_OPTIONS.map((option) => (
            <Pressable
              key={option}
              style={[
                styles.optionButton,
                selectedGender === option && styles.optionButtonSelected,
              ]}
              onPress={() => setSelectedGender(option)}
            >
              <Text
                style={[
                  styles.optionText,
                  selectedGender === option && styles.optionTextSelected,
                ]}
              >
                {t(`settings:editProfile.genderOptions.${option}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(250)} style={styles.section}>
        <Text style={styles.label}>{t('settings:editProfile.timezone')}</Text>
        <View style={styles.timezoneCard}>
          <Text style={styles.timezoneValue}>{timezone}</Text>
          <Pressable
            onPress={handleDetectTimezone}
            style={({ pressed }) => [
              styles.detectButton,
              timezoneDetected && styles.detectButtonDone,
              pressed && styles.detectButtonPressed,
            ]}
          >
            <Text style={styles.detectButtonText}>
              {timezoneDetected
                ? t('settings:editProfile.timezoneDetected')
                : t('settings:editProfile.timezoneDetect')}
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(300)} style={styles.saveSection}>
        <Pressable
          style={[
            styles.saveButton,
            (!firstName.trim() || saving) && styles.saveButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={!firstName.trim() || saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>{t('settings:editProfile.save')}</Text>
          )}
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    padding: 24,
    gap: 0,
  },
  section: {
    marginBottom: 28,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
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
    justifyContent: 'center',
  },
  inputText: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '500',
  },
  optionsContainer: {
    gap: 10,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: '#FFFFFF',
  },
  optionButtonSelected: {
    backgroundColor: '#FFF7ED',
    borderColor: '#F97316',
  },
  optionText: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  optionTextSelected: {
    color: '#F97316',
    fontWeight: '600',
  },
  timezoneCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#FED7AA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timezoneValue: {
    fontSize: 15,
    color: '#EA580C',
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  detectButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#F97316',
    borderRadius: 8,
  },
  detectButtonPressed: {
    backgroundColor: '#EA580C',
    opacity: 0.9,
  },
  /** État de confirmation transitoire après une détection (vert de validation). */
  detectButtonDone: {
    backgroundColor: '#16A34A',
  },
  detectButtonText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  saveSection: {
    marginTop: 8,
  },
  saveButton: {
    backgroundColor: '#F97316',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
