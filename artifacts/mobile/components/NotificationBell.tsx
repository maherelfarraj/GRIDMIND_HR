import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useListNotifications } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';

/**
 * Notification bell icon with an unread-count badge.
 * Polls every 60 s and navigates to /notifications on press.
 * Shared across all tab headers so users always see the badge.
 */
export function NotificationBell() {
  const colors = useColors();
  const { t } = useI18n();
  const router = useRouter();
  const notifs = useListNotifications(undefined, {
    query: { refetchInterval: 60000 },
  } as any);
  const unread = (notifs.data?.data ?? []).filter((n) => !n.isRead).length;

  return (
    <Pressable
      testID="button-notifications"
      onPress={() => router.push('/notifications' as any)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
      accessibilityLabel={t('notifications')}
    >
      <View>
        <Feather name="bell" size={20} color={colors.mutedForeground} />
        {unread > 0 ? (
          <View
            testID="notification-unread-badge"
            style={{
              position: 'absolute',
              top: -4,
              end: -6,
              minWidth: 15,
              height: 15,
              borderRadius: 8,
              paddingHorizontal: 3,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                color: colors.primaryForeground,
                fontSize: 9,
                fontFamily: 'Inter_700Bold',
              }}
            >
              {unread > 99 ? '99+' : unread}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
