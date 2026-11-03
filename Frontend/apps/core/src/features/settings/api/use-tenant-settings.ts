"use client";

import { useCallback, useMemo } from "react";
import {
  companyHomeKeys,
  createPlatformApiClient,
  fusionSettingsQueryKeys,
  tenantSettingsQueryKeys,
  tenantSettingsPaths,
  type OrganizationSettingsDto,
  type EmployeeFieldSettingsDto,
  type UpdateEmployeeFieldsRequest,
  type PeopleDataSettingsDto,
  type ProvisioningSettingsResponseDto,
  type SettingsAuditEventDto,
  type UpdateTenantSettingsRequest,
} from "@repo/api";
import {
  useApiMutation,
  useApiQuery,
  useApiQueryClient,
} from "@repo/api/query";
import { useAuth } from "@repo/auth";

interface UpdatePeopleDataSettingsArgs {
  expectedVersion: number | null;
  input: Pick<UpdateTenantSettingsRequest, "employeeFieldConfig" | "selfService" | "orgChart">;
}

interface UpdateProvisioningSettingsArgs {
  expectedVersion: number | null;
  input: Pick<UpdateTenantSettingsRequest, "provisioning">;
}

interface UpdateEmployeeFieldsArgs {
  expectedVersion: number | null;
  input: UpdateEmployeeFieldsRequest;
}

function buildIfMatchHeaders(expectedVersion: number | null) {
  return expectedVersion == null
    ? undefined
    : { "If-Match": `"${expectedVersion}"` };
}

export function useOrganizationSettings(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<OrganizationSettingsDto>(tenantSettingsPaths.organization(), {
        signal,
      }),
    [client]
  );

  return useApiQuery(tenantSettingsQueryKeys.organization(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

export function usePeopleDataSettings(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<PeopleDataSettingsDto>(tenantSettingsPaths.peopleData(), {
        signal,
      }),
    [client]
  );

  return useApiQuery(tenantSettingsQueryKeys.peopleData(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

export function useEmployeeFields(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<EmployeeFieldSettingsDto>(tenantSettingsPaths.fields(), { signal }),
    [client]
  );
  return useApiQuery(tenantSettingsQueryKeys.fields(), queryFn, { enabled: isAuthenticated && enabled });
}

export function useProvisioningSettings(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<ProvisioningSettingsResponseDto>(
        tenantSettingsPaths.provisioning(),
        {
          signal,
        }
      ),
    [client]
  );

  return useApiQuery(tenantSettingsQueryKeys.provisioning(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

export function useSettingsAudit(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<SettingsAuditEventDto[]>(tenantSettingsPaths.audit(), {
        signal,
        params: { take: 100 },
      }),
    [client]
  );

  return useApiQuery(tenantSettingsQueryKeys.audit(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

/** After a save: the section's values, its last change in Settings, and Change history are all new. */
function useAfterSave() {
  const queryClient = useApiQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantSettingsQueryKeys.audit() }),
        queryClient.invalidateQueries({ queryKey: fusionSettingsQueryKeys.all() }),
      ]),
    [queryClient]
  );
}

export function useUpdatePeopleDataSettings() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();
  const afterSave = useAfterSave();

  return useApiMutation<PeopleDataSettingsDto, UpdatePeopleDataSettingsArgs>(
    ({ expectedVersion, input }) =>
      client.patch<PeopleDataSettingsDto>(
        tenantSettingsPaths.peopleData(),
        input,
        { headers: buildIfMatchHeaders(expectedVersion) }
      ),
    {
      onSuccess: async (data) => {
        queryClient.setQueryData(tenantSettingsQueryKeys.peopleData(), data);
        await afterSave();
      },
    }
  );
}

export function useUpdateEmployeeFields() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();
  const afterSave = useAfterSave();
  return useApiMutation<EmployeeFieldSettingsDto, UpdateEmployeeFieldsArgs>(
    ({ expectedVersion, input }) =>
      client.put<EmployeeFieldSettingsDto>(tenantSettingsPaths.fields(), input, {
        headers: buildIfMatchHeaders(expectedVersion),
      }),
    {
      onSuccess: async (data) => {
        queryClient.setQueryData(tenantSettingsQueryKeys.fields(), data);
        await afterSave();
      },
    }
  );
}

export function useUpdateProvisioningSettings() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();
  const afterSave = useAfterSave();

  return useApiMutation<
    ProvisioningSettingsResponseDto,
    UpdateProvisioningSettingsArgs
  >(
    ({ expectedVersion, input }) =>
      client.patch<ProvisioningSettingsResponseDto>(
        tenantSettingsPaths.provisioning(),
        input,
        { headers: buildIfMatchHeaders(expectedVersion) }
      ),
    {
      onSuccess: async (data) => {
        queryClient.setQueryData(tenantSettingsQueryKeys.provisioning(), data);
        await afterSave();
      },
    }
  );
}

export function useUpdateOrganizationSettings() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();
  const afterSave = useAfterSave();
  const { user } = useAuth();
  return useApiMutation<OrganizationSettingsDto, { expectedVersion: number | null; workingDays: number[] }>(
    ({ expectedVersion, workingDays }) => client.patch<OrganizationSettingsDto>(tenantSettingsPaths.organization(),
      { workingDays }, { headers: buildIfMatchHeaders(expectedVersion) }),
    { onSuccess: async (data) => {
      queryClient.setQueryData(tenantSettingsQueryKeys.organization(), data);
      await queryClient.invalidateQueries({ queryKey: companyHomeKeys.workWeek(user?.tenantId ?? "none") });
      await afterSave();
    } },
  );
}
