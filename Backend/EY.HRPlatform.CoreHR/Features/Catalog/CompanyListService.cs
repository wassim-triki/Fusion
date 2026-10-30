using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Catalog;

/// <summary>
/// The company's lists (Settings › Lists): read with what uses each value, add, rename, reorder, retire, bring
/// back, and delete a value nothing ever used. A company gets the defaults once, the first time its lists are read.
/// </summary>
public sealed class CompanyListService(CoreHRDbContext dbContext, ITenantContext tenantContext, ISettingsAuditService audit)
{
    public const string AuditSection = "lists";

    public async Task<IReadOnlyList<CompanyListDto>> GetAllAsync(CancellationToken cancellationToken)
    {
        await EnsureSeededAsync(cancellationToken);
        var values = await dbContext.CompanyListValues.AsNoTracking().ToListAsync(cancellationToken);
        var usage = await UsageAsync(cancellationToken);
        return CompanyLists.ById
            .Select(pair => new CompanyListDto(pair.Key, values
                .Where(value => value.List == pair.Value)
                .OrderBy(value => value.SortOrder).ThenBy(value => value.Label)
                .Select(value => Project(value, usage))
                .ToList()))
            .ToList();
    }

    public async Task<CompanyListValueDto> AddAsync(CompanyList list, ListValueRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        await EnsureSeededAsync(cancellationToken);
        await EnsureLabelFreeAsync(list, request.Label, null, cancellationToken);
        var existing = await dbContext.CompanyListValues.Where(value => value.List == list).ToListAsync(cancellationToken);
        var value = CompanyListValue.Create(tenantContext.TenantId, list, request.Label,
            UniqueKey(CatalogName.Slug(request.Label), existing), existing.Count == 0 ? 0 : existing.Max(item => item.SortOrder) + 1,
            JobCatalogService.Actor(user));
        dbContext.CompanyListValues.Add(value);
        await audit.RecordAsync(AuditSection, "Create", ResourceType(list), value.Id.ToString(),
            $"Added {value.Label} to {Name(list)}.", null, null, user, cancellationToken);
        return await ProjectAsync(value.Id, cancellationToken);
    }

    /// <summary>A new label for the value. The key stays; employment records take the new label in the same save.</summary>
    public async Task<CompanyListValueDto> RenameAsync(CompanyList list, Guid id, ListValueRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var value = await FindAsync(list, id, cancellationToken);
        var oldLabel = value.Label;
        await EnsureLabelFreeAsync(list, request.Label, value.Id, cancellationToken);
        value.Rename(request.Label, JobCatalogService.Actor(user));
        if (list == CompanyList.EmploymentTypes)
        {
            var employments = await dbContext.Employments.Where(item => item.EmploymentTypeId == value.Id).ToListAsync(cancellationToken);
            employments.ForEach(item => item.ReflectEmploymentType(value));
        }
        await audit.RecordAsync(AuditSection, "Update", ResourceType(list), value.Id.ToString(),
            $"Renamed {oldLabel} to {value.Label} in {Name(list)}.", null, null, user, cancellationToken);
        return await ProjectAsync(value.Id, cancellationToken);
    }

    public async Task<IReadOnlyList<CompanyListDto>> ReorderAsync(CompanyList list, ListOrderRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var values = await dbContext.CompanyListValues.Where(value => value.List == list).ToListAsync(cancellationToken);
        var ids = request.ValueIds ?? [];
        if (ids.Count != values.Count || ids.Distinct().Count() != ids.Count || ids.Any(id => values.All(value => value.Id != id)))
            throw new ArgumentException("Send every value of the list once, in the new order.");
        var actor = JobCatalogService.Actor(user);
        for (var index = 0; index < ids.Count; index++)
            values.Single(value => value.Id == ids[index]).MoveTo(index, actor);
        await audit.RecordAsync(AuditSection, "Reorder", ResourceType(list), null, $"Reordered {Name(list)}.", null, null, user, cancellationToken);
        return await GetAllAsync(cancellationToken);
    }

    public async Task<CompanyListValueDto> SetRetiredAsync(CompanyList list, Guid id, bool retired, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var value = await FindAsync(list, id, cancellationToken);
        if (value.IsRetired == retired) return await ProjectAsync(value.Id, cancellationToken);
        if (retired) value.Retire(JobCatalogService.Actor(user)); else value.Restore(JobCatalogService.Actor(user));
        await audit.RecordAsync(AuditSection, retired ? "Retire" : "Restore", ResourceType(list), value.Id.ToString(),
            retired ? $"Retired {value.Label} in {Name(list)}." : $"Brought back {value.Label} in {Name(list)}.",
            null, null, user, cancellationToken);
        return await ProjectAsync(value.Id, cancellationToken);
    }

    /// <summary>Only a value nothing ever used goes; one in use is retired instead, so history keeps its words.</summary>
    public async Task DeleteAsync(CompanyList list, Guid id, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var value = await FindAsync(list, id, cancellationToken);
        var usage = await UsageAsync(cancellationToken);
        if (usage.InUse.Contains(value.Id))
            throw new CatalogConflictException($"{value.Label} is used, so it can't be deleted. Retire it instead.");
        dbContext.CompanyListValues.Remove(value);
        await audit.RecordAsync(AuditSection, "Delete", ResourceType(list), value.Id.ToString(),
            $"Deleted {value.Label} from {Name(list)}.", null, null, user, cancellationToken);
    }

