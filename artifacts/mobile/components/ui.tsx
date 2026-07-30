import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: colors.radius,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topInset =
    Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  return (
    <View
      style={{
        paddingTop: topInset + 12,
        paddingHorizontal: 20,
        paddingBottom: 12,
        backgroundColor: colors.background,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: 24,
            fontFamily: 'Inter_700Bold',
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 13,
              fontFamily: 'Inter_400Regular',
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function LangToggle() {
  const colors = useColors();
  const { lang, toggleLang } = useI18n();
  return (
    <Pressable
      testID="lang-toggle"
      onPress={toggleLang}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginStart: 8,
      })}
    >
      <Text
        style={{
          color: colors.primary,
          fontSize: 13,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {lang === 'en' ? 'العربية' : 'EN'}
      </Text>
    </Pressable>
  );
}

export function Badge({
  label,
  color,
  textColor,
}: {
  label: string;
  color: string;
  textColor?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: color + '26',
        borderColor: color + '66',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: textColor ?? color,
          fontSize: 11,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  testID,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'destructive' | 'outline';
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  testID?: string;
  small?: boolean;
}) {
  const colors = useColors();
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'destructive'
        ? colors.destructive
        : 'transparent';
  const fg =
    variant === 'primary'
      ? colors.primaryForeground
      : variant === 'destructive'
        ? colors.destructiveForeground
        : colors.foreground;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderColor: variant === 'outline' ? colors.border : bg,
        borderWidth: 1,
        borderRadius: colors.radius,
        paddingVertical: small ? 8 : 14,
        paddingHorizontal: small ? 14 : 20,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        opacity: disabled || loading ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Feather name={icon} size={small ? 14 : 17} color={fg} />
      ) : null}
      <Text
        style={{
          color: fg,
          fontSize: small ? 13 : 16,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  message,
}: {
  icon: keyof typeof Feather.glyphMap;
  message: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <Feather name={icon} size={32} color={colors.mutedForeground} />
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 14,
          fontFamily: 'Inter_400Regular',
          marginTop: 8,
          textAlign: 'center',
        }}
      >
        {message}
      </Text>
    </View>
  );
}

export function LoadingView() {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function ErrorView({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <Feather name="alert-triangle" size={30} color={colors.destructive} />
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 14,
          fontFamily: 'Inter_400Regular',
          marginVertical: 10,
        }}
      >
        {t('loadFailed')}
      </Text>
      <AppButton label={t('retry')} onPress={onRetry} small variant="outline" />
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.foreground,
        fontSize: 17,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 10,
        marginTop: 20,
      }}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
});
