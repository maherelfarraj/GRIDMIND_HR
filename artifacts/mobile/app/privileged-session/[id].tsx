import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  AppButton,
  Badge,
  Card,
  LangToggle,
  LoadingView,
  ScreenHeader,
} from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  REVIEW_OUTCOMES,
  type ReviewOutcome,
  canDecidePrivilegedSessions,
  canViewPrivilegedSessions,
  outcomeStringKey,
} from '@/lib/privileged-session-review';
import {
  ACTIVITY_PAGE_SIZE,
  appendActivityPage,
  emptyActivityState,
  hasMoreActivity,
  nextActivityOffset,
} from '@/lib/session-activity';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListPrivilegedSessionsQueryKey,
  getPrivilegedSessionActivity,
  useGetUser,
  useListPrivilegedSessions,
  useReviewPrivilegedSession,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { fmtDate } from '../privileged-sessions';

const OUTCOME_LABEL_KEYS = {
  justified: 'outcomeJustified',
  unjustified: 'outcomeUnjustified',
  under_investigation: 'outcomeUnderInvestigation',
} as const;

// Audit-log actions the session holder performed during the elevated-access
// window — reviewers see what was actually touched, not just the time window.
// Mirrors the web SessionActivityList: fixed-size pages appended on demand.
function SessionActivityList({ sessionId }: { sessionId: number }) {
  const colors = useColors();
  const { lang, t } = useI18n();
  const [state, setState] = useState(emptyActivityState);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadPage = useCallback(
    async (offset: number) => {
      setIsFetching(true);
      setLoadError(false);
      try {
        const page = await getPrivilegedSessionActivity(sessionId, {
          limit: ACTIVITY_PAGE_SIZE,
          offset,
        });
        setState((prev) =>
          appendActivityPage(offset === 0 ? emptyActivityState() : prev, page),
        );
      } catch {
        setLoadError(true);
      } finally {
        setIsFetching(false);
        setIsLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    setState(emptyActivityState());
    setIsLoading(true);
    void loadPage(0);
  }, [loadPage]);

  if (isLoading) return <LoadingView />;
  if (loadError && state.items.length === 0) {
    return (
      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: colors.destructive,
            fontSize: 13,
            fontFamily: 'Inter_500Medium',
          }}
        >
          {t('activityLoadFailed')}
        </Text>
        <AppButton
          label={t('retry')}
          small
          variant="outline"
          onPress={() => void loadPage(0)}
        />
      </View>
    );
  }
  if (state.items.length === 0) {
    return (
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 13,
          fontFamily: 'Inter_400Regular',
        }}
      >
        {t('noSessionActivity')}
      </Text>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {state.correlation === 'time-window' && (
        <View
          testID="notice-time-window"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 8,
            borderWidth: 1,
            borderColor: '#f59e0b66',
            backgroundColor: '#f59e0b1a',
            borderRadius: colors.radius,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        >
          <Feather name="alert-triangle" size={14} color="#d97706" style={{ marginTop: 1 }} />
          <Text
            style={{
              flex: 1,
              color: '#d97706',
              fontSize: 12,
              fontFamily: 'Inter_500Medium',
            }}
          >
            {t('activityEstimateNotice')}
          </Text>
        </View>
      )}
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: colors.radius,
        }}
      >
        {state.items.map((a, i) => (
          <View
            key={a.id}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  color: colors.foreground,
                  fontSize: 13,
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {a.action}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  fontFamily: 'Inter_400Regular',
                }}
              >
                {fmtDate(a.createdAt)}
              </Text>
            </View>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginTop: 2,
              }}
            >
              {a.entityType}
              {a.entityId != null ? ` #${a.entityId}` : ''}
              {a.entityLabel ? ` — ${a.entityLabel}` : ''}
            </Text>
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            fontFamily: 'Inter_400Regular',
          }}
        >
          {lang === 'ar'
            ? `عرض ${state.items.length} من ${state.total} إجراء`
            : `Showing ${state.items.length} of ${state.total} actions`}
        </Text>
        {hasMoreActivity(state) && (
          <AppButton
            testID="button-load-more"
            label={loadError ? t('retry') : t('loadMore')}
            small
            variant="outline"
            loading={isFetching}
            onPress={() => void loadPage(nextActivityOffset(state))}
          />
        )}
      </View>
    </View>
  );
}

