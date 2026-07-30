import React, { useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppButton, LangToggle } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ApiError } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';

// Human-friendly wait duration: seconds under a minute, minutes otherwise.
function formatRetryDuration(seconds: number, lang: 'en' | 'ar'): string {
  if (seconds < 60) {
    return lang === 'ar' ? `${seconds} ثانية` : `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (lang === 'ar') {
    return minutes === 1 ? 'دقيقة واحدة' : `${minutes} دقائق`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export default function LoginScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { user, login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Redirect href="/(tabs)" />;

  const topInset =
    Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  const handleLogin = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await login(username.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // Account lockout: surface the bilingual message from the API and,
        // when available, how long until the user can retry.
        const data = (err.data ?? {}) as {
          error?: string;
          errorAr?: string;
          retryAfterSeconds?: number;
        };
        const message =
          (lang === 'ar' ? data.errorAr : data.error) ??
          data.error ??
          t('lockoutError');
        const retry =
          typeof data.retryAfterSeconds === 'number' && data.retryAfterSeconds > 0
            ? lang === 'ar'
              ? ` ${'يمكنك المحاولة مرة أخرى بعد'} ${formatRetryDuration(data.retryAfterSeconds, 'ar')}.`
              : ` You can try again in ${formatRetryDuration(data.retryAfterSeconds, 'en')}.`
            : '';
        setError(message + retry);
      } else {
        setError(t('loginError'));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: topInset + 40,
          paddingHorizontal: 28,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'flex-end' }}>
          <LangToggle />
        </View>

        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 36 }}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={{ width: 88, height: 88, borderRadius: 22 }}
          />
          <Text
            style={{
              color: colors.foreground,
              fontSize: 26,
              fontFamily: 'Inter_700Bold',
              marginTop: 18,
            }}
          >
            {t('appName')}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 14,
              fontFamily: 'Inter_400Regular',
              marginTop: 6,
            }}
          >
            {t('loginHint')}
          </Text>
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {t('username')}
        </Text>
        <TextInput
          testID="input-username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="admin"
          placeholderTextColor={colors.mutedForeground + '88'}
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              borderRadius: colors.radius,
            },
          ]}
        />

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {t('password')}
        </Text>
        <TextInput
          testID="input-password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.mutedForeground + '88'}
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              borderRadius: colors.radius,
            },
          ]}
        />

        {error ? (
          <Text
            style={{
              color: colors.destructive,
              fontSize: 13,
              fontFamily: 'Inter_500Medium',
              marginBottom: 12,
            }}
          >
            {error}
          </Text>
        ) : null}

        <AppButton
          testID="button-login"
          label={t('login')}
          onPress={handleLogin}
          loading={loading}
          disabled={!username.trim() || !password}
          icon="log-in"
        />
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
});
