import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DateRangeCalendarModal } from '@/components/DateRangeCalendar';
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
  const { user, isLoading: authIsLoading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // Do not fire the query while the auth bootstrap is still resolving — if
  // currentToken is null the request goes out without an Authorization header
  // and the server returns 401, which the 401 handler silently drops (because
  // sessionLiveRef is false during bootstrap). Gate on authIsLoading so the
  // query only starts once the token is in place.
  const leaveTypes = useListLeaveTypes({ query: { enabled: !authIsLoading } });
  const createRequest = useCreateLeaveRequest();
  const submitRequest = useSubmitLeaveRequest();

  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const formatDate = (iso: string) => {
    if (!DATE_RE.test(iso)) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(
      lang === 'ar' ? 'ar' : 'en',
      { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' },
    );
  };

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
          {leaveTypes.isError ? (
            <Text
              testID="leave-types-error"
              style={{
                color: colors.destructive,
                fontSize: 13,
                fontFamily: 'Inter_500Medium',
                marginBottom: 8,
              }}
            >
              {t('loadFailed')}
            </Text>
          ) : null}
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

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                {t('startDate')}
              </Text>
              <Pressable
                testID="input-start-date"
                onPress={() => setCalendarOpen(true)}
                accessibilityLabel={t('startDate')}
                style={({ pressed }) => [
                  styles.dateField,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather
                  name="calendar"
                  size={16}
                  color={colors.mutedForeground}
                />
                <Text
                  style={{
                    color: startDate
                      ? colors.foreground
                      : colors.mutedForeground + '88',
                    fontSize: 14,
                    fontFamily: 'Inter_400Regular',
                    flexShrink: 1,
                  }}
                >
                  {startDate ? formatDate(startDate) : t('selectDate')}
                </Text>
              </Pressable>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                {t('endDate')}
              </Text>
              <Pressable
                testID="input-end-date"
                onPress={() => setCalendarOpen(true)}
                accessibilityLabel={t('endDate')}
                style={({ pressed }) => [
                  styles.dateField,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather
                  name="calendar"
                  size={16}
                  color={colors.mutedForeground}
                />
                <Text
                  style={{
                    color: endDate
                      ? colors.foreground
                      : colors.mutedForeground + '88',
                    fontSize: 14,
                    fontFamily: 'Inter_400Regular',
                    flexShrink: 1,
                  }}
                >
                  {endDate ? formatDate(endDate) : t('selectDate')}
                </Text>
              </Pressable>
            </View>
          </View>

          <DateRangeCalendarModal
            visible={calendarOpen}
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s);
              setEndDate(e);
            }}
            onClose={() => setCalendarOpen(false)}
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
  dateField: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
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
