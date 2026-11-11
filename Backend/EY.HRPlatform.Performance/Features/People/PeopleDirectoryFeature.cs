using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.Performance.Features.People;

/// <summary>A colleague to choose: just enough to tell people apart, nothing about their employment or contact.</summary>
public sealed record DirectoryPersonDto(Guid EmployeeId, string DisplayName, string? JobTitle, string? OrgUnitName);

public sealed record SearchPeopleDirectoryQuery(string? Search) : IQuery<Result<IReadOnlyList<DirectoryPersonDto>>>;

/// <summary>
/// The colleague picker behind feedback, requests and praise. Core HR's own people search follows the caller's view
/// scope, so an employee finds only themselves there; this reads active colleagues through the signed internal
/// contract instead, tenant-bound, at most 20, with names, titles and teams only.
/// </summary>
public sealed class SearchPeopleDirectoryHandler(ICoreWorkforceClient workforce)
    : IQueryHandler<SearchPeopleDirectoryQuery, Result<IReadOnlyList<DirectoryPersonDto>>>
{
    public const int MinTermLength = 2;
    public const int MaxResults = 20;

    public async Task<Result<IReadOnlyList<DirectoryPersonDto>>> Handle(SearchPeopleDirectoryQuery query, CancellationToken token)
    {
        var term = query.Search?.Trim() ?? string.Empty;
        if (term.Length < MinTermLength) return Result.Success<IReadOnlyList<DirectoryPersonDto>>([]);
        var found = await workforce.SearchAsync(PerformanceClock.UtcNow, term.Length > 100 ? term[..100] : term, MaxResults, token);
        return Result.Success<IReadOnlyList<DirectoryPersonDto>>(found.Where(p => p.IsActive).Take(MaxResults)
            .Select(p => new DirectoryPersonDto(p.EmployeeId, p.DisplayName, p.JobTitle, p.OrgUnit?.Name)).ToList());
    }
}

/// <summary>The people the caller works with most closely, for praise's quick picks.</summary>
public sealed record NearbyPeopleQuery(Guid EmployeeId) : IQuery<Result<IReadOnlyList<DirectoryPersonDto>>>;

/// <summary>
/// Teammates (the same manager), then the caller's reports, then their manager: active people only, never the caller,
/// at most <see cref="MaxResults"/>. Someone with no employee record or no one around them gets an empty list.
/// </summary>
public sealed class NearbyPeopleHandler(ICoreWorkforceClient workforce) : IQueryHandler<NearbyPeopleQuery, Result<IReadOnlyList<DirectoryPersonDto>>>
{
    public const int MaxResults = 6;

    public async Task<Result<IReadOnlyList<DirectoryPersonDto>>> Handle(NearbyPeopleQuery query, CancellationToken token)
    {
        var me = query.EmployeeId;
        if (me == Guid.Empty) return Result.Success<IReadOnlyList<DirectoryPersonDto>>([]);
        var now = PerformanceClock.UtcNow;
        var self = (await workforce.ResolveAsync(now, [me], token)).FirstOrDefault();
        if (self is null) return Result.Success<IReadOnlyList<DirectoryPersonDto>>([]);
        var managerId = self.Manager is { IsActive: true } m ? m.EmployeeId : (Guid?)null;
        var around = await workforce.GetDirectReportsAsync(now, managerId is Guid id ? [id, me] : [me], token);
        var manager = managerId is Guid mid ? (await workforce.ResolveAsync(now, [mid], token)).FirstOrDefault() : null;
        var ordered = around.Where(p => p.Manager?.EmployeeId == managerId && managerId is not null)
            .Concat(around.Where(p => p.Manager?.EmployeeId == me))
            .Concat(manager is null ? [] : [manager]);
        return Result.Success<IReadOnlyList<DirectoryPersonDto>>(ordered.Where(p => p.IsActive && p.EmployeeId != me).DistinctBy(p => p.EmployeeId)
            .Take(MaxResults).Select(p => new DirectoryPersonDto(p.EmployeeId, p.DisplayName, p.JobTitle, p.OrgUnit?.Name)).ToList());
    }
}
