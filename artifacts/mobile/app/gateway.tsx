import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  Text,
  View,
} from 'react-native';
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
import { useAuth } from '@/lib/auth';
import {
  useGetGatewayReconcileStatus,
  useListGatewayRegistrations,
  useReconcileGatewayRegistration,
  useGetUser,
} from '@workspace/api-client-react';
import type {
  DeviceCommand,
  GatewayRegistration,
  GetGatewayReconcileStatus200Item,
  GatewayRegistrationReconcileCommandStatus,
} from '@workspace/api-client-react';

// Poll fast while a reconcile command is in-flight; quiet otherwise.
const POLL_FAST_MS = 5_000;
const POLL_IDLE_MS = 60_000;

function isReconcilePending(reg: GatewayRegistration): boolean {
  const s = reg.reconcileCommand?.status;
  return s === 'PENDING' || s === 'DELIVERED';
}

/** Map command status to a display label key. */
function commandStatusKey(
  status: GatewayRegistrationReconcileCommandStatus,
): keyof ReturnType<ReturnType<typeof useI18n>['t'] extends (k: infer K) => string ? never : never> {
  // We'll return the raw string directly instead of an i18n key to keep this simple.
  return status as never;
}

function ReconcileCommandBadge({
  status,
  resultMessage,
}: {
  status: GatewayRegistrationReconcileCommandStatus;
  resultMessage: string | null;
}) {
  const colors = useColors();
  const { t } = useI18n();

  const { label, color } = ((): { label: string; color: string } => {
    switch (status) {
      case 'PENDING':
        return { label: t('reconcileQueued'), color: colors.primary };
      case 'DELIVERED':
        return { label: t('reconcileDelivered'), color: colors.warning };
      case 'ACKNOWLEDGED':
        return { label: t('reconcileAcknowledged'), color: colors.success };
      case 'FAILED':
        return { label: resultMessage ?? t('reconcileFailed'), color: colors.destructive };
      case 'EXPIRED':
        return { label: t('reconcileExpired'), color: colors.mutedForeground };
      default:
        return { label: status, color: colors.mutedForeground };
    }
  })();

  return <Badge label={label} color={color} />;
}

function VerdictSection({
  status,
  isAdmin,
  onReconcile,
  reconciling,
}: {
  status: GetGatewayReconcileStatus200Item | undefined;
  isAdmin: boolean;
  onReconcile: () => void;
  reconciling: boolean;
}) {
  const colors = useColors();
  const { t } = useI18n();

  const hasIssues =
    status && (status.missing.length > 0 || status.mismatched.length > 0);

  return (
    <View style={{ marginTop: 10 }}>
      {status?.reconciledAt ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            fontFamily: 'Inter_400Regular',
          }}
        >
          {t('reconciledAt')}: {new Date(status.reconciledAt).toLocaleString()}
        </Text>
      ) : (
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            fontFamily: 'Inter_400Regular',
          }}
        >
          {t('neverReconciled')}
        </Text>
      )}

      {hasIssues ? (
        <View style={{ marginTop: 6, gap: 4 }}>
          {status!.missing.length > 0 && (
            <Text
              style={{
                color: colors.destructive,
                fontSize: 12,
                fontFamily: 'Inter_500Medium',
              }}
            >
              {t('missingBatches')}: {status!.missing.length}
            </Text>
          )}
          {status!.mismatched.length > 0 && (
            <Text
              style={{
                color: colors.warning,
                fontSize: 12,
                fontFamily: 'Inter_500Medium',
              }}
            >
              {t('mismatchedBatches')}: {status!.mismatched.length}
            </Text>
          )}
        </View>
      ) : status ? (
        <Text
          style={{
            color: colors.success,
            fontSize: 12,
            fontFamily: 'Inter_500Medium',
            marginTop: 4,
          }}
        >
          {t('batchesClean')}
        </Text>
      ) : null}

      {isAdmin && (
        <View style={{ marginTop: 10 }}>
          <AppButton
            label={reconciling ? t('reconciling') : t('reconcileNow')}
            onPress={onReconcile}
            variant="outline"
            loading={reconciling}
            icon="refresh-cw"
            small
          />
        </View>
      )}
    </View>
  );
}

