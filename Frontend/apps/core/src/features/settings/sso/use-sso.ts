"use client";

import { useCallback, useMemo } from "react";
import {
  createPlatformApiClient,
  ssoPaths,
  type SaveSsoConnectionRequest,
  type SsoConfirmation,
  type SsoLinkDto,
  type SsoSettingsDto,
} from "@repo/api";
import { useApiQuery, useApiQueryClient } from "@repo/api/query";
import { useAuth } from "@repo/auth";

export const ssoQueryKeys = {
  settings: () => ["identity", "sso", "settings"] as const,
  links: (userId: string) => ["identity", "sso", "links", userId] as const,
};

/** Settings › Sign-in › Single sign-on (B-191). */
export function useSsoSettings(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<SsoSettingsDto>(ssoPaths.settings(), { signal }),
    [client],
  );
  return useApiQuery(ssoQueryKeys.settings(), queryFn, { enabled: isAuthenticated && enabled });
}

/** Every change answers the whole block, which replaces what the page shows. */
export function useSsoCommands() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();
  const keep = useCallback(
    (settings: SsoSettingsDto) => {
      queryClient.setQueryData(ssoQueryKeys.settings(), settings);
      return settings;
    },
    [queryClient],
  );

  return useMemo(
    () => ({
      setProviders: (allowMicrosoft: boolean, allowGoogle: boolean) =>
        client.put<SsoSettingsDto>(ssoPaths.providers(), { allowMicrosoft, allowGoogle }).then(keep),
      saveConnection: (request: SaveSsoConnectionRequest) =>
        client.put<SsoSettingsDto>(ssoPaths.connection(), request).then(keep),
      removeConnection: (confirmation: SsoConfirmation) =>
        client.delete<SsoSettingsDto>(ssoPaths.connection(), { body: confirmation }).then(keep),
      addDomain: (domain: string) => client.post<SsoSettingsDto>(ssoPaths.domains(), { domain }).then(keep),
      removeDomain: (domain: string, confirmation: SsoConfirmation) =>
        client.delete<SsoSettingsDto>(ssoPaths.domain(domain), { body: confirmation }).then(keep),
      setRequirement: (on: boolean, confirmation: SsoConfirmation = {}) =>
        client.post<SsoSettingsDto>(ssoPaths.requirement(), { on, ...confirmation }).then(keep),
      setPassword: (newPassword: string, confirmation: { currentPassword?: string; sso?: boolean }) =>
        client.post<{ hasPassword: boolean }>(ssoPaths.password(), { newPassword, ...confirmation }),
      refresh: () => queryClient.invalidateQueries({ queryKey: ssoQueryKeys.settings() }),
    }),
    [client, keep, queryClient],
  );
}

/** How a person signs in, for Person › Access. */
export function useSsoLinks(userId: string | null | undefined, enabled = true) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<SsoLinkDto[]>(ssoPaths.links(userId!), { signal }),
    [client, userId],
  );
  return useApiQuery(ssoQueryKeys.links(userId ?? "none"), queryFn, { enabled: Boolean(userId) && enabled });
}
