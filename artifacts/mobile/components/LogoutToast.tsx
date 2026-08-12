/**
 * Root-level toast that survives navigation.
 *
 * Rendered in RootLayoutNav (above the Stack router) so it stays visible even
 * after the tab-layout auth guard unmounts the home screen when user state
 * clears. Reads from AuthContext so it can be triggered from anywhere in the
 * auth flow without prop-drilling.
 */
import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

const TOAST_DURATION_MS = 3000;

export function LogoutToast() {
  const { logoutToast, clearLogoutToast } = useAuth();
  const colors = useColors();
  const { t } = useI18n();

  useEffect(() => {
    if (!logoutToast) return;
    const timer = setTimeout(clearLogoutToast, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [logoutToast, clearLogoutToast]);

  if (!logoutToast) return null;

  return (
    <View
      testID="toast-signed-out"
      pointerEvents="none"
      style={[
        styles.container,
        {
          bottom: Platform.OS === 'web' ? 128 : 100,
          backgroundColor: colors.foreground,
          borderRadius: 24,
        },
      ]}
    >
      <Text
        style={{
          color: colors.background,
          fontSize: 14,
          fontFamily: 'Inter_500Medium',
        }}
      >
        {t('signedOut')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 999,
    // Center horizontally: start from 0, full width, align self center
    left: 0,
    right: 0,
    alignItems: 'center',
    // pointerEvents box must not block taps on content below
  },
});
