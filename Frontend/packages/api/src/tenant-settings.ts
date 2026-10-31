export interface FieldConfigDto {
  visible: boolean;
  required: boolean;
  visibleToEmployee: boolean;
  visibleToManager: boolean;
}

export interface BrandingSettingsDto {
  logoUrl: string | null;
}

export interface SelfServiceSettingsDto {
  canEditPreferredName: boolean;
  canEditPhone: boolean;
}

/**
 * Who sees the org chart: everyone, or only managers (their own line) and people who read the whole workforce. The
 * server enforces it; screens read it to hide what leads to the chart.
 */
export type OrgChartAudience = "Everyone" | "ManagersAndHr";

export interface OrgChartSettingsDto {
  audience: OrgChartAudience;
}

export interface ProvisioningSettingsDto {
  defaultAccessProfileId: string | null;
  inviteExpiryDays: number;
  resendCooldownHours: number;
  pendingInviteBehavior: "RefreshExisting" | "KeepExisting" | string;
  /** Days before one reminder goes out; 0 sends none. */
  remindAfterDays: number;
  /** Joiners added before their first day get their invitation that morning. */
  inviteJoinersOnFirstDay: boolean;
}

export interface FieldConfigInputDto {
  visible?: boolean | null;
  required?: boolean | null;
  visibleToEmployee?: boolean | null;
  visibleToManager?: boolean | null;
}

export interface BrandingSettingsInputDto {
  logoUrl?: string | null;
}

export interface SelfServiceSettingsInputDto {
  canEditPreferredName?: boolean | null;
  canEditPhone?: boolean | null;
}

export interface ProvisioningSettingsInputDto {
  defaultAccessProfileId?: string | null;
  inviteExpiryDays?: number | null;
  resendCooldownHours?: number | null;
  pendingInviteBehavior?: "RefreshExisting" | "KeepExisting" | string | null;
  remindAfterDays?: number | null;
  inviteJoinersOnFirstDay?: boolean | null;
}

export interface TenantSettingsDto {
  version: number | null;
  employeeFieldConfig: Record<string, FieldConfigDto>;
  branding: BrandingSettingsDto;
  selfService: SelfServiceSettingsDto;
  provisioning: ProvisioningSettingsDto;
  orgChart: OrgChartSettingsDto;
}

export interface UpdateTenantSettingsRequest {
  employeeFieldConfig?: Record<string, FieldConfigInputDto> | null;
  branding?: BrandingSettingsInputDto | null;
  selfService?: SelfServiceSettingsInputDto | null;
  provisioning?: ProvisioningSettingsInputDto | null;
  orgChart?: OrgChartSettingsDto | null;
}

export interface SettingsAuditEventDto {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorRole: string | null;
  sectionId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
  correlationId: string | null;
}

export interface OrganizationSettingsDto {
  version: number | null;
  displayName: string;
  locale: string;
  timeZone: string;
  branding: BrandingSettingsDto;
  usesDefaultBranding: boolean;
}

export interface PeopleDataSettingsDto {
  version: number | null;
  employeeFieldConfig: Record<string, FieldConfigDto>;
  selfService: SelfServiceSettingsDto;
  downstreamConsumers: string[];
  orgChart: OrgChartSettingsDto;
}

export type EmployeeFieldArea = "About" | "Personal" | "Job";
export type EmployeeFieldType = "Text" | "Tags" | "Date" | "Email" | "Phone" | "Address" | "Section";
export type EmployeeFieldEditor = "Employee" | "Hr" | "EmployeeWithApproval" | "DatedChange";

export interface EmployeeFieldDefinitionDto {
  id: string | null;
  key: string;
  label: string;
  area: EmployeeFieldArea;
  type: EmployeeFieldType;
  changedBy: EmployeeFieldEditor;
  visible: boolean;
  visibleToEmployee: boolean;
  visibleToManager: boolean;
  required: boolean;
  builtIn: boolean;
  sortOrder: number;
  sourceKey: string | null;
  galleryKey: string | null;
}

export interface EmployeeFieldGalleryItemDto {
  key: string;
  label: string;
  description: string;
  area: EmployeeFieldArea;
  type: EmployeeFieldType;
  changedBy: EmployeeFieldEditor;
}

export interface EmployeeFieldMissingPersonDto {
  employeeKey: string;
  displayName: string;
  jobTitle: string | null;
  missing: string[];
}

export interface EmployeeFieldSettingsDto {
  version: number | null;
  fields: EmployeeFieldDefinitionDto[];
  gallery: EmployeeFieldGalleryItemDto[];
  recordsToComplete: EmployeeFieldMissingPersonDto[];
}

export type EmployeeFieldInput = Omit<EmployeeFieldDefinitionDto, "builtIn" | "sourceKey">;

export interface UpdateEmployeeFieldsRequest {
  fields: EmployeeFieldInput[];
}

export interface ProvisioningSettingsResponseDto {
  version: number | null;
  provisioning: ProvisioningSettingsDto;
  downstreamConsumers: string[];
}

export const tenantSettingsPaths = {
  current: () => "/corehr/settings",
  organization: () => "/corehr/settings/organization",
  peopleData: () => "/corehr/settings/people-data",
  fields: () => "/corehr/settings/fields",
  provisioning: () => "/corehr/settings/provisioning",
  audit: () => "/corehr/settings/governance/audit",
} as const;

export const tenantSettingsQueryKeys = {
  all: () => ["tenantSettings"] as const,
  current: () => [...tenantSettingsQueryKeys.all(), "current"] as const,
  organization: () => [...tenantSettingsQueryKeys.all(), "organization"] as const,
  peopleData: () => [...tenantSettingsQueryKeys.all(), "people-data"] as const,
  fields: () => [...tenantSettingsQueryKeys.all(), "fields"] as const,
  provisioning: () => [...tenantSettingsQueryKeys.all(), "provisioning"] as const,
  audit: () => [...tenantSettingsQueryKeys.all(), "audit"] as const,
} as const;
