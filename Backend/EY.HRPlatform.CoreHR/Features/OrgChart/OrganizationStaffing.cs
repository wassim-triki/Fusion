using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.OrgChart;

// --- Contracts ------------------------------------------------------------------------------------

/// <summary>
/// Who works in each unit as of a date: the Organization's Structure and List views and its time slider.
/// <paramref name="FirstDate"/> is the company's first day in Fusion (its earliest unit or employment), where the
/// slider starts.
/// </summary>
public sealed record OrganizationStaffingDto(DateOnly AsOf, DateOnly? FirstDate, IReadOnlyList<UnitStaffingDto> Units);

/// <summary>
/// One unit as of a date. <paramref name="People"/> counts everyone in the unit and the units under it;
/// <paramref name="Direct"/> only those placed in the unit itself. The head is the person in the unit whose manager
/// works outside it (the one leading the most people when several do); null when nobody does yet, or when the viewer
/// doesn't see the whole company's chart. Open roles count the unit and the units under it, from today on.
/// </summary>
public sealed record UnitStaffingDto(Guid UnitId, int People, int Direct, OrgChartPersonDto? Head, int OpenRoles);

/// <param name="WithHeads">The viewer sees the whole company's chart, so the heads' cards may come back.</param>
/// <param name="HrAudience">HR reads every field the tenant shows on a card, and on-hold roles.</param>
public sealed record OrganizationStaffingQuery(DateOnly AsOf, bool WithHeads, bool HrAudience) : IQuery<Result<OrganizationStaffingDto>>;

/// <summary>A unit's page: its head, everyone in it and the units under it (each card carries its unit), and its open roles.</summary>
public sealed record OrganizationUnitPeopleDto(
    Guid UnitId,
    DateOnly AsOf,
    OrgChartPersonDto? Head,
    IReadOnlyList<OrgChartPersonDto> People,
    IReadOnlyList<OrgChartOpenRoleDto> OpenRoles);

public sealed record OrganizationUnitPeopleQuery(Guid UnitId, DateOnly AsOf, bool HrAudience) : IQuery<Result<OrganizationUnitPeopleDto>>;

public static class OrganizationStaffingErrors
{
    public const string UnitNotFoundCode = "OrganizationStaffing.UnitNotFound";
}

// --- Handlers -------------------------------------------------------------------------------------

public sealed class OrganizationStaffingQueryHandler(
    CoreHRDbContext dbContext,
    ITenantSettingsReadService tenantSettings) : IQueryHandler<OrganizationStaffingQuery, Result<OrganizationStaffingDto>>
{
    public async Task<Result<OrganizationStaffingDto>> Handle(OrganizationStaffingQuery request, CancellationToken cancellationToken)
    {
        var staffing = await UnitStaffing.LoadAsync(dbContext, tenantSettings, request.AsOf, request.HrAudience, cancellationToken);

        // The slider's first day: the earliest unit state or employment, whichever came first.
        var firstUnit = await dbContext.OrgUnitEffectiveStates.AsNoTracking().MinAsync(s => (DateOnly?)s.EffectiveFrom, cancellationToken);
        var firstJoin = await dbContext.Employments.AsNoTracking().MinAsync(e => (DateTime?)e.EffectiveFrom, cancellationToken);
        DateOnly? first = new[] { firstUnit, firstJoin is { } join ? DateOnly.FromDateTime(join) : null }.Min();

        var units = staffing.UnitIds
            .Select(id =>
            {
                var people = staffing.PeopleIn(id);
                var head = request.WithHeads ? staffing.HeadOf(id, people) : null;
                return new UnitStaffingDto(id, people.Count, staffing.DirectCount(id), head is { } h ? staffing.Chart.Card(h) : null,
                    staffing.OpenRolesIn(id).Count);
            })
            .ToList();
        return Result.Success(new OrganizationStaffingDto(request.AsOf, first, units));
    }
}

public sealed class OrganizationUnitPeopleQueryHandler(
    CoreHRDbContext dbContext,
    ITenantSettingsReadService tenantSettings) : IQueryHandler<OrganizationUnitPeopleQuery, Result<OrganizationUnitPeopleDto>>
{
    public async Task<Result<OrganizationUnitPeopleDto>> Handle(OrganizationUnitPeopleQuery request, CancellationToken cancellationToken)
    {
        var staffing = await UnitStaffing.LoadAsync(dbContext, tenantSettings, request.AsOf, request.HrAudience, cancellationToken);
        if (!staffing.UnitIds.Contains(request.UnitId))
            return Result.Failure<OrganizationUnitPeopleDto>(new Error(OrganizationStaffingErrors.UnitNotFoundCode, "No unit has this id."));

        var people = staffing.PeopleIn(request.UnitId);
        var head = staffing.HeadOf(request.UnitId, people);
        var cards = people.Select(staffing.Chart.Card).OrderBy(p => p.DisplayName, StringComparer.Ordinal).ToList();
        var roles = staffing.OpenRolesIn(request.UnitId)
            .Where(role => staffing.Chart.KeyOf.ContainsKey(role.ManagerEmployeeId))
            .Select(role => OrgChartOpenRoleDto.From(role, staffing.Chart.KeyOf[role.ManagerEmployeeId], staffing.Chart.Units.GetValueOrDefault(role.OrgUnitId)))
            .ToList();
        return Result.Success(new OrganizationUnitPeopleDto(request.UnitId, request.AsOf, head is { } h ? staffing.Chart.Card(h) : null, cards, roles));
    }
}

