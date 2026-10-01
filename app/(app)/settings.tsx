import React from 'react';
import { useTranslation } from 'react-i18next';
import { changeAppLanguage, getCurrentLanguageInfo } from '@/utils/i18n';
import i18n from '@/utils/i18n';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import {
  scheduleNotificationChain,
  cancelAllNotifications,
  getPermissionStatus,
} from '@/utils/notificationService';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Bell, Globe, Shield, Scale, FileText, Folder, CircleHelp as HelpCircle, Star, ChevronRight, Trash2, LogOut, User, Brain } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { postMemoryReset, LucyApiError } from '@/utils/lucyApi';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { track } from '@/utils/analytics';

interface SettingItemProps {
  icon: any;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  showChevron?: boolean;
  destructive?: boolean;
}

// Helper function to safely render React.ReactNode content
// Ensures strings and numbers are wrapped in <Text> components
const renderNodeSafely = (node: React.ReactNode, textStyle?: any): React.ReactNode => {
  // Handle null, undefined, false, empty strings, or whitespace-only strings
  if (node === null || node === undefined || node === false || node === '' || 
      (typeof node === 'string' && node.trim() === '')) {
    return null;
  }
  
  // Handle strings and numbers - wrap in Text component
  if (typeof node === 'string' || typeof node === 'number') {
    return <Text style={textStyle}>{node}</Text>;
  }
  
  // Handle arrays - recursively process each item
  if (Array.isArray(node)) {
    return node.map((item, index) => {
      const renderedItem = renderNodeSafely(item, textStyle);
      // Skip null/undefined items
      if (renderedItem === null || renderedItem === undefined) {
        return null;
      }
      // Add key for React elements, use index for primitives
      if (React.isValidElement(renderedItem)) {
        return React.cloneElement(renderedItem, { key: renderedItem.key || index });
      }
      // Wrap any remaining content in Text to prevent bare text nodes
      return <Text key={index} style={textStyle}>{renderedItem}</Text>;
    }).filter(Boolean); // Remove null items
  }
  
  // For valid React elements, return as-is
  return node;
};

