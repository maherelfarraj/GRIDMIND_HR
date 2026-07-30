import React from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import {
  Badge,
  Card,
  EmptyState,
  ErrorView,
  LangToggle,
  LoadingView,
  ScreenHeader,
} from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';
import { useListAnnouncements } from '@workspace/api-client-react';
import type { Announcement } from '@workspace/api-client-react';

const POLL_MS = 60000;

function AnnouncementCard({ item }: { item: Announcement }) {
  const colors = useColors();
  const { lang } = useI18n();
  const title = lang === 'ar' && item.titleAr ? item.titleAr : item.titleEn;
  const body = lang === 'ar' && item.bodyAr ? item.bodyAr : item.bodyEn;
  return (
    <Card style={{ marginBottom: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <Text
          style={{
            color: colors.foreground,
            fontSize: 15,
            fontFamily: 'Inter_600SemiBold',
            flex: 1,
          }}
        >
          {title}
        </Text>
        {item.category ? (
          <Badge label={item.category} color={colors.primary} />
        ) : null}
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 13,
          fontFamily: 'Inter_400Regular',
          marginTop: 8,
          lineHeight: 19,
        }}
      >
        {body}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 11,
          fontFamily: 'Inter_400Regular',
          marginTop: 10,
        }}
      >
        {new Date(item.publishedAt ?? item.createdAt).toLocaleDateString()}
      </Text>
    </Card>
  );
}

export default function AnnouncementsScreen() {
  const colors = useColors();
  const { t } = useI18n();

  const announcements = useListAnnouncements(
    { status: 'published', limit: 50 },
    { query: { refetchInterval: POLL_MS } } as any,
  );

  const items = announcements.data?.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('announcements')}
        subtitle={t('updatedLive')}
        right={<LangToggle />}
      />
      {announcements.isLoading ? (
        <LoadingView />
      ) : announcements.isError ? (
        <ErrorView onRetry={() => announcements.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => String(a.id)}
          scrollEnabled={items.length > 0}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 118,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => announcements.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="radio" message={t('noAnnouncements')} />
          }
          renderItem={({ item }) => <AnnouncementCard item={item} />}
        />
      )}
    </View>
  );
}
