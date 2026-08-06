import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
  SectionTitle,
} from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { canViewPrivilegedSessions } from '@/lib/privileged-session-review';
import {
  useGetUser,
  useListLeaveBalances,
  useListLeaveRequests,
  useListPayrollPeriods,
  useListPayrollRuns,
  useListPublicHolidays,
} from '@workspace/api-client-react';
import type {
  LeaveBalance,
  LeaveRequestSummary,
  PayrollRunSummary,
  PublicHoliday,
} from '@workspace/api-client-react';
import { NotificationBell } from '@/components/NotificationBell';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const CURRENT_YEAR = 2026;
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function statusColor(
  status: string,
  colors: ReturnType<typeof useColors>,
): string {
  switch (status) {
    case 'approved':
      return colors.success;
    case 'rejected':
    case 'revoked':
    case 'cancelled':
      return colors.destructive;
    case 'pending':
      return colors.warning;
    default:
      return colors.mutedForeground;
  }
}

function BalanceCard({ balance }: { balance: LeaveBalance }) {
  const colors = useColors();
  const { lang, t } = useI18n();
  const name =
    lang === 'ar' && balance.leaveTypeNameAr
      ? balance.leaveTypeNameAr
      : (balance.leaveTypeNameEn ?? '');
  const available =
    balance.available ??
    String(
      Number(balance.openingBalance) +
        Number(balance.accrued) +
        Number(balance.carriedOver) +
        Number(balance.adjustment) -
        Number(balance.used) -
        Number(balance.pending),
    );
  const tint = balance.leaveTypeColor || colors.primary;
  return (
    <Card
      style={{
        width: 160,
        marginEnd: 12,
        borderTopWidth: 3,
        borderTopColor: tint,
      }}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          fontFamily: 'Inter_500Medium',
        }}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 28,
          fontFamily: 'Inter_700Bold',
          marginTop: 6,
        }}
      >
        {Number(available).toLocaleString()}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 11,
          fontFamily: 'Inter_400Regular',
        }}
      >
        {t('days')} {t('available')}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 11,
          fontFamily: 'Inter_400Regular',
          marginTop: 4,
        }}
      >
        {Number(balance.used).toLocaleString()} {t('used')}
      </Text>
    </Card>
  );
}

function HolidayRow({ holiday }: { holiday: PublicHoliday }) {
  const colors = useColors();
  const { lang, t } = useI18n();
  const name =
    lang === 'ar' && holiday.nameAr ? holiday.nameAr : holiday.nameEn;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, marginEnd: 12 }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: 14,
            fontFamily: 'Inter_500Medium',
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {holiday.isRecurring && (
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 11,
              fontFamily: 'Inter_400Regular',
              marginTop: 2,
            }}
          >
            {t('recurringHolidayNote')}
          </Text>
        )}
      </View>
      <Text
        style={{
          color: colors.primary,
          fontSize: 13,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {holiday.date}
      </Text>
    </View>
  );
}