function GatewayCard({
  item,
  reconcileStatus,
  isAdmin,
  onReconcile,
  reconcilingId,
}: {
  item: GatewayRegistration;
  reconcileStatus: GetGatewayReconcileStatus200Item | undefined;
  isAdmin: boolean;
  onReconcile: (id: number) => void;
  reconcilingId: number | null;
}) {
  const colors = useColors();
  const { lang, t } = useI18n();

  const name = (lang === 'ar' && item.nameAr) ? item.nameAr : item.name ?? '—';
  const reconciling = reconcilingId === item.id;

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
            {name}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              fontFamily: 'Inter_400Regular',
              marginTop: 2,
            }}
          >
            {item.adapterType ?? '—'}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {/* Gateway active/inactive status */}
          <Badge
            label={item.status === 'ACTIVE' ? t('gatewayActive') : t('gatewayInactive')}
            color={item.status === 'ACTIVE' ? colors.success : colors.mutedForeground}
          />
          {/* Latest reconcile command status if any */}
          {item.reconcileCommand && (
            <ReconcileCommandBadge
              status={item.reconcileCommand.status}
              resultMessage={item.reconcileCommand.resultMessage}
            />
          )}
        </View>
      </View>

      <VerdictSection
        status={reconcileStatus}
        isAdmin={isAdmin}
        onReconcile={() => item.id != null && onReconcile(item.id)}
        reconciling={reconciling}
      />
    </Card>
  );
}

export default function GatewayScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const { user } = useAuth();

  // Optimistic in-flight state so we switch to fast polling immediately
  // after triggering a reconcile, before the next registration fetch reflects it.
  const [reconcilingId, setReconcilingId] = useState<number | null>(null);

  // Role check: same pattern as admin-users screen.
  const me = useGetUser(user?.id ?? 0, {
    query: { enabled: !!user?.id },
  } as any);
  const isAdmin = me.data?.roleNameEn === 'Super Administrator';

  const anyInFlight = (regs: GatewayRegistration[]) =>
    reconcilingId !== null || regs.some(isReconcilePending);

  // Drive polling interval from state so the closure captures current values
  // without needing typed query introspection (avoids implicit-any TS errors).
  const [inFlight, setInFlight] = useState(false);
  const pollInterval = inFlight || reconcilingId !== null ? POLL_FAST_MS : POLL_IDLE_MS;

  const registrations = useListGatewayRegistrations({
    query: { refetchInterval: pollInterval },
  } as any);

  // Mirror inFlight whenever the registrations data changes.
  const anyPending = (registrations.data ?? []).some(isReconcilePending);
  if (anyPending !== inFlight) setInFlight(anyPending);

  const reconcileStatus = useGetGatewayReconcileStatus({
    query: {
      refetchInterval: inFlight || reconcilingId !== null ? POLL_FAST_MS : (false as const),
    },
  } as any);

  const reconcileMutation = useReconcileGatewayRegistration({
    mutation: {
      onSuccess: (_data: DeviceCommand, vars: { id: number }) => {
        // Keep spinner visible until the next registrations poll clears PENDING.
        void vars;
        registrations.refetch();
        reconcileStatus.refetch();
        setReconcilingId(null);
      },
      onError: () => {
        setReconcilingId(null);
        Alert.alert(t('reconcileNow'), t('reconcileNowFailed'));
      },
    },
  } as any);

  const handleReconcile = (id: number) => {
    setReconcilingId(id);
    reconcileMutation.mutate({ id });
  };

  // Build a lookup from registrationId → reconcile status row.
  const statusByRegId = new Map<number, GetGatewayReconcileStatus200Item>();
  for (const s of reconcileStatus.data ?? []) {
    if (s.registrationId != null) statusByRegId.set(s.registrationId, s);
  }

  const items = registrations.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('gatewayMonitoring')}
        subtitle={t('updatedLive')}
        right={<LangToggle />}
      />
      {registrations.isLoading ? (
        <LoadingView />
      ) : registrations.isError ? (
        <ErrorView onRetry={() => registrations.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => String(r.id)}
          scrollEnabled={items.length > 0}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                registrations.refetch();
                reconcileStatus.refetch();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="radio" message={t('noGateways')} />
          }
          renderItem={({ item }) => (
            <GatewayCard
              item={item}
              reconcileStatus={item.id != null ? statusByRegId.get(item.id) : undefined}
              isAdmin={isAdmin}
              onReconcile={handleReconcile}
              reconcilingId={reconcilingId}
            />
          )}
        />
      )}
    </View>
  );
}
