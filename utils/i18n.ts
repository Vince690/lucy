import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import translation files
import commonFr from '../locales/fr/common.json';
import commonEn from '../locales/en/common.json';
import chatFr from '../locales/fr/chat.json';
import chatEn from '../locales/en/chat.json';
import moodFr from '../locales/fr/mood.json';
import moodEn from '../locales/en/mood.json';
import settingsFr from '../locales/fr/settings.json';
import settingsEn from '../locales/en/settings.json';
import authFr from '../locales/fr/auth.json';
import authEn from '../locales/en/auth.json';
import onboardingFr from '../locales/fr/onboarding.json';
import onboardingEn from '../locales/en/onboarding.json';

const LANGUAGE_STORAGE_KEY = 'user_language_preference';

// Function to normalize locale (fr-FR -> fr, en-US -> en)
const normalizeLocale = (locale: string): string => {
  const languageCode = locale.split('-')[0];
  return ['fr', 'en'].includes(languageCode) ? languageCode : 'en';
};

// Function to get system language
const getSystemLanguage = (): string => {
  const deviceLocale = Localization.getLocales()[0]?.languageCode || 'en';
  return normalizeLocale(deviceLocale);
};

// Function to load user language preference from AsyncStorage
export const loadUserLanguagePreference = async (): Promise<string | null> => {
  try {
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return savedLanguage;
  } catch (error) {
    console.warn('Failed to load language preference:', error);
    return null;
  }
};

// Function to save user language preference to AsyncStorage
export const saveUserLanguagePreference = async (language: string | null): Promise<void> => {
  try {
    if (language === null || language === 'system') {
      await AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
  } catch (error) {
    console.warn('Failed to save language preference:', error);
  }
};

// Function to change app language
export const changeAppLanguage = async (language: string): Promise<void> => {
  try {
    let targetLanguage: string;
    
    if (language === 'system') {
      // Reset to system language
      targetLanguage = getSystemLanguage();
      await saveUserLanguagePreference(null);
    } else {
      // Validate language is supported
      if (!['fr', 'en'].includes(language)) {
        console.warn(`Unsupported language: ${language}, falling back to English`);
        targetLanguage = 'en';
      } else {
        targetLanguage = language;
      }
      await saveUserLanguagePreference(targetLanguage);
    }
    
    await i18n.changeLanguage(targetLanguage);
  } catch (error) {
    console.warn('Failed to change language:', error);
  }
};

// Function to get current language display info
export const getCurrentLanguageInfo = async (): Promise<{
  isSystemMode: boolean;
  currentLanguage: string;
  displayName: string;
}> => {
  try {
    const savedLanguage = await loadUserLanguagePreference();
    const currentLanguage = i18n.language || 'en';
    const isSystemMode = savedLanguage === null;
    
    let displayName: string;
    if (isSystemMode) {
      const systemLangName = currentLanguage === 'fr' ? 'Français' : 'English';
      displayName = i18n.t('settings:language.systemWithCurrent', { language: systemLangName });
    } else {
      displayName = currentLanguage === 'fr' ? 
        i18n.t('settings:language.french') : 
        i18n.t('settings:language.english');
    }
    
    return {
      isSystemMode,
      currentLanguage,
      displayName
    };
  } catch (error) {
    console.warn('Failed to get language info:', error);
    return {
      isSystemMode: true,
      currentLanguage: 'en',
      displayName: 'English'
    };
  }
};

const resources = {
  fr: {
    common: commonFr,
    chat: chatFr,
    mood: moodFr,
    settings: settingsFr,
    auth: authFr,
    onboarding: onboardingFr,
  },
  en: {
    common: commonEn,
    chat: chatEn,
    mood: moodEn,
    settings: settingsEn,
    auth: authEn,
    onboarding: onboardingEn,
  },
};

// Initialize i18n with user preference or system language
const initializeI18n = async () => {
  try {
    const savedLanguage = await loadUserLanguagePreference();
    const initialLanguage = savedLanguage || getSystemLanguage();
    
    await i18n
      .use(initReactI18next)
      .init({
        resources,
        lng: initialLanguage,
        fallbackLng: 'en',
        supportedLngs: ['fr', 'en'],
        
        // Namespace configuration
        defaultNS: 'common',
        ns: ['common', 'chat', 'mood', 'settings', 'auth', 'onboarding'],
        
        // Options
        returnNull: false,
        returnEmptyString: false,
        
        interpolation: {
          escapeValue: false, // React already escapes values
        },
        
        // Debug in development
        debug: __DEV__,
      });
  } catch (error) {
    console.warn('Failed to initialize i18n:', error);
    // Fallback initialization
    await i18n
      .use(initReactI18next)
      .init({
        resources,
        lng: 'en',
        fallbackLng: 'en',
        supportedLngs: ['fr', 'en'],
        defaultNS: 'common',
        ns: ['common', 'chat', 'mood', 'settings', 'auth', 'onboarding'],
        returnNull: false,
        returnEmptyString: false,
        interpolation: {
          escapeValue: false,
        },
        debug: __DEV__,
      });
  }
};

// Initialize immediately
initializeI18n();


/**
 * Contexte i18next d'accord en genre pour l'onboarding : les clés `_female`
 * sont utilisées quand l'utilisatrice s'est identifiée femme, sinon masculin
 * de principe (clé de base). Passe-le en option : t(key, { context: genderContext(g) }).
 */
export function genderContext(gender?: string): 'female' | undefined {
  return gender === 'female' ? 'female' : undefined;
}

export default i18n;