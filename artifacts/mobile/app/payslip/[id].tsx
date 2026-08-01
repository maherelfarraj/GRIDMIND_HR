import React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ErrorView, LoadingView, SectionTitle } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';
import { useGetPayslip } from '@workspace/api-client-react';
import type { PayrollRunLine } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

function formatAmount(value: string | number): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function LineRow({
  line,
  negative,
}: {
  line: PayrollRunLine;
  negative?: boolean;
}) {
  const colors = useColors();
  const { lang } = useI18n();
  const name = lang === 'ar' && line.nameAr ? line.nameAr : line.nameEn;
  return (
    <View
      testID={`row-payslip-line-${line.id}`}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text
        style={{
          color: colors.foreground,
          fontSize: 14,
          fontFamily: 'Inter_400Regular',
          flex: 1,
        }}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text
        style={{
          color: negative ? colors.destructive : colors.foreground,
          fontSize: 14,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {negative ? '-' : ''}
        {formatAmount(line.amount)}
      </Text>
    </View>
  );
}

function SummaryRow({
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
        paddingVertical: 6,
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
          color: color ?? colors.foreground,
          fontSize: bold ? 16 : 13,
          fontFamily: bold ? 'Inter_700Bold' : 'Inter_500Medium',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function PayslipDetailScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const runId = Number(params.id);

  const payslip = useGetPayslip(runId);

  const topInset =
    Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top + 8;

  const data = payslip.data;
  const periodName = data
    ? lang === 'ar' && data.period.nameAr
      ? data.period.nameAr
      : data.period.nameEn
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: topInset,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            color: colors.foreground,
            fontSize: 20,
            fontFamily: 'Inter_700Bold',
            flex: 1,
          }}
          numberOfLines={1}
        >
          {t('payslipDetail')}
          {periodName ? ` · ${periodName}` : ''}
        </Text>
        <Pressable
          testID="button-close-payslip"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
          accessibilityLabel={t('cancel')}
        >
          <Feather name="x" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {payslip.isLoading ? (
        <LoadingView />
      ) : payslip.isError || !data ? (
        <ErrorView onRetry={() => payslip.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40 + insets.bottom,
          }}
        >
          {/* Net pay hero */}
          <Card
            style={{
              alignItems: 'center',
              paddingVertical: 20,
              borderTopWidth: 3,
              borderTopColor: colors.primary,
            }}
          >
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_500Medium',
              }}
            >
              {t('netPay')} · {data.summary.currency}
            </Text>
            <Text
              testID="text-net-pay"
              style={{
                color: colors.primary,
                fontSize: 32,
                fontFamily: 'Inter_700Bold',
                marginTop: 4,
              }}
            >
              {formatAmount(data.summary.netSalary)}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginTop: 6,
              }}
            >
              {data.period.startDate} → {data.period.endDate}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: 'Inter_400Regular',
                marginTop: 2,
              }}
            >
              {t('payDate')}: {data.period.payDate}
            </Text>
          </Card>

          {data.hasException && data.exceptionNote ? (
            <Card
              style={{
                marginTop: 12,
                borderStartWidth: 3,
                borderStartColor: colors.warning,
              }}
            >
              <Text
                style={{
                  color: colors.warning,
                  fontSize: 12,
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {t('exceptionNote')}
              </Text>
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                  fontFamily: 'Inter_400Regular',
                  marginTop: 4,
                }}
              >
                {data.exceptionNote}
              </Text>
            </Card>
          ) : null}

          <SectionTitle>{t('earnings')}</SectionTitle>
          <Card>
            <SummaryRow
              label={t('baseSalary')}
              value={formatAmount(data.summary.baseSalary)}
            />
            {data.earnings.length === 0 ? null : (
              <View style={{ marginTop: 4 }}>
                {data.earnings.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </View>
            )}
            {Number(data.summary.overtimePay) > 0 ? (
              <SummaryRow
                label={`${t('overtime')} (${Number(
                  data.summary.overtimeHours,
                ).toLocaleString()} ${t('hours')})`}
                value={formatAmount(data.summary.overtimePay)}
              />
            ) : null}
            <SummaryRow
              label={t('gross')}
              value={formatAmount(data.summary.grossSalary)}
              bold
            />
          </Card>

          <SectionTitle>{t('deductions')}</SectionTitle>
          <Card>
            {data.deductions.length === 0 ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  fontFamily: 'Inter_400Regular',
                }}
              >
                {t('noLines')}
              </Text>
            ) : (
              data.deductions.map((line) => (
                <LineRow key={line.id} line={line} negative />
              ))
            )}
            <SummaryRow
              label={t('deductions')}
              value={`-${formatAmount(data.summary.totalDeductions)}`}
              bold
              color={colors.destructive}
            />
          </Card>

          <Card style={{ marginTop: 16 }}>
            <SummaryRow
              label={t('workingDays')}
              value={String(data.summary.workingDays)}
            />
            <SummaryRow
              label={t('presentDays')}
              value={String(data.summary.presentDays)}
            />
            <SummaryRow
              label={t('netPay')}
              value={`${formatAmount(data.summary.netSalary)} ${
                data.summary.currency
              }`}
              bold
              color={colors.primary}
            />
          </Card>
        </ScrollView>
      )}
    </View>
  );
}
