import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { changePasswordErrorMessage } from '@/lib/change-password-errors';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ApiError, changeMyPassword } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

export default function ChangePasswordScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, markPasswordChanged } = useAuth();

  // Forced flow: accounts provisioned with a one-time password must change
  // it before entering the app. Latched at mount so the UI stays in forced
  // mode through the success state even after the flag is cleared.
  const [required] = useState(() => !!user?.mustChangePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const topInset =
    Platform.OS === 'web' ? Math.max(insets.top, 20) : Math.max(insets.top, 12);

  const mismatch =
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    newPassword !== confirmPassword;

  const canSubmit =
    !!currentPassword &&
    !!newPassword &&
    !!confirmPassword &&
    newPassword === confirmPassword;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await changeMyPassword({ currentPassword, newPassword });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Clear the flag right away so the navigation guards stop bouncing
      // the user back here, however they leave this screen.
      markPasswordChanged();
      setSuccess(true);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null;
      const data = err instanceof ApiError ? err.data : null;
      setError(changePasswordErrorMessage(status, data, lang, t));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      color: colors.foreground,
      borderRadius: colors.radius,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: topInset + 12,
          paddingHorizontal: 24,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontSize: 22,
              fontFamily: 'Inter_700Bold',
            }}
          >
            {t('changePassword')}
          </Text>
          {!required ? (
            <Pressable
              testID="button-close-change-password"
              onPress={() => router.back()}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
              accessibilityLabel={t('cancel')}
            >
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {required && !success ? (
          <View
            testID="text-password-change-required"
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 14,
              marginBottom: 20,
            }}
          >
            <Feather name="shield" size={18} color={colors.primary} style={{ marginTop: 2 }} />
            <Text
              style={{
                flex: 1,
                color: colors.foreground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
                lineHeight: 19,
              }}
            >
              {t('passwordChangeRequiredHint')}
            </Text>
          </View>
        ) : null}

        {success ? (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Feather name="check-circle" size={40} color={colors.success} />
            <Text
              style={{
                color: colors.foreground,
                fontSize: 17,
                fontFamily: 'Inter_600SemiBold',
                marginTop: 16,
                textAlign: 'center',
              }}
            >
              {t('passwordChanged')}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 14,
                fontFamily: 'Inter_400Regular',
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              {t('passwordChangedHint')}
            </Text>
            <View style={{ marginTop: 24, alignSelf: 'stretch' }}>
              <AppButton
                testID="button-done-change-password"
                label={t('done')}
                onPress={() =>
                  required ? router.replace('/(tabs)') : router.back()
                }
                icon="check"
              />
            </View>
          </View>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              {t('currentPassword')}
            </Text>
            <TextInput
              testID="input-current-password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground + '88'}
              style={inputStyle}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              {t('newPassword')}
            </Text>
            <TextInput
              testID="input-new-password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground + '88'}
              style={inputStyle}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              {t('confirmNewPassword')}
            </Text>
            <TextInput
              testID="input-confirm-password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground + '88'}
              style={inputStyle}
            />

            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginBottom: 12,
              }}
            >
              {t('passwordPolicyHint')}
            </Text>

            {mismatch ? (
              <Text
                testID="text-password-mismatch"
                style={{
                  color: colors.destructive,
                  fontSize: 13,
                  fontFamily: 'Inter_500Medium',
                  marginBottom: 12,
                }}
              >
                {t('passwordsDoNotMatch')}
              </Text>
            ) : null}

            {error ? (
              <Text
                testID="text-change-password-error"
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
              testID="button-submit-change-password"
              label={t('changePassword')}
              onPress={handleSubmit}
              loading={loading}
              disabled={!canSubmit}
              icon="lock"
            />
          </>
        )}
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
