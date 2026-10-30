using System.ComponentModel.DataAnnotations;
using EY.HRPlatform.CoreHR.Domain.Entities;

namespace EY.HRPlatform.CoreHR.Features.Catalog;

// --- Requests -------------------------------------------------------------------------------------

public sealed record JobRequest(
    [MaxLength(Job.MaxTitleLength)] string Title,
    Guid? FamilyId = null,
    Guid? LevelId = null);

public sealed record PlaceRequest(
    [MaxLength(Place.MaxNameLength)] string Name,
    [MaxLength(Place.MaxDetailLength)] string? City = null,
    [MaxLength(Place.MaxDetailLength)] string? Country = null);

/// <summary>Moves everything that points at one job (or place) to another, then removes the first.</summary>
public sealed record MergeRequest(Guid IntoId);

public sealed record ListValueRequest([MaxLength(CompanyListValue.MaxLabelLength)] string Label);

/// <summary>The list's values in their new order; every value of the list, retired ones included.</summary>
public sealed record ListOrderRequest(IReadOnlyList<Guid> ValueIds);

// --- Read model -----------------------------------------------------------------------------------

public sealed record CatalogValueRefDto(Guid Id, string Label, bool IsRetired);

/// <summary>
/// A job in the catalogue. <paramref name="PeopleCount"/> is who holds it today; <paramref name="InUse"/> says
/// anything ever pointed at it (people past or scheduled, open roles), which is when it can't be deleted.
/// </summary>
public sealed record JobDto(
    Guid Id,
    string Title,
    CatalogValueRefDto? Family,
    CatalogValueRefDto? Level,
    bool IsRetired,
    int PeopleCount,
    int OpenRoleCount,
    bool InUse);

public sealed record PlaceDto(
    Guid Id,
    string Name,
    string? City,
    string? Country,
    bool IsRetired,
    int PeopleCount,
    int OpenRoleCount,
    bool InUse);

/// <summary>
/// One value of a company list. <paramref name="UsageCount"/> counts what uses it now: jobs for levels and
/// families, people for employment types. <paramref name="InUse"/> includes history, and decides retire over delete.
/// </summary>
public sealed record CompanyListValueDto(
    Guid Id,
    string Key,
    string Label,
    int SortOrder,
    bool IsRetired,
    int UsageCount,
    bool InUse);

/// <summary>A company list by its address id (<c>employment-types</c>, <c>levels</c>, …).</summary>
public sealed record CompanyListDto(string Id, IReadOnlyList<CompanyListValueDto> Values);

/// <summary>The addresses of the company lists and their defaults.</summary>
public static class CompanyLists
{
    public static readonly IReadOnlyDictionary<string, CompanyList> ById = new Dictionary<string, CompanyList>(StringComparer.Ordinal)
    {
        ["employment-types"] = CompanyList.EmploymentTypes,
        ["levels"] = CompanyList.Levels,
        ["job-families"] = CompanyList.JobFamilies,
        ["change-reasons"] = CompanyList.ChangeReasons,
        ["leave-types"] = CompanyList.LeaveTypes,
    };

    public static string IdOf(CompanyList list) => ById.First(pair => pair.Value == list).Key;

    /// <summary>What a new company starts with. Job families stay empty: they differ too much between companies.</summary>
    public static readonly IReadOnlyDictionary<CompanyList, string[]> Defaults = new Dictionary<CompanyList, string[]>
    {
        [CompanyList.EmploymentTypes] = ["Full-time", "Part-time", "Fixed-term", "Contractor", "Intern"],
        [CompanyList.Levels] = ["Junior", "Mid-level", "Senior", "Lead", "Manager", "Director", "Executive"],
        [CompanyList.ChangeReasons] = ["Promotion", "Transfer", "Reorganization", "Role change", "Correction",
            "Resignation", "Dismissal", "Retirement", "End of contract"],
        [CompanyList.LeaveTypes] = ["Annual leave", "Sick leave", "Maternity leave", "Paternity leave", "Unpaid leave"],
    };
}
