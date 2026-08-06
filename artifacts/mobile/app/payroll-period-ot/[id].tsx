import React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Card,
  EmptyState,
  ErrorView,
  LangToggle,
  LoadingView,
  SectionTitle,
} from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';
import {
  useGetPayrollPeriodOtSummary,
  useGetPayrollPeriod,
} from '@workspace/api-client-react';
import type { PayrollPeriodOtDepartment } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

function formatAmount(val: string): string {
  const n = Number(val);
  if (!isFinite(n)) return val;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Single row in the totals card
function TotalRow({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.border,
      }}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 13,
          fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_400Regular',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: color ?? (bold ? colors.foreground : colors.foreground),
          fontSize: 13,
          fontFamily: bold ? 'Inter_700Bold' : 'Inter_500Medium',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

// Card showing one department's OT breakdown
function DeptCard({ dept, lang }: { dept: PayrollPeriodOtDepartment; lang: string }) {
  const colors = useColors();
  const { t } = useI18n();

  const deptName =
    lang === 'ar' && dept.departmentNameAr
      ? dept.departmentNameAr
      : dept.departmentNameEn;

  const hasWeekend = Number(dept.weekend) > 0;
  const hasHoliday = Number(dept.holiday) > 0;

  return (
    <Card style={{ marginBottom: 10 }}>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 14,
          fontFamily: 'Inter_600SemiBold',
          marginBottom: 6,
        }}
        numberOfLines={1}
      >
        {deptName}
      </Text>

      {/* Always show weekday */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
          {t('weekdayOt')}
        </Text>
        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
          {formatAmount(dept.weekday)}
        </Text>
      </View>

      {/* Show weekend/holiday only when non-zero (premium buckets) */}
      {hasWeekend && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
            {t('weekendOt')}
          </Text>
          <Text style={{ color: colors.warning, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
            {formatAmount(dept.weekend)}
          </Text>
        </View>
      )}

      {hasHoliday && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
            {t('holidayOt')}
          </Text>
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
            {formatAmount(dept.holiday)}
          </Text>
        </View>
      )}

      {/* Total */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingVertical: 3,
          marginTop: 2,
          borderTopWidth: 0.5,
          borderTopColor: colors.border,
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
          {t('totalOt')}
        </Text>
        <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_700Bold' }}>
          {formatAmount(dept.total)}
        </Text>
      </View>
    </Card>
  );
}

export default function PayrollPeriodOtScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const periodId = Number(params.id);

  const period = useGetPayrollPeriod(periodId);
  const otSummary = useGetPayrollPeriodOtSummary(periodId);

  const isLoading = period.isLoading || otSummary.isLoading;
  const isError = period.isError || otSummary.isError;

  const periodName = period.data
    ? lang === 'ar' && period.data.nameAr
      ? period.data.nameAr
      : period.data.nameEn
    : `#${periodId}`;

  const summary = otSummary.data;
  const depts = summary?.byDepartment ?? [];
  const hasAnyOt = summary && Number(summary.total) > 0;

  const topInset =
    Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top + 8;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Custom header with back button */}
      <View
        style={{
          paddingTop: topInset,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          testID="button-back"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8, marginEnd: 4 })}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 18,
              fontFamily: 'Inter_700Bold',
            }}
            numberOfLines={1}
          >
            {t('deptOtTitle')}
          </Text>
          {!period.isLoading && (
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
              }}
              numberOfLines={1}
            >
              {periodName}
            </Text>
          )}
        </View>
        <LangToggle />
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError ? (
        <ErrorView
          onRetry={() => {
            period.refetch();
            otSummary.refetch();
          }}
        />
      ) : !summary ? (
        <EmptyState icon="bar-chart-2" message={t('noDeptOtData')} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        >
          {/* Period-level totals */}
          <SectionTitle>{t('periodTotals')}</SectionTitle>
          <Card>
            <TotalRow label={t('weekdayOt')} value={formatAmount(summary.weekday)} />
            <TotalRow label={t('weekendOt')} value={formatAmount(summary.weekend)} color={Number(summary.weekend) > 0 ? colors.warning : undefined} />
            <TotalRow label={t('holidayOt')} value={formatAmount(summary.holiday)} color={Number(summary.holiday) > 0 ? colors.destructive : undefined} />
            <TotalRow label={t('totalOt')} value={formatAmount(summary.total)} bold color={colors.primary} />
          </Card>

          {/* Per-department breakdown */}
          <SectionTitle>{t('byDepartment')}</SectionTitle>
          {!hasAnyOt || depts.length === 0 ? (
            <EmptyState icon="bar-chart-2" message={t('noDeptOtData')} />
          ) : (
            depts.map((dept) => (
              <DeptCard
                key={dept.departmentId ?? dept.departmentNameEn}
                dept={dept}
                lang={lang}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
