using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Catalog;

/// <summary>
/// The company's jobs and places: listing with who holds them, add, edit, retire, delete when never used, and merge.
/// A rename or merge rewrites the display copies on assignments and open roles in the same save, so every reader
/// sees the catalogue's current name. Every change is recorded in Change history.
/// </summary>
public sealed class JobCatalogService(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    CompanyListService lists,
    ISettingsAuditService audit)
{
    public const string JobsAuditSection = "jobs";
    public const string PlacesAuditSection = "places";

    private static DateTime Today => DateTime.UtcNow.Date;

    // --- Jobs -------------------------------------------------------------------------------------

    public async Task<IReadOnlyList<JobDto>> GetJobsAsync(CancellationToken cancellationToken)
    {
        await lists.EnsureSeededAsync(cancellationToken);
        var jobs = await dbContext.Jobs.AsNoTracking().OrderBy(job => job.Title).ToListAsync(cancellationToken);
        var values = await dbContext.CompanyListValues.AsNoTracking()
            .Where(value => value.List == CompanyList.Levels || value.List == CompanyList.JobFamilies)
            .ToDictionaryAsync(value => value.Id, cancellationToken);
        var today = Today;
        var holders = await dbContext.WorkAssignments.AsNoTracking()
            .Where(item => item.IsPrimary && item.EffectiveFrom <= today && (item.EffectiveTo == null || today < item.EffectiveTo))
            .GroupBy(item => item.JobId)
            .Select(group => new { group.Key, Count = group.Select(item => item.EmployeeId).Distinct().Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        var everUsed = (await dbContext.WorkAssignments.AsNoTracking().Select(item => item.JobId).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var roles = await OpenRoleCountsAsync(role => role.JobId, cancellationToken);
        var anyRole = (await dbContext.OpenRoles.AsNoTracking().Select(role => role.JobId).Distinct().ToListAsync(cancellationToken)).ToHashSet();

        return jobs.Select(job => new JobDto(
            job.Id,
            job.Title,
            Ref(job.FamilyId, values),
            Ref(job.LevelId, values),
            job.IsRetired,
            holders.GetValueOrDefault(job.Id),
            roles.GetValueOrDefault(job.Id),
            everUsed.Contains(job.Id) || anyRole.Contains(job.Id))).ToList();
    }

    public async Task<JobDto> CreateJobAsync(JobRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var (family, level) = await ClassificationAsync(request, null, cancellationToken);
        await EnsureJobTitleFreeAsync(request.Title, null, cancellationToken);
        var job = Job.Create(tenantContext.TenantId, request.Title, family, level, Actor(user));
        dbContext.Jobs.Add(job);
        await audit.RecordAsync(JobsAuditSection, "Create", "Job", job.Id.ToString(), $"Added the job {job.Title}.",
            null, null, user, cancellationToken);
        return await JobAsync(job.Id, cancellationToken);
    }

    public async Task<JobDto> UpdateJobAsync(Guid id, JobRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var job = await FindJobAsync(id, cancellationToken);
        var oldTitle = job.Title;
        var (family, level) = await ClassificationAsync(request, job, cancellationToken);
        await EnsureJobTitleFreeAsync(request.Title, job.Id, cancellationToken);
        var renamed = CatalogName.Clean(request.Title) != job.Title;
        job.Update(request.Title, family, level, Actor(user));
        if (renamed) await ReflectJobAsync(job, job.Id, cancellationToken);
        await audit.RecordAsync(JobsAuditSection, "Update", "Job", job.Id.ToString(),
            renamed ? $"Renamed the job {oldTitle} to {job.Title}." : $"Changed the job {job.Title}.",
            null, null, user, cancellationToken);
        return await JobAsync(job.Id, cancellationToken);
    }

    public async Task<JobDto> SetJobRetiredAsync(Guid id, bool retired, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var job = await FindJobAsync(id, cancellationToken);
        if (job.IsRetired == retired) return await JobAsync(job.Id, cancellationToken);
        if (retired) job.Retire(Actor(user)); else job.Restore(Actor(user));
        await audit.RecordAsync(JobsAuditSection, retired ? "Retire" : "Restore", "Job", job.Id.ToString(),
            retired ? $"Retired the job {job.Title}." : $"Brought back the job {job.Title}.", null, null, user, cancellationToken);
        return await JobAsync(job.Id, cancellationToken);
    }

    public async Task DeleteJobAsync(Guid id, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var job = await FindJobAsync(id, cancellationToken);
        if (await dbContext.WorkAssignments.AnyAsync(item => item.JobId == id, cancellationToken)
            || await dbContext.OpenRoles.AnyAsync(role => role.JobId == id, cancellationToken))
            throw new CatalogConflictException($"{job.Title} is used, so it can't be deleted. Retire it or merge it into another job.");
        dbContext.Jobs.Remove(job);
        await audit.RecordAsync(JobsAuditSection, "Delete", "Job", job.Id.ToString(), $"Deleted the job {job.Title}.",
            null, null, user, cancellationToken);
    }

    /// <summary>A catalogue correction: everyone and every open role on <paramref name="id"/> moves to the kept job.</summary>
    public async Task<JobDto> MergeJobAsync(Guid id, MergeRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        if (id == request.IntoId)
            throw new CatalogConflictException("A job can't be merged into itself.");
        var source = await FindJobAsync(id, cancellationToken);
        var target = await FindJobAsync(request.IntoId, cancellationToken);
        if (target.IsRetired)
            throw new CatalogConflictException($"{target.Title} is retired. Bring it back before merging into it.");

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;
        var moved = await ReflectJobAsync(target, source.Id, cancellationToken);
        // The rows must point at the kept job before the merged one goes, or the foreign key refuses the delete.
        await dbContext.SaveChangesAsync(cancellationToken);
        dbContext.Jobs.Remove(source);
        await audit.RecordAsync(JobsAuditSection, "Merge", "Job", target.Id.ToString(),
            $"Merged the job {source.Title} into {target.Title} ({moved} {(moved == 1 ? "record" : "records")} moved).",
            null, null, user, cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return await JobAsync(target.Id, cancellationToken);
    }

    // --- Places -----------------------------------------------------------------------------------

    public async Task<IReadOnlyList<PlaceDto>> GetPlacesAsync(CancellationToken cancellationToken)
    {
        var places = await dbContext.Places.AsNoTracking().OrderBy(place => place.Name).ToListAsync(cancellationToken);
        var today = Today;
        var holders = await dbContext.WorkAssignments.AsNoTracking()
            .Where(item => item.PlaceId != null && item.IsPrimary && item.EffectiveFrom <= today && (item.EffectiveTo == null || today < item.EffectiveTo))
            .GroupBy(item => item.PlaceId!.Value)
            .Select(group => new { group.Key, Count = group.Select(item => item.EmployeeId).Distinct().Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        var everUsed = (await dbContext.WorkAssignments.AsNoTracking().Where(item => item.PlaceId != null)
            .Select(item => item.PlaceId!.Value).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var roleRows = await dbContext.OpenRoles.AsNoTracking().Where(role => role.PlaceId != null)
            .Select(role => new { PlaceId = role.PlaceId!.Value, role.Status }).ToListAsync(cancellationToken);
        var roles = roleRows.Where(role => role.Status is OpenRoleStatus.Open or OpenRoleStatus.OnHold)
            .GroupBy(role => role.PlaceId).ToDictionary(group => group.Key, group => group.Count());

        return places.Select(place => new PlaceDto(
            place.Id, place.Name, place.City, place.Country, place.IsRetired,
            holders.GetValueOrDefault(place.Id), roles.GetValueOrDefault(place.Id),
            everUsed.Contains(place.Id) || roleRows.Any(role => role.PlaceId == place.Id))).ToList();
    }

    public async Task<PlaceDto> CreatePlaceAsync(PlaceRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        await EnsurePlaceNameFreeAsync(request.Name, null, cancellationToken);
        var place = Place.Create(tenantContext.TenantId, request.Name, request.City, request.Country, Actor(user));
        dbContext.Places.Add(place);
        await audit.RecordAsync(PlacesAuditSection, "Create", "Place", place.Id.ToString(), $"Added the place {place.Name}.",
            null, null, user, cancellationToken);
        return await PlaceAsync(place.Id, cancellationToken);
    }

    public async Task<PlaceDto> UpdatePlaceAsync(Guid id, PlaceRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var place = await FindPlaceAsync(id, cancellationToken);
        var oldName = place.Name;
        await EnsurePlaceNameFreeAsync(request.Name, place.Id, cancellationToken);
        var renamed = CatalogName.Clean(request.Name) != place.Name;
        place.Update(request.Name, request.City, request.Country, Actor(user));
        if (renamed) await ReflectPlaceAsync(place, place.Id, cancellationToken);
        await audit.RecordAsync(PlacesAuditSection, "Update", "Place", place.Id.ToString(),
            renamed ? $"Renamed the place {oldName} to {place.Name}." : $"Changed the place {place.Name}.",
            null, null, user, cancellationToken);
        return await PlaceAsync(place.Id, cancellationToken);
    }

    public async Task<PlaceDto> SetPlaceRetiredAsync(Guid id, bool retired, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var place = await FindPlaceAsync(id, cancellationToken);
        if (place.IsRetired == retired) return await PlaceAsync(place.Id, cancellationToken);
        if (retired) place.Retire(Actor(user)); else place.Restore(Actor(user));
        await audit.RecordAsync(PlacesAuditSection, retired ? "Retire" : "Restore", "Place", place.Id.ToString(),
            retired ? $"Retired the place {place.Name}." : $"Brought back the place {place.Name}.", null, null, user, cancellationToken);
        return await PlaceAsync(place.Id, cancellationToken);
    }

    public async Task DeletePlaceAsync(Guid id, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var place = await FindPlaceAsync(id, cancellationToken);
        if (await dbContext.WorkAssignments.AnyAsync(item => item.PlaceId == id, cancellationToken)
            || await dbContext.OpenRoles.AnyAsync(role => role.PlaceId == id, cancellationToken))
            throw new CatalogConflictException($"{place.Name} is used, so it can't be deleted. Retire it or merge it into another place.");
        dbContext.Places.Remove(place);
        await audit.RecordAsync(PlacesAuditSection, "Delete", "Place", place.Id.ToString(), $"Deleted the place {place.Name}.",
            null, null, user, cancellationToken);
    }

    public async Task<PlaceDto> MergePlaceAsync(Guid id, MergeRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        if (id == request.IntoId)
            throw new CatalogConflictException("A place can't be merged into itself.");
        var source = await FindPlaceAsync(id, cancellationToken);
        var target = await FindPlaceAsync(request.IntoId, cancellationToken);
        if (target.IsRetired)
            throw new CatalogConflictException($"{target.Name} is retired. Bring it back before merging into it.");

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;
        var moved = await ReflectPlaceAsync(target, source.Id, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        dbContext.Places.Remove(source);
        await audit.RecordAsync(PlacesAuditSection, "Merge", "Place", target.Id.ToString(),
            $"Merged the place {source.Name} into {target.Name} ({moved} {(moved == 1 ? "record" : "records")} moved).",
            null, null, user, cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return await PlaceAsync(target.Id, cancellationToken);
    }

    // --- Helpers ----------------------------------------------------------------------------------

    private async Task<JobDto> JobAsync(Guid id, CancellationToken cancellationToken)
        => (await GetJobsAsync(cancellationToken)).Single(job => job.Id == id);

    private async Task<PlaceDto> PlaceAsync(Guid id, CancellationToken cancellationToken)
        => (await GetPlacesAsync(cancellationToken)).Single(place => place.Id == id);

    private async Task<Job> FindJobAsync(Guid id, CancellationToken cancellationToken)
        => await dbContext.Jobs.FirstOrDefaultAsync(job => job.Id == id, cancellationToken)
            ?? throw new EntityNotFoundException("Job", id);

    private async Task<Place> FindPlaceAsync(Guid id, CancellationToken cancellationToken)
        => await dbContext.Places.FirstOrDefaultAsync(place => place.Id == id, cancellationToken)
            ?? throw new EntityNotFoundException("Place", id);

    /// <summary>Points every assignment and open role on <paramref name="fromJobId"/> at <paramref name="job"/>.</summary>
    private async Task<int> ReflectJobAsync(Job job, Guid fromJobId, CancellationToken cancellationToken)
    {
        var assignments = await dbContext.WorkAssignments.Where(item => item.JobId == fromJobId).ToListAsync(cancellationToken);
        assignments.ForEach(item => item.ReflectJob(job));
        var roles = await dbContext.OpenRoles.Where(role => role.JobId == fromJobId).ToListAsync(cancellationToken);
        roles.ForEach(role => role.ReflectJob(job));
        return assignments.Count + roles.Count;
    }

    private async Task<int> ReflectPlaceAsync(Place place, Guid fromPlaceId, CancellationToken cancellationToken)
    {
        var assignments = await dbContext.WorkAssignments.Where(item => item.PlaceId == fromPlaceId).ToListAsync(cancellationToken);
        assignments.ForEach(item => item.ReflectPlace(place));
        var roles = await dbContext.OpenRoles.Where(role => role.PlaceId == fromPlaceId).ToListAsync(cancellationToken);
        roles.ForEach(role => role.ReflectPlace(place));
        return assignments.Count + roles.Count;
    }

    private async Task<(CompanyListValue? Family, CompanyListValue? Level)> ClassificationAsync(
        JobRequest request, Job? current, CancellationToken cancellationToken)
    {
        var references = new CatalogReferences(dbContext, tenantContext);
        var family = await references.ListValueAsync(CompanyList.JobFamilies, request.FamilyId, current?.FamilyId, cancellationToken);
        if (family.IsFailure) throw new ArgumentException(family.Error.Message);
        var level = await references.ListValueAsync(CompanyList.Levels, request.LevelId, current?.LevelId, cancellationToken);
        if (level.IsFailure) throw new ArgumentException(level.Error.Message);
        return (family.Value, level.Value);
    }

    private async Task EnsureJobTitleFreeAsync(string title, Guid? except, CancellationToken cancellationToken)
    {
        var normalized = CatalogName.Normalize(title);
        if (await dbContext.Jobs.AnyAsync(job => job.NormalizedTitle == normalized && job.Id != except, cancellationToken))
            throw new DuplicateEntityException("Job", "title", CatalogName.Clean(title));
    }

    private async Task EnsurePlaceNameFreeAsync(string name, Guid? except, CancellationToken cancellationToken)
    {
        var normalized = CatalogName.Normalize(name);
        if (await dbContext.Places.AnyAsync(place => place.NormalizedName == normalized && place.Id != except, cancellationToken))
            throw new DuplicateEntityException("Place", "name", CatalogName.Clean(name));
    }

    private async Task<Dictionary<Guid, int>> OpenRoleCountsAsync(
        System.Linq.Expressions.Expression<Func<OpenRole, Guid>> key, CancellationToken cancellationToken)
        => await dbContext.OpenRoles.AsNoTracking()
            .Where(role => role.Status == OpenRoleStatus.Open || role.Status == OpenRoleStatus.OnHold)
            .GroupBy(key)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);

    private static CatalogValueRefDto? Ref(Guid? id, IReadOnlyDictionary<Guid, CompanyListValue> values)
        => id is { } valueId && values.TryGetValue(valueId, out var value) ? new CatalogValueRefDto(value.Id, value.Label, value.IsRetired) : null;

    internal static string Actor(ClaimsPrincipal user)
    {
        var id = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var name = user.FindFirstValue(CustomClaimTypes.FullName) ?? user.FindFirstValue(ClaimTypes.Email) ?? "Unknown user";
        return $"{id}|{name}";
    }
}
