namespace EY.HRPlatform.Identity.Features.TenantContext.Dtos;

/// <summary>Someone who can give a person access, as a refused page names them.</summary>
public sealed record CompanyAdministratorContactDto(string Name, string FirstName, string Email);

/// <summary>
/// Who to ask when a page refuses someone. An administrator is told they are one and gets no names, so a refusal never
/// tells them to ask themselves.
/// </summary>
public sealed record CompanyAdministratorsDto(bool CallerIsAdministrator, IReadOnlyList<CompanyAdministratorContactDto> Administrators);