export default function SettingsScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { user, profile, session, signOut, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(profile?.notification_preferences?.enabled ?? true);
  const [languageSubtitle, setLanguageSubtitle] = React.useState('');
  const [lucyMemoryResetLoading, setLucyMemoryResetLoading] = React.useState(false);
  const [legalOpen, setLegalOpen] = React.useState(false);
  const legalChevronRotation = useSharedValue(0);

  const animatedLegalChevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${legalChevronRotation.value}deg` }],
  }));

  const handleLegalToggle = () => {
    track('settings_item_tapped', { item: 'legal' });
    const next = !legalOpen;
    setLegalOpen(next);
    legalChevronRotation.value = withTiming(next ? 90 : 0, { duration: 200 });
  };

  // Load language info on component mount and when language changes
  React.useEffect(() => {
    const updateLanguageSubtitle = async () => {
      const languageInfo = await getCurrentLanguageInfo();
      setLanguageSubtitle(languageInfo.displayName);
    };

    updateLanguageSubtitle();

    const handleLanguageChange = () => {
      updateLanguageSubtitle();
    };

    i18n.on('languageChanged', handleLanguageChange);

    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, [i18n]);

  const handleLanguage = () => {
    track('settings_item_tapped', { item: 'language' });
    Alert.alert(
      t('settings:language.title'),
      '',
      [
        {
          text: t('settings:language.system'),
          onPress: async () => {
            await changeAppLanguage('system');
          }
        },
        {
          text: t('settings:language.french'),
          onPress: async () => {
            await changeAppLanguage('fr');
          }
        },
        {
          text: t('settings:language.english'),
          onPress: async () => {
            await changeAppLanguage('en');
          }
        },
        {
          text: t('common:cancel'),
          style: 'cancel'
        }
      ]
    );
  };

  const handleNotificationToggle = async (value: boolean) => {
    setNotificationsEnabled(value);

    if (value) {
      // Check if permission was denied on iOS — can't re-ask, must redirect to Settings
      const permStatus = await getPermissionStatus();
      if (permStatus === Notifications.PermissionStatus.DENIED) {
        // Revert toggle
        setNotificationsEnabled(false);
        Alert.alert(
          t('settings:notifications.permissionDeniedTitle'),
          t('settings:notifications.permissionDeniedMessage'),
          [
            { text: t('common:cancel'), style: 'cancel' },
            {
              text: t('settings:notifications.openSettings'),
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              },
            },
          ]
        );
        return;
      }
    }

    if (profile) {
      await updateProfile({
        notification_preferences: {
          ...profile.notification_preferences,
          enabled: value,
        },
      });
    }

    if (value) {
      scheduleNotificationChain(
        profile?.first_name || '',
        i18n.language || 'fr',
      ).catch(() => {});
    } else {
      cancelAllNotifications().catch(() => {});
    }
  };

  const handleLogout = () => {
    track('settings_item_tapped', { item: 'logout' });
    Alert.alert(
      t('settings:logout.confirmTitle'),
      t('settings:logout.confirmMessage'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('settings:logout.confirm'),
          style: 'destructive',
          onPress: async () => {
            await signOut();
          }
        },
      ]
    );
  };

  const handleLucyMemoryReset = () => {
    track('settings_item_tapped', { item: 'memory_reset' });
    if (lucyMemoryResetLoading) return;

    const token = session?.access_token;
    const userId = user?.id;
    if (!token || !userId) {
      Alert.alert(
        t('settings:lucyMemoryReset.errorTitle'),
        t('settings:lucyMemoryReset.errorMessage')
      );
      return;
    }

    Alert.alert(
      t('settings:lucyMemoryReset.confirmTitle'),
      t('settings:lucyMemoryReset.confirmMessage'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('settings:lucyMemoryReset.confirm'),
          style: 'destructive',
          onPress: async () => {
            setLucyMemoryResetLoading(true);
            try {
              await postMemoryReset(token, userId);
              // Geste fort et confirmé : soit un besoin de recommencer, soit une
              // déception. À distinguer de la simple ouverture du réglage.
              track('lucy_memory_reset');
              Alert.alert(
                t('settings:lucyMemoryReset.successTitle'),
                t('settings:lucyMemoryReset.successMessage')
              );
            } catch (e) {
              const message =
                e instanceof LucyApiError
                  ? e.message
                  : t('settings:lucyMemoryReset.errorMessage');
              Alert.alert(t('settings:lucyMemoryReset.errorTitle'), message);
            } finally {
              setLucyMemoryResetLoading(false);
            }
          },
        },
      ]
    );
  };

  // Suppression de compte — exigence 5.1.1(v). La logique et le texte de
  // conformité vivent dans useDeleteAccount, partagés avec l'écran
  // `(onboarding)/account` : deux copies divergeraient.
  const handleDeleteAccount = useDeleteAccount();

  // Identifiant App Store de Lucy (eas.json → submit.production.ios.ascAppId).
  // `action=write-review` ouvre l'App Store directement sur le formulaire d'avis.
  const APP_STORE_REVIEW_URL = 'https://apps.apple.com/app/id6788634089?action=write-review';

  // Lucy est en ligne sur l'App Store depuis septembre 2026 : l'URL ci-dessus
  // aboutit (vérifié : HTTP 200), l'entrée est donc affichée sur iOS.
  // Sur Android elle reste masquée, pour la même raison qui l'avait masquée
  // partout jusqu'ici : l'app n'est pas encore sur le Play Store (vérifié : HTTP
  // 404), et ce lien y ouvrirait la fiche App Store dans un navigateur, où l'on
  // ne peut rien noter.
  // → Le jour de la sortie Android, ajouter l'URL Play Store et choisir l'une ou
  //   l'autre selon `Platform.OS` plutôt que de masquer l'entrée.
  const CAN_RATE_APP = Platform.OS === 'ios';

  const handleRateApp = () => {
    track('settings_item_tapped', { item: 'rate_app' });
    Alert.alert(t('settings:rate.title'), t('settings:rate.message'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('settings:rate.confirm'),
        onPress: () => {
          Linking.openURL(APP_STORE_REVIEW_URL).catch(() => {
            Alert.alert(t('settings:rate.title'), t('settings:rate.errorMessage'));
          });
        },
      },
    ]);
  };

  const handleHelp = () => {
    track('settings_item_tapped', { item: 'help' });
    Alert.alert(
      t('settings:help.title'),
      t('settings:help.message'),
      [
        {
          text: t('settings:help.copyEmail'),
          onPress: async () => {
            await Clipboard.setStringAsync('help.lucyai@proton.me');
            Alert.alert('', t('settings:help.emailCopied'));
          },
        },
        { text: t('settings:help.close'), style: 'cancel' },
      ]
    );
  };

  const SettingItem = ({ 
    icon: Icon, 
    title, 
    subtitle, 
    onPress, 
    rightElement, 
    showChevron = false,
    destructive = false 
  }: SettingItemProps) => (
    <Pressable 
      style={[styles.settingItem, destructive && styles.settingItemDestructive]} 
      onPress={onPress}
    >
      <View style={styles.settingItemLeft}>
        <View style={[
          styles.iconContainer,
          destructive && styles.iconContainerDestructive
        ]}>
          <Icon 
            size={20} 
            color={destructive ? '#EF4444' : '#6B7280'} 
            strokeWidth={2}
          />
        </View>
        <View style={styles.textContainer}>
          <Text style={[
            styles.settingTitle,
            destructive && styles.settingTitleDestructive
          ]}>
            {title}
          </Text>
          {subtitle && subtitle.trim() !== '' && (
            <Text style={styles.settingSubtitle}>{subtitle}</Text>
          )}
        </View>
      </View>
      
      <View style={styles.settingItemRight}>
        {rightElement && renderNodeSafely(rightElement, styles.settingSubtitle)}
        {showChevron && (
          <ChevronRight 
            size={20} 
            color="#9CA3AF" 
            strokeWidth={2}
          />
        )}
      </View>
    </Pressable>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, 20),
          paddingBottom: Math.max(insets.bottom, 20)
        }
      ]}
    >
      <Animated.View entering={FadeIn.delay(100)} style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings:account')}</Text>

        <View style={styles.settingsGroup}>
          <SettingItem
            icon={User}
            title={profile?.first_name || t('settings:profile.title')}
            subtitle={user?.email || ''}
            onPress={() => {
              track('settings_item_tapped', { item: 'edit_profile' });
              router.push('/(app)/edit-profile');
            }}
            showChevron
          />
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(100)} style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings:preferences')}</Text>

        <View style={styles.settingsGroup}>
          <SettingItem
            icon={Bell}
            title={t('settings:notifications.title')}
            subtitle={t('settings:notifications.subtitle')}
            // Orange plein sur le rail actif + pastille blanche : c'est la
            // convention iOS. L'ancien rail #FED7AA (orange très pâle) donnait
            // l'impression d'un interrupteur désactivé, donc non modifiable.
            rightElement={
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationToggle}
                trackColor={{ false: '#E5E7EB', true: '#F97316' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#E5E7EB"
              />
            }
          />

          <SettingItem
            icon={Globe}
            title={t('settings:language.title')}
            subtitle={languageSubtitle}
            onPress={handleLanguage}
            showChevron
          />
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(200)} style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings:support')}</Text>
        
        <View style={styles.settingsGroup}>
          <SettingItem
            icon={HelpCircle}
            title={t('settings:help.title')}
            subtitle={t('settings:help.subtitle')}
            onPress={handleHelp}
            showChevron
          />
          
          {CAN_RATE_APP && (
            <SettingItem
              icon={Star}
              title={t('settings:rate.title')}
              subtitle={t('settings:rate.subtitle')}
              onPress={handleRateApp}
              showChevron
            />
          )}
          
          <Pressable style={styles.settingItem} onPress={handleLegalToggle}>
            <View style={styles.settingItemLeft}>
              <View style={styles.iconContainer}>
                <Folder size={20} color="#6B7280" strokeWidth={2} />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.settingTitle}>{t('settings:legalGroup.title')}</Text>
                {!legalOpen && (
                  <Text style={styles.settingSubtitle}>{t('settings:legalGroup.subtitle')}</Text>
                )}
              </View>
            </View>
            <Animated.View style={animatedLegalChevron}>
              <ChevronRight size={20} color="#9CA3AF" strokeWidth={2} />
            </Animated.View>
          </Pressable>

          {legalOpen && (
            <Animated.View entering={FadeIn.duration(200)}>
              <SettingItem
                icon={Shield}
                title={t('settings:privacy.title')}
                subtitle={t('settings:privacy.subtitle')}
                onPress={() => WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-privacy')}
                showChevron
              />
              <SettingItem
                icon={FileText}
                title={t('settings:terms.title')}
                subtitle={t('settings:terms.subtitle')}
                onPress={() => WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-terms')}
                showChevron
              />
              <SettingItem
                icon={Scale}
                title={t('settings:legal.title')}
                subtitle={t('settings:legal.subtitle')}
                onPress={() =>
                  WebBrowser.openBrowserAsync(
                    i18n.language === 'fr'
                      ? 'https://yourfriendlucy.com/fr/legal'
                      : 'https://yourfriendlucy.com/legal',
                  )
                }
                showChevron
              />
            </Animated.View>
          )}
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(300)} style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings:data')}</Text>

        <View style={styles.settingsGroup}>
          <SettingItem
            icon={Brain}
            title={t('settings:lucyMemoryReset.title')}
            subtitle={
              lucyMemoryResetLoading
                ? undefined
                : t('settings:lucyMemoryReset.subtitle')
            }
            onPress={handleLucyMemoryReset}
            rightElement={
              lucyMemoryResetLoading ? (
                <ActivityIndicator color="#F97316" />
              ) : undefined
            }
            destructive
          />

          <SettingItem
            icon={Trash2}
            title={t('settings:deleteAccount.title')}
            subtitle={t('settings:deleteAccount.subtitle')}
            onPress={handleDeleteAccount}
            destructive
          />
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(400)} style={[styles.section, styles.logoutSection]}>
        <View style={styles.settingsGroup}>
          <SettingItem
            icon={LogOut}
            title={t('settings:logout.title')}
            subtitle={t('settings:logout.subtitle')}
            onPress={handleLogout}
            destructive
          />
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(400)} style={styles.appInfo}>
        <Text style={styles.appVersion}>Version {Constants.expoConfig?.version ?? ''}</Text>
        <Text style={styles.appCredits}>{t('settings:appInfo.credits')}</Text>
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
    padding: 20,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  settingsGroup: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  settingItemDestructive: {
    backgroundColor: '#FEF2F2',
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  iconContainerDestructive: {
    backgroundColor: '#FEE2E2',
  },
  textContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  settingTitleDestructive: {
    color: '#EF4444',
  },
  settingSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  logoutSection: {
    marginTop: 16,
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 32,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  appVersion: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  appCredits: {
    fontSize: 14,
    color: '#6B7280',
  },
});