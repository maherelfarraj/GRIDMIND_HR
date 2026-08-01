import React from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import {
  Card,
  EmptyState,
  ErrorView,
  LangToggle,
  LoadingView,
  ScreenHeader,
} from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';
import {
  mobileRouteForNotification,
  severityColor,
  severityIcon,
} from '@/lib/notification-nav';
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkAllNotificationsRead,
  useUpdateNotification,
} from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

const POLL_MS = 60000;

function NotificationCard({
  item,
  onPress,
}: {
  item: Notification;
  onPress: (n: Notification) => void;
}) {
  const colors = useColors();
  const { lang, t } = useI18n();
  const title = lang === 'ar' && item.titleAr ? item.titleAr : item.titleEn;
  const body = lang === 'ar' && item.bodyAr ? item.bodyAr : item.bodyEn;
  const color = severityColor(item.severity, colors);
  const hasRoute = mobileRouteForNotification(item) != null;

  return (
    <Pressable
      testID={`notification-${item.id}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card
        style={{
          marginBottom: 12,
          borderStartWidth: 3,
          borderStartColor: color,
          opacity: item.isRead ? 0.75 : 1,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Feather
            name={severityIcon(item.severity) as any}
            size={18}
            color={color}
            style={{ marginTop: 1 }}
          />
          <View style={{ flex: 1 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 14,
                  fontFamily: item.isRead
                    ? 'Inter_500Medium'
                    : 'Inter_600SemiBold',
                  flex: 1,
                }}
              >
                {title}
              </Text>
              {!item.isRead ? (
                <View
                  testID={`unread-dot-${item.id}`}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.primary,
                    marginTop: 4,
                  }}
                />
              ) : null}
            </View>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
                marginTop: 6,
                lineHeight: 19,
              }}
            >
              {body}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 10,
              }}
            >
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  fontFamily: 'Inter_400Regular',
                }}
              >
                {new Date(item.createdAt).toLocaleString()}
              </Text>
              {hasRoute ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 12,
                      fontFamily: 'Inter_600SemiBold',
                    }}
                  >
                    {t('viewDevice')}
                  </Text>
                  <Feather
                    name="chevron-right"
                    size={14}
                    color={colors.primary}
                  />
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();

  const notifs = useListNotifications(undefined, {
    query: { refetchInterval: POLL_MS },
  } as any);
  const updateMut = useUpdateNotification();
  const markAllMut = useMarkAllNotificationsRead();

  const items = notifs.data?.data ?? [];
  const unreadCount = items.filter((n) => !n.isRead).length;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });

  const handlePress = async (n: Notification) => {
    const route = mobileRouteForNotification(n);
    if (route) router.push(route as any);
    if (!n.isRead) {
      try {
        await updateMut.mutateAsync({ id: n.id, data: { isRead: true } });
        invalidate();
      } catch {
        // Marking read is best-effort; navigation already happened.
      }
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAllMut.mutateAsync();
      invalidate();
    } catch {
      // Best-effort; the list keeps its current read state on failure.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('notifications')}
        subtitle={t('updatedLive')}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {unreadCount > 0 ? (
              <Pressable
                testID="mark-all-read"
                onPress={handleMarkAll}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                })}
              >
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 12,
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {t('markAllRead')}
                </Text>
              </Pressable>
            ) : null}
            <LangToggle />
          </View>
        }
      />
      {notifs.isLoading ? (
        <LoadingView />
      ) : notifs.isError ? (
        <ErrorView onRetry={() => notifs.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => String(n.id)}
          scrollEnabled={items.length > 0}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => notifs.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="bell" message={t('noNotifications')} />
          }
          renderItem={({ item }) => (
            <NotificationCard item={item} onPress={handlePress} />
          )}
        />
      )}
    </View>
  );
}