    /// <summary>
    /// Gives the company its default values once. The seed marker, not the values, says it happened, so emptying a
    /// list never brings the defaults back. Two first reads at once: the second one's insert fails and it moves on.
    /// </summary>
    public async Task EnsureSeededAsync(CancellationToken cancellationToken)
    {
        if (await dbContext.CompanyListSeeds.AnyAsync(cancellationToken)) return;

        var existing = await dbContext.CompanyListValues.ToListAsync(cancellationToken);
        var added = new List<CompanyListValue>();
        foreach (var (list, labels) in CompanyLists.Defaults)
        {
            var inList = existing.Where(value => value.List == list).ToList();
            var order = inList.Count == 0 ? 0 : inList.Max(value => value.SortOrder) + 1;
            foreach (var label in labels)
            {
                if (inList.Any(value => value.NormalizedLabel == CatalogName.Normalize(label))) continue;
                var value = CompanyListValue.Create(tenantContext.TenantId, list, label, UniqueKey(CatalogName.Slug(label), inList), order++, "Fusion");
                inList.Add(value);
                added.Add(value);
            }
        }
        dbContext.CompanyListValues.AddRange(added);
        var seed = CompanyListSeed.For(tenantContext.TenantId);
        dbContext.CompanyListSeeds.Add(seed);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            foreach (var value in added) dbContext.Entry(value).State = EntityState.Detached;
            dbContext.Entry(seed).State = EntityState.Detached;
        }
    }

    private async Task<CompanyListValue> FindAsync(CompanyList list, Guid id, CancellationToken cancellationToken)
        => await dbContext.CompanyListValues.FirstOrDefaultAsync(value => value.Id == id && value.List == list, cancellationToken)
            ?? throw new EntityNotFoundException("List value", id);

    private async Task<CompanyListValueDto> ProjectAsync(Guid id, CancellationToken cancellationToken)
    {
        var value = await dbContext.CompanyListValues.AsNoTracking().FirstAsync(item => item.Id == id, cancellationToken);
        return Project(value, await UsageAsync(cancellationToken));
    }

    private static CompanyListValueDto Project(CompanyListValue value, Usage usage)
        => new(value.Id, value.Key, value.Label, value.SortOrder, value.IsRetired,
            usage.Counts.GetValueOrDefault(value.Id), usage.InUse.Contains(value.Id));

    private sealed record Usage(Dictionary<Guid, int> Counts, HashSet<Guid> InUse);

    /// <summary>
    /// Jobs per level and family; people employed today per employment type (any employment, past or scheduled,
    /// counts as use). Change reasons and leave types have no users yet: B-179 and B-180 add theirs here.
    /// </summary>
    private async Task<Usage> UsageAsync(CancellationToken cancellationToken)
    {
        var jobs = await dbContext.Jobs.AsNoTracking().Select(job => new { job.FamilyId, job.LevelId }).ToListAsync(cancellationToken);
        var today = DateTime.UtcNow.Date;
        var employments = await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmploymentTypeId != null)
            .Select(item => new { Id = item.EmploymentTypeId!.Value, Now = item.EffectiveFrom <= today && (item.EffectiveTo == null || today < item.EffectiveTo) })
            .ToListAsync(cancellationToken);

        var counts = jobs.SelectMany(job => new[] { job.FamilyId, job.LevelId }).OfType<Guid>()
            .Concat(employments.Where(item => item.Now).Select(item => item.Id))
            .GroupBy(id => id).ToDictionary(group => group.Key, group => group.Count());
        var inUse = counts.Keys.Concat(employments.Select(item => item.Id)).ToHashSet();
        return new Usage(counts, inUse);
    }

    private async Task EnsureLabelFreeAsync(CompanyList list, string label, Guid? except, CancellationToken cancellationToken)
    {
        var normalized = CatalogName.Normalize(label);
        if (await dbContext.CompanyListValues.AnyAsync(value => value.List == list && value.NormalizedLabel == normalized && value.Id != except, cancellationToken))
            throw new DuplicateEntityException("List value", "name", CatalogName.Clean(label));
    }

    private static string UniqueKey(string slug, IReadOnlyCollection<CompanyListValue> inList)
    {
        var key = slug;
        for (var n = 2; inList.Any(value => value.Key == key); n++) key = $"{slug}-{n}";
        return key;
    }

    private static string ResourceType(CompanyList list) => $"List:{CompanyLists.IdOf(list)}";

    private static string Name(CompanyList list) => list switch
    {
        CompanyList.EmploymentTypes => "Employment types",
        CompanyList.Levels => "Levels",
        CompanyList.JobFamilies => "Job families",
        CompanyList.ChangeReasons => "Change reasons",
        CompanyList.LeaveTypes => "Leave types",
        _ => "the list",
    };
}
