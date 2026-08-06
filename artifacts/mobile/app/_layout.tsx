import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n';
import { setBaseUrl } from '@workspace/api-client-react';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Redirect, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Expo bundles run outside the web proxy — absolute URL to reach the API.
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Routes where a mustChangePassword user is legitimately allowed — the guard
// must never redirect them away from the screens that handle authentication.
const AUTH_ROUTES = new Set(['/login', '/change-password']);

export function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  // Global guard: any authenticated user with mustChangePassword must be sent
  // to /change-password regardless of which screen they landed on (deep link,
  // mid-session admin reset, etc.). Tabs have their own identical guard, but
  // this catches every non-tab route too.
  if (!isLoading && user?.mustChangePassword && !AUTH_ROUTES.has(pathname)) {
    return <Redirect href="/change-password" />;
  }

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back', headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="new-leave" options={{ presentation: 'modal' }} />
      <Stack.Screen name="change-password" options={{ presentation: 'modal' }} />
      <Stack.Screen name="payslip/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="devices" />
      <Stack.Screen name="admin-users" />
      <Stack.Screen name="privileged-sessions" />
      <Stack.Screen name="privileged-session/[id]" />
      <Stack.Screen name="payroll-period-ot/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <I18nProvider>
            <AuthProvider>
              <GestureHandlerRootView>
                <KeyboardProvider>
                  <StatusBar style="light" />
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </AuthProvider>
          </I18nProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
