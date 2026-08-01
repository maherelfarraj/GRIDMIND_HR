import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
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
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListUsersQueryKey,
  useGetUser,
  useIssueOneTimePassword,
  useListUsers,
  useUnlockUser,
} from '@workspace/api-client-react';
import type { SystemUser } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Show-once one-time-password result. Lives only in component state — it is
 * deliberately never written to AsyncStorage/SecureStore, so closing the
 * dialog (or the app) discards it permanently, matching the web users screen.
 */
interface IssuedOtp {
  username: string;
  fullName: string;
  oneTimePassword: string;
}

function UserRow({
  item,
  onIssue,
  onUnlock,
  unlockPending,
  highlighted,
}: {
  item: SystemUser;
  onIssue: (user: SystemUser) => void;
  onUnlock: (user: SystemUser) => void;
  unlockPending: boolean;
  highlighted: boolean;
}) {
  const colors = useColors();
  const { lang, t } = useI18n();
  const name = lang === 'ar' && item.fullNameAr ? item.fullNameAr : item.fullNameEn;
  const locked = item.lockedUntil
    ? new Date(item.lockedUntil).getTime() > Date.now()
    : false;

  return (
    <Card
      style={{
        marginBottom: 12,
        // Deep-link highlight: security alerts land here with the affected
        // account marked so the admin can verify and unlock at a glance.
        ...(highlighted
          ? { borderWidth: 2, borderColor: colors.warning }
          : {}),
      }}
    >
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
              marginTop: 4,
            }}
          >
            {item.username} · {item.roleNameEn}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {!item.isActive && (
            <Badge label={t('inactive')} color={colors.mutedForeground} />
          )}
          {locked && <Badge label={t('locked')} color={colors.destructive} />}
          {item.mustChangePassword && (
            <Badge label={t('mustChangePasswordBadge')} color={colors.warning} />
          )}
        </View>
      </View>
      <View style={{ marginTop: 12, flexDirection: 'row', gap: 10 }}>
        <AppButton
          testID={`button-issue-otp-${item.id}`}
          label={t('issueOtp')}
          icon="key"
          small
          variant="outline"
          onPress={() => onIssue(item)}
        />
        {locked && (
          <AppButton
            testID={`button-unlock-${item.id}`}
            label={t('unlock')}
            icon="unlock"
            small
            loading={unlockPending}
            onPress={() => onUnlock(item)}
          />
        )}
      </View>
    </Card>
  );
}

