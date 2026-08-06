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
import { computeDeviceVerdict } from '@/lib/device-verdict';
import { useListDevices } from '@workspace/api-client-react';
import type { AttendanceDevice } from '@workspace/api-client-react';

const POLL_MS = 60000;

function DeviceCard({ item }: { item: AttendanceDevice }) {
  const colors = useColors();
  const { lang, t } = useI18n();
  const location = lang === 'ar' && item.locationAr ? item.locationAr : item.location;

  // Same verdict precedence as the web devices page:
  // Online (real contact) > Stale (contact but too old) > No contact.
  const verdict = computeDeviceVerdict(item, colors);
  const { online, stale, storedDisagrees } = verdict;
  const statusLabel = t(verdict.statusKey);
  const statusColor = verdict.statusColor;

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
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 15,
              fontFamily: 'Inter_600SemiBold',
            }}
          >
            {item.name}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              fontFamily: 'Inter_400Regular',
              marginTop: 4,
            }}
          >
            {item.vendor} {item.model} · {location}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Badge label={statusLabel} color={statusColor} />
          {storedDisagrees && (
            <Badge label={t('deviceMarkedOnline')} color={colors.mutedForeground} />
          )}
        </View>
      </View>
      <Text
        style={{
          color: verdict.lastContactColor,
          fontSize: 11,
          fontFamily: 'Inter_400Regular',
          marginTop: 10,
        }}
      >
        {t('lastContact')}:{' '}
        {item.lastContactAt
          ? new Date(item.lastContactAt).toLocaleString()
          : t('never')}
      </Text>
    </Card>
  );
}

export default function DevicesScreen() {
  const colors = useColors();
  const { t } = useI18n();

  const devices = useListDevices({
    query: { refetchInterval: POLL_MS },
  } as any);

  const items = devices.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('devices')}
        subtitle={t('updatedLive')}
        right={<LangToggle />}
      />
      {devices.isLoading ? (
        <LoadingView />
      ) : devices.isError ? (
        <ErrorView onRetry={() => devices.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(d) => String(d.id)}
          scrollEnabled={items.length > 0}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => devices.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="hard-drive" message={t('noDevices')} />
          }
          renderItem={({ item }) => <DeviceCard item={item} />}
        />
      )}
    </View>
  );
}
