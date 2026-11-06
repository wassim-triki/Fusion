namespace EY.HRPlatform.Identity.Domain.Enums;

/// <summary>
/// Customer modules a tenant can be entitled to. Core HR is mandatory for every
/// provisioned tenant and cannot be disabled; the others are off until a platform
/// administrator turns them on. Stored and sent by name, so values can be added freely.
/// </summary>
public enum TenantModule
{
    CoreHR = 0,
    Performance = 1,
    Learning = 2,
    Recruitment = 3,
    Interview = 4,
}