function EmployeeContent({ employeeId }: { employeeId: number }) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const router = useRouter();

  const balances = useListLeaveBalances({
    employeeId,
    year: CURRENT_YEAR,
  });
  const requests = useListLeaveRequests({ employeeId });
  const runs = useListPayrollRuns({ employeeId });
  const periods = useListPayrollPeriods();
  const holidaysQuery = useListPublicHolidays({
    year: CURRENT_YEAR,
    scope: 'mine',
  });

  const isLoading =
    balances.isLoading || requests.isLoading || runs.isLoading;
  const isError = balances.isError && requests.isError;

  const refetchAll = () => {
    balances.refetch();
    requests.refetch();
    runs.refetch();
    periods.refetch();
    holidaysQuery.refetch();
  };

  // Upcoming holidays: today or later, sorted by date, capped at 5
  const upcomingHolidays = (holidaysQuery.data ?? [])
    .filter((h) => h.date >= TODAY)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorView onRetry={refetchAll} />;

  const periodName = (periodId: number): string => {
    const p = (periods.data ?? []).find((x) => x.id === periodId);
    if (!p) return `#${periodId}`;
    return lang === 'ar' && p.nameAr ? p.nameAr : (p.nameEn ?? `#${periodId}`);
  };

  const recentRequests = (requests.data ?? []).slice(0, 6);
  const payslips = (runs.data ?? []).filter(
    (r) => r.status !== 'draft',
  );

  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: Platform.OS === 'web' ? 118 : 100,
        paddingHorizontal: 20,
      }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refetchAll}
          tintColor={colors.primary}
        />
      }
    >
      <SectionTitle>{t('leaveBalances')}</SectionTitle>
      {(balances.data ?? []).length === 0 ? (
        <EmptyState icon="calendar" message={t('noBalances')} />
      ) : (
        <FlatList
          horizontal
          data={balances.data ?? []}
          keyExtractor={(b) => String(b.id)}
          renderItem={({ item }) => <BalanceCard balance={item} />}
          showsHorizontalScrollIndicator={false}
          scrollEnabled={(balances.data ?? []).length > 0}
        />
      )}

      <View style={{ marginTop: 20 }}>
        <AppButton
          testID="button-new-leave"
          label={t('requestLeave')}
          icon="plus-circle"
          onPress={() => router.push('/new-leave')}
        />
      </View>

      <SectionTitle>{t('upcomingHolidays')}</SectionTitle>
      {upcomingHolidays.length === 0 ? (
        <EmptyState icon="sun" message={t('noUpcomingHolidays')} />
      ) : (
        <Card style={{ paddingVertical: 0 }}>
          {upcomingHolidays.map((h, idx) => (
            <View
              key={h.id}
              style={
                idx === upcomingHolidays.length - 1
                  ? { overflow: 'hidden', borderRadius: 12 }
                  : undefined
              }
            >
              <HolidayRow holiday={h} />
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>{t('myLeaveRequests')}</SectionTitle>
      {recentRequests.length === 0 ? (
        <EmptyState icon="inbox" message={t('noRequests')} />
      ) : (
        recentRequests.map((req: LeaveRequestSummary) => (
          <Card key={req.id} style={{ marginBottom: 10 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 15,
                  fontFamily: 'Inter_600SemiBold',
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {lang === 'ar' && req.leaveTypeNameAr
                  ? req.leaveTypeNameAr
                  : req.leaveTypeNameEn}
              </Text>
              <Badge
                label={req.status}
                color={statusColor(req.status, colors)}
              />
            </View>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
                marginTop: 6,
              }}
            >
              {req.startDate} → {req.endDate} · {Number(req.totalDays)}{' '}
              {t('days')}
            </Text>
          </Card>
        ))
      )}

      <SectionTitle>{t('payslips')}</SectionTitle>
      {payslips.length === 0 ? (
        <EmptyState icon="file-text" message={t('noPayslips')} />
      ) : (
        payslips.map((run: PayrollRunSummary) => (
          <Card key={run.id} style={{ marginBottom: 10 }}>
            <Pressable
              testID={`row-payslip-${run.id}`}
              onPress={() =>
                router.push({
                  pathname: '/payslip/[id]',
                  params: { id: String(run.id) },
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              accessibilityRole="button"
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 15,
                      fontFamily: 'Inter_600SemiBold',
                    }}
                    numberOfLines={1}
                  >
                    {periodName(run.payrollPeriodId)}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      fontFamily: 'Inter_400Regular',
                      marginTop: 4,
                    }}
                  >
                    {t('gross')} {Number(run.grossSalary).toLocaleString()} ·{' '}
                    {t('deductions')}{' '}
                    {Number(run.totalDeductions).toLocaleString()}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 17,
                      fontFamily: 'Inter_700Bold',
                    }}
                  >
                    {Number(run.netSalary).toLocaleString()}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 11,
                      fontFamily: 'Inter_400Regular',
                    }}
                  >
                    {t('net')} · {run.currency}
                  </Text>
                </View>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={colors.mutedForeground}
                  style={{ marginStart: 8 }}
                />
              </View>
            </Pressable>

            {/* Department OT breakdown link — lets admins drill into period-level OT spend */}
            <Pressable
              testID={`row-payslip-dept-ot-${run.id}`}
              onPress={() =>
                router.push({
                  pathname: '/payroll-period-ot/[id]' as any,
                  params: { id: String(run.payrollPeriodId) },
                })
              }
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                marginTop: 10,
                paddingTop: 8,
                borderTopWidth: 0.5,
                borderTopColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
              })}
              accessibilityRole="button"
              accessibilityLabel={t('deptOtBreakdown')}
            >
              <Feather name="bar-chart-2" size={13} color={colors.primary} />
              <Text
                style={{
                  color: colors.primary,
                  fontSize: 12,
                  fontFamily: 'Inter_500Medium',
                  marginStart: 5,
                  flex: 1,
                }}
              >
                {t('deptOtBreakdown')}
              </Text>
              <Feather name="chevron-right" size={13} color={colors.primary} />
            </Pressable>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

// Header entry to the admin user-management screen. Rendered only when the
// signed-in account holds the Super Administrator role (the server-side gate
// for issuing one-time passwords); everyone else never sees the entry.
function AdminUsersButton() {
  const colors = useColors();
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  // AuthUser carries only roleId — fetch the full record for the role name.
  const me = useGetUser(user?.id ?? 0, {
    query: { enabled: !!user?.id },
  } as any);
  if (me.data?.roleNameEn !== 'Super Administrator') return null;

  return (
    <Pressable
      testID="button-admin-users"
      onPress={() => router.push('/admin-users' as any)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
      accessibilityLabel={t('userAdmin')}
    >
      <Feather name="users" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

// Header entry to the privileged-session review screen. Rendered only for
// roles the server allows to view privileged sessions (Security Officer,
// Super Administrator, Read-Only Auditor); everyone else never sees it.
function SessionReviewButton() {
  const colors = useColors();
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const me = useGetUser(user?.id ?? 0, {
    query: { enabled: !!user?.id },
  } as any);
  if (!canViewPrivilegedSessions(me.data?.roleNameEn)) return null;

  return (
    <Pressable
      testID="button-session-review"
      onPress={() => router.push('/privileged-sessions' as any)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
      accessibilityLabel={t('sessionReview')}
    >
      <Feather name="shield" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { user, logout } = useAuth();
  const router = useRouter();

  const displayName = user
    ? lang === 'ar' && user.fullNameAr
      ? user.fullNameAr
      : user.fullNameEn
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('home')}
        subtitle={displayName}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <NotificationBell />
            <AdminUsersButton />
            <SessionReviewButton />
            <Pressable
              testID="button-change-password"
              onPress={() => router.push('/change-password')}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                padding: 8,
              })}
              accessibilityLabel={t('changePassword')}
            >
              <Feather name="lock" size={20} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              testID="button-signout"
              onPress={logout}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                padding: 8,
              })}
              accessibilityLabel={t('signOut')}
            >
              <Feather name="log-out" size={20} color={colors.mutedForeground} />
            </Pressable>
            <LangToggle />
          </View>
        }
      />
      {user?.employeeId ? (
        <EmployeeContent employeeId={user.employeeId} />
      ) : (
        <EmptyState icon="user-x" message={t('noEmployee')} />
      )}
    </View>
  );
}
