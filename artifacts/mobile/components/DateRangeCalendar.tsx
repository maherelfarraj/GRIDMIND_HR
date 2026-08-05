import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';

import { nextRange, parseISO, toISODate } from '@/components/dateRange';

type Props = {
  visible: boolean;
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  onClose: () => void;
};

export function DateRangeCalendarModal({
  visible,
  startDate,
  endDate,
  onChange,
  onClose,
}: Props) {
  const colors = useColors();
  const { t, lang } = useI18n();

  const initialMonth = useMemo(() => {
    const base = parseISO(startDate) ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [startDate, visible]);

  const [month, setMonth] = useState(initialMonth);
  // Re-sync visible month when the modal opens.
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setMonth(initialMonth);
  }

  const locale = lang === 'ar' ? 'ar' : 'en';
  const monthLabel = month.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  const weekdayLabels = useMemo(() => {
    // Week starts on Sunday.
    const labels: string[] = [];
    const ref = new Date(2026, 7, 2); // a Sunday
    for (let i = 0; i < 7; i++) {
      const d = new Date(ref);
      d.setDate(ref.getDate() + i);
      labels.push(d.toLocaleDateString(locale, { weekday: 'narrow' }));
    }
    return labels;
  }, [locale]);

  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [month]);

  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const todayISO = toISODate(new Date());

  const handleDayPress = (day: Date) => {
    Haptics.selectionAsync();
    const next = nextRange(startDate, endDate, toISODate(day));
    onChange(next.start, next.end);
  };

  const dayState = (day: Date) => {
    const t0 = day.getTime();
    const isStart = start != null && t0 === start.getTime();
    const isEnd = end != null && t0 === end.getTime();
    const inRange =
      start != null && end != null && t0 > start.getTime() && t0 < end.getTime();
    return { isStart, isEnd, inRange };
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="calendar-backdrop"
      >
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.headerRow}>
            <Pressable
              testID="calendar-prev-month"
              onPress={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
              style={({ pressed }) => [
                styles.navBtn,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityLabel="Previous month"
            >
              <Feather name="chevron-left" size={22} color={colors.foreground} />
            </Pressable>
            <Text
              testID="calendar-month-label"
              style={{
                color: colors.foreground,
                fontSize: 16,
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {monthLabel}
            </Text>
            <Pressable
              testID="calendar-next-month"
              onPress={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
              style={({ pressed }) => [
                styles.navBtn,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityLabel="Next month"
            >
              <Feather
                name="chevron-right"
                size={22}
                color={colors.foreground}
              />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {weekdayLabels.map((w, i) => (
              <Text
                key={i}
                style={[styles.weekday, { color: colors.mutedForeground }]}
              >
                {w}
              </Text>
            ))}
          </View>

          {weeks.map((row, ri) => (
            <View key={ri} style={styles.weekRow}>
              {row.map((day, ci) => {
                if (!day) {
                  return <View key={ci} style={styles.dayCell} />;
                }
                const iso = toISODate(day);
                const { isStart, isEnd, inRange } = dayState(day);
                const selected = isStart || isEnd;
                const isToday = iso === todayISO;
                return (
                  <Pressable
                    key={ci}
                    testID={`calendar-day-${iso}`}
                    onPress={() => handleDayPress(day)}
                    style={({ pressed }) => [
                      styles.dayCell,
                      {
                        backgroundColor: selected
                          ? colors.primary
                          : inRange
                            ? colors.primary + '22'
                            : 'transparent',
                        borderRadius: 999,
                        opacity: pressed ? 0.6 : 1,
                        borderWidth: isToday && !selected ? 1 : 0,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: selected
                          ? colors.primaryForeground
                          : colors.foreground,
                        fontSize: 14,
                        fontFamily: selected
                          ? 'Inter_600SemiBold'
                          : 'Inter_400Regular',
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              fontFamily: 'Inter_400Regular',
              textAlign: 'center',
              marginTop: 10,
            }}
          >
            {t('calendarHint')}
          </Text>

          <Pressable
            testID="calendar-done"
            onPress={onClose}
            style={({ pressed }) => [
              styles.doneBtn,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.8 : 1,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text
              style={{
                color: colors.primaryForeground,
                fontSize: 15,
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {t('done')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  navBtn: { padding: 6 },
  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginBottom: 4,
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 1,
  },
  doneBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
