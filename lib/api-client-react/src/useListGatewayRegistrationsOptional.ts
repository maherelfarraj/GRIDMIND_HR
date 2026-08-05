/**
 * useListGatewayRegistrationsOptional
 *
 * Wraps the generated listGatewayRegistrations fetcher with suppressUnauthorized
 * so a 401 response silently returns null instead of firing the global
 * session-expiry redirect. Use this in optional UI widgets (e.g. sidebar
 * badges) where a 401 means "feature unavailable", not "session expired".
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {
  getListGatewayRegistrationsQueryKey,
  getListGatewayRegistrationsUrl,
} from "./generated/api";
import type { GatewayRegistration } from "./generated/api.schemas";

export function useListGatewayRegistrationsOptional() {
  return useQuery({
    queryKey: [...getListGatewayRegistrationsQueryKey(), "optional"],
    queryFn: async (): Promise<GatewayRegistration[] | null> => {
      try {
        return await customFetch<GatewayRegistration[]>(
          getListGatewayRegistrationsUrl(),
          { suppressUnauthorized: true },
        );
      } catch {
        // 401 (suppressed), network errors, etc. → hide the widget
        return null;
      }
    },
    staleTime: 30_000,
  });
}