export default function AdminUsersScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  // Deep-link support: lockout security alerts navigate here as
  // /admin-users?highlight=<username> (mapped from the web actionUrl), so
  // the admin lands with the affected account visible and highlighted.
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const highlightUsername =
    typeof highlight === 'string' && highlight.length > 0 ? highlight : null;
  const listRef = useRef<FlatList<SystemUser>>(null);
  const scrolledRef = useRef(false);

  // Route-level gate: this screen is reachable by direct navigation/deep link,
  // so it must not rely on the Home entry point being hidden. Confirm the
  // signed-in account's role against the server before fetching anything;
  // GET /users itself is also admin-only server-side (the real boundary).
  const me = useGetUser(user?.id ?? 0, {
    query: { enabled: !!user?.id },
  } as any);
  const isAdmin = me.data?.roleNameEn === 'Super Administrator';

  const users = useListUsers({ query: { enabled: isAdmin } } as any);
  const items = users.data ?? [];

  // Scroll the highlighted account into view once the list has data.
  useEffect(() => {
    if (scrolledRef.current || !highlightUsername || items.length === 0) return;
    const index = items.findIndex((u) => u.username === highlightUsername);
    if (index < 0) return;
    scrolledRef.current = true;
    // Defer a tick so the FlatList has laid out before scrolling.
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    }, 250);
  }, [items, highlightUsername]);

  // Two-step UX (mirrors the web users screen):
  // 1) confirmTarget — admin picked a user; show consequences and ask to confirm.
  // 2) issuedOtp — server returned the plaintext exactly once; display it with
  //    copy support until the admin dismisses it. Never persisted on device.
  const [confirmTarget, setConfirmTarget] = useState<SystemUser | null>(null);
  const [issuedOtp, setIssuedOtp] = useState<IssuedOtp | null>(null);
  const [copied, setCopied] = useState(false);
  const [issueError, setIssueError] = useState(false);
  const [unlockError, setUnlockError] = useState(false);
  const [unlockingId, setUnlockingId] = useState<number | null>(null);

  // Unlock uses the existing POST /users/:id/unlock endpoint; on success the
  // list refetches so the "Locked" badge and button clear immediately.
  const unlockUser = useUnlockUser({
    mutation: {
      onSuccess: () => {
        setUnlockingId(null);
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        setUnlockingId(null);
        setUnlockError(true);
      },
    },
  });

  const issueOtp = useIssueOneTimePassword({
    mutation: {
      onSuccess: (data, variables) => {
        const target = confirmTarget;
        setConfirmTarget(null);
        setCopied(false);
        setIssuedOtp({
          username: data.username,
          fullName:
            target && target.id === variables.id ? target.fullNameEn : data.username,
          oneTimePassword: data.oneTimePassword,
        });
        // Issuance revokes sessions and sets must-change — refresh the list.
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        setIssueError(true);
      },
    },
  });

  const copyOtp = async () => {
    if (!issuedOtp) return;
    try {
      await Clipboard.setStringAsync(issuedOtp.oneTimePassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the password stays visible for manual copy.
    }
  };

  // Unauthenticated: back to sign-in, same as the tab guards.
  if (!authLoading && !user) return <Redirect href="/login" />;
  // Confirmed non-admin (or the server refused the role lookup): deny and
  // leave — never render the directory or issuance controls.
  if (me.isError || (me.isSuccess && !isAdmin)) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('userAdmin')}
        subtitle={t('userAdminSubtitle')}
        right={<LangToggle />}
      />
      {unlockError && (
        <Text
          testID="text-unlock-error"
          style={{
            color: colors.destructive,
            fontSize: 13,
            fontFamily: 'Inter_500Medium',
            paddingHorizontal: 20,
            paddingBottom: 8,
          }}
        >
          {t('unlockFailed')}
        </Text>
      )}
      {authLoading || me.isLoading || users.isLoading ? (
        <LoadingView />
      ) : users.isError ? (
        <ErrorView onRetry={() => users.refetch()} />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(u) => String(u.id)}
          onScrollToIndexFailed={({ index }) => {
            // Long lists may not have measured yet — approximate, then retry.
            listRef.current?.scrollToOffset({ offset: index * 120, animated: true });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
            }, 300);
          }}
          scrollEnabled={items.length > 0}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => users.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<EmptyState icon="users" message={t('noUsers')} />}
          renderItem={({ item }) => (
            <UserRow
              item={item}
              highlighted={item.username === highlightUsername}
              unlockPending={unlockUser.isPending && unlockingId === item.id}
              onUnlock={(u) => {
                setUnlockError(false);
                setUnlockingId(u.id);
                unlockUser.mutate({ id: u.id });
              }}
              onIssue={(u) => {
                setIssueError(false);
                setConfirmTarget(u);
              }}
            />
          )}
        />
      )}

      {/* Step 1: confirm intent before replacing the user's password. */}
      <Modal
        visible={confirmTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmTarget(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Card>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 17,
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {t('issueOtpConfirmTitle')}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
                marginTop: 8,
                lineHeight: 19,
              }}
            >
              {confirmTarget?.fullNameEn} ({confirmTarget?.username})
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
                marginTop: 8,
                lineHeight: 19,
              }}
            >
              {t('issueOtpConfirmBody')}
            </Text>
            {issueError && (
              <Text
                style={{
                  color: colors.destructive,
                  fontSize: 13,
                  fontFamily: 'Inter_500Medium',
                  marginTop: 8,
                }}
              >
                {t('issueOtpFailed')}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  testID="button-cancel-issue-otp"
                  label={t('cancel')}
                  variant="outline"
                  onPress={() => setConfirmTarget(null)}
                  disabled={issueOtp.isPending}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton
                  testID="button-confirm-issue-otp"
                  label={t('issueOtp')}
                  variant="destructive"
                  loading={issueOtp.isPending}
                  onPress={() => {
                    if (confirmTarget) {
                      setIssueError(false);
                      issueOtp.mutate({ id: confirmTarget.id });
                    }
                  }}
                />
              </View>
            </View>
          </Card>
        </View>
      </Modal>

      {/* Step 2: show-once result. Dismissing discards the plaintext forever. */}
      <Modal
        visible={issuedOtp !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setIssuedOtp(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Card>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 17,
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {t('otpIssuedTitle')}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: 'Inter_400Regular',
                marginTop: 6,
              }}
            >
              {issuedOtp?.fullName} ({issuedOtp?.username})
            </Text>
            <Text
              style={{
                color: colors.warning,
                fontSize: 13,
                fontFamily: 'Inter_500Medium',
                marginTop: 10,
                lineHeight: 19,
              }}
            >
              {t('otpIssuedShowOnce')}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                marginTop: 14,
                backgroundColor: colors.muted,
                borderRadius: colors.radius,
                paddingVertical: 12,
                paddingHorizontal: 14,
              }}
            >
              <Text
                testID="text-issued-otp"
                selectable
                style={{
                  flex: 1,
                  color: colors.foreground,
                  fontSize: 17,
                  fontFamily: 'Inter_700Bold',
                  letterSpacing: 1,
                }}
              >
                {issuedOtp?.oneTimePassword}
              </Text>
              <Pressable
                testID="button-copy-otp"
                onPress={copyOtp}
                accessibilityLabel={t('copy')}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  padding: 4,
                })}
              >
                <Feather
                  name={copied ? 'check' : 'copy'}
                  size={17}
                  color={copied ? colors.success : colors.primary}
                />
                <Text
                  style={{
                    color: copied ? colors.success : colors.primary,
                    fontSize: 13,
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {copied ? t('copied') : t('copy')}
                </Text>
              </Pressable>
            </View>
            <View style={{ marginTop: 16 }}>
              <AppButton
                testID="button-close-issued-otp"
                label={t('done')}
                onPress={() => setIssuedOtp(null)}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}
