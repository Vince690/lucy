// Charger les variables d'environnement depuis .env
require('dotenv').config();

export default {
  expo: {
    name: 'Lucy',
    // Doit correspondre au slug du projet EAS ciblé par extra.eas.projectId,
    // sinon eas-cli refuse toute commande. Identifiant interne à Expo :
    // invisible d'Apple et des utilisateurs (c'est le bundle ID qui compte).
    slug: 'mood-chat-app',
    owner: 'vince333',
    version: '2.2.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'lucy',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.lucyai.app',
      // L'app propose « Se connecter avec Apple » (contexts/AuthContext.tsx, provider
      // 'apple' via Supabase). Sans cette déclaration, EAS en déduit que la capability
      // APPLE_ID_AUTH doit être DÉSACTIVÉE sur l'App ID et tente de la retirer — ce que
      // l'API Apple refuse dès qu'une app est rattachée au bundle, avec le message
      // trompeur « The bundle cannot be deleted ».
      usesAppleSignIn: true,
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: ['lucy'],
          },
        ],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#FFFFFF',
      },
      package: 'com.lucyai.app',
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'lucy',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-localization',
      [
        'expo-web-browser',
        {
          scheme: 'lucy',
        },
      ],
      [
        'expo-notifications',
        {
          color: '#F97316',
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 168,
          backgroundColor: '#FFFFFF',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
    },
    extra: {
      eas: {
        projectId: 'dea03283-19cd-42c9-8b0c-452b39df615d',
      },
      router: {},
      // Variables d'environnement Supabase
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
  },
};

