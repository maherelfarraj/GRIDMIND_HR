import React from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
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
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  canViewPrivilegedSessions,
  outcomeStringKey,
} from '@/lib/privileged-session-review';
import { useGetUser, useListPrivilegedSessions } from '@workspace/api-client-react';
import type { PrivilegedSession } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SessionRow({ item }: { item: PrivilegedSession }) {
  const colors = useColors();
  const { t } = useI18n();
  const router = useRouter();
  const reviewed = !!item.reviewedAt;
  const outcomeKey = outcomeStringKey(item.reviewOutcome);
  const outcomeColor =
    item.reviewOutcome === 'justified'
      ? colors.success
      : item.reviewOutcome === 'unjustified'
        ? colors.destructive
        : item.reviewOutcome === 'under_investigation'
          ? colors.warning
          : colors.mutedForeground;

  return (
    <Pressable
      testID={`session-row-${item.id}`}
      onPress={() => router.push(`/privileged-session/${item.id}` as any)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
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
              {item.userName ?? `#${item.userId}`}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginTop: 4,
              }}
            >
              {t('grant')} #{item.breakGlassAccessId}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginTop: 2,
              }}
            >
              {t('started')}: {fmtDate(item.startedAt)}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginTop: 2,
              }}
            >
              {item.endedAt
                ? `${t('ended')}: ${fmtDate(item.endedAt)}${item.endReason ? ` (${item.endReason})` : ''}`
                : `${t('openUntil')} ${fmtDate(item.scheduledEndAt)}`}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Badge
              label={t(outcomeKey)}
              color={reviewed ? outcomeColor : colors.warning}
            />
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function PrivilegedSessionsScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const { user, isLoading: authLoading } = useAuth();

  // Route-level gate: this screen is reachable by direct navigation, so it
  // must not rely on the Home entry point being hidden. Confirm the signed-in
  // account's role against the server before fetching anything; the API
  // endpoints are also role-gated server-side (the real boundary).
  const me = useGetUser(user?.id ?? 0, {
    query: { enabled: !!user?.id },
  } as any);
  const canView = canViewPrivilegedSessions(me.data?.roleNameEn);

  const sessions = useListPrivilegedSessions(undefined, {
    query: { enabled: canView },
  } as any);
  const all = sessions.data ?? [];
  const pending = all.filter((s) => !s.reviewedAt);
  const reviewed = all.filter((s) => !!s.reviewedAt);

  // Unauthenticated: back to sign-in, same as the tab guards.
  if (!authLoading && !user) return <Redirect href="/login" />;
  // Confirmed unauthorized (or the server refused the role lookup): deny and
  // leave — never render privileged-session data.
  if (me.isError || (me.isSuccess && !canView)) {
    return <Redirect href="/(tabs)" />;
  }

  const sections = [
    { key: 'pending', title: `${t('awaitingReview')} (${pending.length})`, data: pending, empty: t('noSessionsPending') },
    { key: 'reviewed', title: `${t('reviewedSessions')} (${reviewed.length})`, data: reviewed, empty: t('noReviewedSessions') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('sessionReview')}
        subtitle={t('sessionReviewSubtitle')}
        right={<LangToggle />}
      />
      {authLoading || me.isLoading || sessions.isLoading ? (
        <LoadingView />
      ) : sessions.isError ? (
        <ErrorView onRetry={() => sessions.refetch()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => sessions.refetch()}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginBottom: 12,
              }}
            >
              {t('sessionReviewInfo')}
            </Text>
          }
          renderSectionHeader={({ section }) => (
            <Text
              style={{
                color: colors.foreground,
                fontSize: 14,
                fontFamily: 'Inter_600SemiBold',
                marginTop: 8,
                marginBottom: 10,
              }}
            >
              {section.title}
            </Text>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  fontFamily: 'Inter_400Regular',
                  marginBottom: 16,
                }}
              >
                {section.empty}
              </Text>
            ) : null
          }
          renderItem={({ item }) => <SessionRow item={item} />}
          ListEmptyComponent={
            <EmptyState icon="shield" message={t('noSessionsPending')} />
          }
        />
      )}
    </View>
  );
}
