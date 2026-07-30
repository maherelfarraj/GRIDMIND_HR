import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppButton, LoadingView } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  getListLeaveBalancesQueryKey,
  getListLeaveRequestsQueryKey,
  useCreateLeaveRequest,
  useListLeaveTypes,
  useSubmitLeaveRequest,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetweenInclusive(start: string, end: string): number | null {
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return null;
  const s = new Date(start + 'T00:00:00Z').getTime();
  const e = new Date(end + 'T00:00:00Z').getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}

export default function NewLeaveScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const leaveTypes = useListLeaveTypes();
  const createRequest = useCreateLeaveRequest();
  const submitRequest = useSubmitLeaveRequest();

  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalDays = useMemo(
    () => daysBetweenInclusive(startDate.trim(), endDate.trim()),
    [startDate, endDate],
  );

  const activeTypes = (leaveTypes.data ?? []).filter((lt) => lt.isActive);

  const handleSubmit = async () => {
    setError(null);
    if (!user?.employeeId) return;
    if (!leaveTypeId) {
      setError(t('selectLeaveType'));
      return;
    }
    if (totalDays == null) {
      setError(t('invalidDates'));
      return;
    }
    setSaving(true);
    try {
      const created = await createRequest.mutateAsync({
        data: {
          employeeId: user.employeeId,
          leaveTypeId,
          startDate: startDate.trim(),
          endDate: endDate.trim(),
          totalDays,
          reasonEn: reason.trim() || null,
        },
      });
      await submitRequest.mutateAsync({ id: created.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({
        queryKey: getListLeaveRequestsQueryKey({
          employeeId: user.employeeId,
        }),
      });
      queryClient.invalidateQueries({
        queryKey: getListLeaveBalancesQueryKey({
          employeeId: user.employeeId,
          year: 2026,
        }),
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const topInset =
    Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top + 8;

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
          }}
        >
          {t('newLeaveRequest')}
        </Text>
        <Pressable
          testID="button-close-new-leave"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
          accessibilityLabel={t('cancel')}
        >
          <Feather name="x" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {leaveTypes.isLoading ? (
        <LoadingView />
      ) : (
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 34) + 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {t('leaveType')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {activeTypes.map((lt) => {
              const selected = lt.id === leaveTypeId;
              const name = lang === 'ar' && lt.nameAr ? lt.nameAr : lt.nameEn;
              return (
                <Pressable
                  key={lt.id}
                  testID={`chip-leave-type-${lt.id}`}
                  onPress={() => setLeaveTypeId(lt.id)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                    borderWidth: 1,
                    borderRadius: 999,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                  })}
                >
                  <Text
                    style={{
                      color: selected
                        ? colors.primaryForeground
                        : colors.foreground,
                      fontSize: 13,
                      fontFamily: 'Inter_500Medium',
                    }}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {t('startDate')}
          </Text>
          <TextInput
            testID="input-start-date"
            value={startDate}
            onChangeText={setStartDate}
            placeholder="2026-08-10"
            placeholderTextColor={colors.mutedForeground + '88'}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {t('endDate')}
          </Text>
          <TextInput
            testID="input-end-date"
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2026-08-14"
            placeholderTextColor={colors.mutedForeground + '88'}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
          />

          {totalDays != null ? (
            <Text
              style={{
                color: colors.primary,
                fontSize: 14,
                fontFamily: 'Inter_600SemiBold',
                marginBottom: 12,
              }}
            >
              {t('totalDays')}: {totalDays} {t('days')}
            </Text>
          ) : null}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {t('reason')}
          </Text>
          <TextInput
            testID="input-reason"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
                minHeight: 80,
                textAlignVertical: 'top',
              },
            ]}
          />

          {error ? (
            <Text
              style={{
                color: colors.destructive,
                fontSize: 13,
                fontFamily: 'Inter_500Medium',
                marginBottom: 12,
              }}
            >
              {error}
            </Text>
          ) : null}

          <AppButton
            testID="button-submit-leave"
            label={saving ? t('submitting') : t('submit')}
            icon="send"
            onPress={handleSubmit}
            loading={saving}
            disabled={!leaveTypeId || totalDays == null}
          />
        </KeyboardAwareScrollViewCompat>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
    marginTop: 18,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    marginBottom: 4,
  },
});