function ReviewForm({ sessionId }: { sessionId: number }) {
  const colors = useColors();
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<ReviewOutcome>('justified');
  const [notes, setNotes] = useState('');
  const [failed, setFailed] = useState(false);

  const reviewMutation = useReviewPrivilegedSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListPrivilegedSessionsQueryKey(),
        });
        router.back();
      },
      onError: () => setFailed(true),
    },
  });

  return (
    <Card style={{ marginTop: 16 }}>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 15,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {t('reviewSession')}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          fontFamily: 'Inter_400Regular',
          marginTop: 4,
        }}
      >
        {t('reviewRecordedAs')}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          fontFamily: 'Inter_500Medium',
          marginTop: 12,
          marginBottom: 6,
        }}
      >
        {t('reviewOutcome')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {REVIEW_OUTCOMES.map((o) => {
          const selected = outcome === o;
          return (
            <Pressable
              key={o}
              testID={`outcome-${o}`}
              onPress={() => setOutcome(o)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary + '22' : 'transparent',
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 7,
              })}
            >
              <Text
                style={{
                  color: selected ? colors.primary : colors.foreground,
                  fontSize: 13,
                  fontFamily: 'Inter_500Medium',
                }}
              >
                {t(OUTCOME_LABEL_KEYS[o])}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          fontFamily: 'Inter_500Medium',
          marginTop: 14,
          marginBottom: 6,
        }}
      >
        {t('reviewNotes')}
      </Text>
      <TextInput
        testID="input-review-notes"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: colors.radius,
          padding: 10,
          minHeight: 72,
          color: colors.foreground,
          fontSize: 14,
          fontFamily: 'Inter_400Regular',
          textAlignVertical: 'top',
        }}
        placeholderTextColor={colors.mutedForeground}
      />
      {failed && (
        <Text
          testID="text-review-error"
          style={{
            color: colors.destructive,
            fontSize: 13,
            fontFamily: 'Inter_500Medium',
            marginTop: 10,
          }}
        >
          {t('reviewFailed')}
        </Text>
      )}
      <View style={{ marginTop: 14 }}>
        <AppButton
          testID="button-mark-reviewed"
          label={t('markReviewed')}
          icon="check-circle"
          loading={reviewMutation.isPending}
          onPress={() => {
            setFailed(false);
            reviewMutation.mutate({
              id: sessionId,
              data: { outcome, notes: notes.trim() ? notes.trim() : null },
            });
          }}
        />
      </View>
    </Card>
  );
}

export default function PrivilegedSessionDetailScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const { user, isLoading: authLoading } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);

  // Same route-level gate as the list screen: verify the role server-side
  // before rendering anything; the API is the real boundary.
  const me = useGetUser(user?.id ?? 0, {
    query: { enabled: !!user?.id },
  } as any);
  const canView = canViewPrivilegedSessions(me.data?.roleNameEn);
  const canDecide = canDecidePrivilegedSessions(me.data?.roleNameEn);

  // The list endpoint returns full session records; the detail screen reads
  // its session from the shared cache-backed query (no per-id endpoint).
  const sessions = useListPrivilegedSessions(undefined, {
    query: { enabled: canView },
  } as any);
  const session = (sessions.data ?? []).find((s) => s.id === sessionId) ?? null;

  if (!authLoading && !user) return <Redirect href="/login" />;
  if (me.isError || (me.isSuccess && !canView)) {
    return <Redirect href="/(tabs)" />;
  }

  const loading =
    authLoading || me.isLoading || sessions.isLoading || !Number.isFinite(sessionId);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('sessionActivity')}
        subtitle={session ? `${session.userName ?? `#${session.userId}`} · ${t('grant')} #${session.breakGlassAccessId}` : undefined}
        right={<LangToggle />}
      />
      {loading ? (
        <LoadingView />
      ) : !session ? (
        <View style={{ padding: 20 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 14,
              fontFamily: 'Inter_400Regular',
            }}
          >
            {t('sessionNotFound')}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
          }}
        >
          <Card>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}>
                  {t('started')}
                </Text>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                  {fmtDate(session.startedAt)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}>
                  {session.endedAt ? t('ended') : t('openUntil')}
                </Text>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                  {session.endedAt
                    ? `${fmtDate(session.endedAt)}${session.endReason ? ` (${session.endReason})` : ''}`
                    : fmtDate(session.scheduledEndAt)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}>
                  {t('reviewOutcome')}
                </Text>
                <Badge
                  label={t(outcomeStringKey(session.reviewOutcome))}
                  color={
                    session.reviewOutcome === 'justified'
                      ? colors.success
                      : session.reviewOutcome === 'unjustified'
                        ? colors.destructive
                        : session.reviewOutcome === 'under_investigation'
                          ? colors.warning
                          : colors.mutedForeground
                  }
                />
              </View>
            </View>
          </Card>

          <Text
            style={{
              color: colors.foreground,
              fontSize: 14,
              fontFamily: 'Inter_600SemiBold',
              marginTop: 20,
            }}
          >
            {t('sessionActivity')}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              fontFamily: 'Inter_400Regular',
              marginTop: 4,
              marginBottom: 10,
            }}
          >
            {t('sessionActivityHint')}
          </Text>
          <SessionActivityList sessionId={sessionId} />

          {/* Only deciders (Security Officer / Super Administrator) may submit
              an outcome; auditors get a read-only view. Server enforces too. */}
          {!session.reviewedAt && canDecide && <ReviewForm sessionId={sessionId} />}
        </ScrollView>
      )}
    </View>
  );
}
