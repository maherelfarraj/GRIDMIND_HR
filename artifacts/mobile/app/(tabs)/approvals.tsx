import React, { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  AppButton,
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
import {
  getListApprovalsQueryKey,
  useDecideApproval,
  useListApprovals,
} from '@workspace/api-client-react';
import type { Approval } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

const POLL_MS = 30000;

function ApprovalCard({
  approval,
  onDecide,
  deciding,
}: {
  approval: Approval;
  onDecide: (id: number, status: 'approved' | 'rejected') => void;
  deciding: boolean;
}) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const title =
    lang === 'ar' && approval.titleAr ? approval.titleAr : approval.titleEn;
  const priorityColor =
    approval.priority === 'high' || approval.priority === 'urgent'
      ? colors.destructive
      : approval.priority === 'medium'
        ? colors.warning
        : colors.mutedForeground;

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
        <Badge label={approval.priority} color={priorityColor} />
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 13,
          fontFamily: 'Inter_400Regular',
          marginTop: 6,
        }}
      >
        {t('requestedBy')}: {approval.requestedByEmployeeNameEn}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          fontFamily: 'Inter_400Regular',
          marginTop: 2,
        }}
      >
        {approval.type} · {new Date(approval.createdAt).toLocaleDateString()}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <AppButton
            testID={`button-approve-${approval.id}`}
            label={t('approve')}
            icon="check"
            small
            loading={deciding}
            onPress={() => onDecide(approval.id, 'approved')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton
            testID={`button-reject-${approval.id}`}
            label={t('reject')}
            icon="x"
            small
            variant="destructive"
            loading={deciding}
            onPress={() => onDecide(approval.id, 'rejected')}
          />
        </View>
      </View>
    </Card>
  );
}

export default function ApprovalsScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [decidingId, setDecidingId] = useState<number | null>(null);

  const approvals = useListApprovals(
    { status: 'pending' },
    { query: { refetchInterval: POLL_MS } } as any,
  );

  const decide = useDecideApproval();

  const handleDecide = (id: number, status: 'approved' | 'rejected') => {
    setDecidingId(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    decide.mutate(
      { id, data: { status, decisionNote: null } },
      {
        onSettled: () => {
          setDecidingId(null);
          queryClient.invalidateQueries({
            queryKey: getListApprovalsQueryKey({ status: 'pending' }),
          });
        },
      },
    );
  };

  const pending = approvals.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('approvals')}
        subtitle={`${t('pendingQueue')} · ${t('updatedLive')}`}
        right={<LangToggle />}
      />
      {approvals.isLoading ? (
        <LoadingView />
      ) : approvals.isError ? (
        <ErrorView onRetry={() => approvals.refetch()} />
      ) : (
        <FlatList
          data={pending}
          keyExtractor={(a) => String(a.id)}
          scrollEnabled={pending.length > 0}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 118,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => approvals.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="check-circle" message={t('noPending')} />
          }
          renderItem={({ item }) => (
            <ApprovalCard
              approval={item}
              onDecide={handleDecide}
              deciding={decidingId === item.id}
            />
          )}
        />
      )}
    </View>
  );
}