/// <summary>The whole company's chart on a date, read per unit: who is placed where, each unit's subtree, its open roles.</summary>
internal sealed class UnitStaffing
{
    private readonly Dictionary<Guid, List<Guid>> childrenOf;
    private readonly ILookup<Guid, Guid> placedIn;
    private readonly ILookup<Guid, OpenRole> rolesIn;
    private readonly Dictionary<Guid, HashSet<Guid>> subtrees = [];

    private UnitStaffing(OrgChartSnapshot chart, HashSet<Guid> unitIds, Dictionary<Guid, List<Guid>> childrenOf, IReadOnlyList<OpenRole> roles)
    {
        Chart = chart;
        UnitIds = unitIds;
        this.childrenOf = childrenOf;
        placedIn = chart.Visible.Select(id => (Id: id, Unit: chart.UnitOf(id)))
            .Where(item => item.Unit is not null)
            .ToLookup(item => item.Unit!.Id, item => item.Id);
        rolesIn = roles.ToLookup(role => role.OrgUnitId);
    }

    public OrgChartSnapshot Chart { get; }
    public HashSet<Guid> UnitIds { get; }

    public static async Task<UnitStaffing> LoadAsync(
        CoreHRDbContext dbContext, ITenantSettingsReadService tenantSettings, DateOnly asOf, bool hr, CancellationToken cancellationToken)
    {
        // Every read runs inside the tenant query filter; the whole company, as the Tenant-scope chart reads it.
        var chart = await OrgChartSnapshot.LoadAsync(dbContext, tenantSettings, asOf, OrgChartScopes.Tenant, null, hr, cancellationToken);

        // Each unit's parent on the date, as the chart reads units (a unit not yet established reads as its first state).
        var states = (await OrgChartQueryHandler.LoadUnitStatesAsync(dbContext, asOf, cancellationToken))
            .GroupBy(s => s.OrgUnitId)
            .Select(g => g.Where(s => s.EffectiveFrom <= asOf).OrderByDescending(s => s.EffectiveFrom).FirstOrDefault()
                ?? g.OrderBy(s => s.EffectiveFrom).First())
            .ToList();
        var unitIds = states.Select(s => s.OrgUnitId).ToHashSet();
        var childrenOf = states.Where(s => s.ParentOrgUnitId is { } parent && unitIds.Contains(parent))
            .GroupBy(s => s.ParentOrgUnitId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(s => s.OrgUnitId).ToList());

        // Open roles are a plan, not history: from today on only, open ones for everyone and on-hold ones for HR.
        List<OpenRole> roles = [];
        if (asOf >= DateOnly.FromDateTime(DateTime.UtcNow))
            roles = await dbContext.OpenRoles.AsNoTracking()
                .Where(role => role.Status == OpenRoleStatus.Open || hr && role.Status == OpenRoleStatus.OnHold)
                .OrderBy(role => role.CreatedAt)
                .ToListAsync(cancellationToken);

        return new UnitStaffing(chart, unitIds, childrenOf, roles);
    }

    /// <summary>The unit and every unit under it.</summary>
    public HashSet<Guid> Subtree(Guid unit)
    {
        if (subtrees.TryGetValue(unit, out var known)) return known;
        var set = new HashSet<Guid>();
        var stack = new Stack<Guid>([unit]);
        while (stack.Count > 0)
        {
            var id = stack.Pop();
            if (!set.Add(id)) continue; // a cycle in bad data counts once, never loops
            foreach (var child in childrenOf.GetValueOrDefault(id) ?? []) stack.Push(child);
        }
        return subtrees[unit] = set;
    }

    public List<Guid> PeopleIn(Guid unit) => Subtree(unit).SelectMany(id => placedIn[id]).ToList();

    public int DirectCount(Guid unit) => placedIn[unit].Count();

    public List<OpenRole> OpenRolesIn(Guid unit) => Subtree(unit).SelectMany(id => rolesIn[id]).ToList();

    /// <summary>Whoever in the unit reports outside it (or to nobody), leading the most people when several do.</summary>
    public Guid? HeadOf(Guid unit, IReadOnlyCollection<Guid> people)
    {
        var inside = people.ToHashSet();
        return people
            .Where(id => !inside.Contains(Chart.ManagerOf.GetValueOrDefault(id)))
            .OrderByDescending(Chart.Total)
            .ThenBy(id => Chart.KeyOf[id], StringComparer.Ordinal)
            .Select(id => (Guid?)id)
            .FirstOrDefault();
    }
}
