using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Catalog;

/// <summary>
/// What every write path uses to turn a job, place or list value id into the company's own object. A retired one
/// can't be picked for something new, but what someone already holds stays theirs (<c>current</c>).
/// </summary>
public sealed class CatalogReferences(CoreHRDbContext dbContext, ITenantContext tenantContext)
{
    public async Task<Result<Job>> JobAsync(Guid jobId, Guid? currentJobId, CancellationToken cancellationToken)
    {
        var job = jobId == Guid.Empty ? null : await dbContext.Jobs.FindAsync([jobId], cancellationToken);
        if (job is null || job.TenantId != tenantContext.TenantId)
            return Result.Failure<Job>(Error.Validation("Job.NotFound", "Pick a job from the company's jobs."));
        if (job.IsRetired && job.Id != currentJobId)
            return Result.Failure<Job>(Error.Validation("Job.Retired", $"{job.Title} is retired. Pick another job."));
        return Result.Success(job);
    }

    public async Task<Result<Place?>> PlaceAsync(Guid? placeId, Guid? currentPlaceId, CancellationToken cancellationToken)
    {
        if (placeId is null) return Result.Success<Place?>(null);
        var place = await dbContext.Places.FindAsync([placeId.Value], cancellationToken);
        if (place is null || place.TenantId != tenantContext.TenantId)
            return Result.Failure<Place?>(Error.Validation("Place.NotFound", "Pick a place from the company's places."));
        if (place.IsRetired && place.Id != currentPlaceId)
            return Result.Failure<Place?>(Error.Validation("Place.Retired", $"{place.Name} is retired. Pick another place."));
        return Result.Success<Place?>(place);
    }

    public async Task<Result<CompanyListValue?>> ListValueAsync(
        CompanyList list, Guid? valueId, Guid? currentValueId, CancellationToken cancellationToken)
    {
        if (valueId is null) return Result.Success<CompanyListValue?>(null);
        var value = await dbContext.CompanyListValues.FindAsync([valueId.Value], cancellationToken);
        if (value is null || value.TenantId != tenantContext.TenantId || value.List != list)
            return Result.Failure<CompanyListValue?>(Error.Validation("ListValue.NotFound", "Pick a value from the company's list."));
        if (value.IsRetired && value.Id != currentValueId)
            return Result.Failure<CompanyListValue?>(Error.Validation("ListValue.Retired", $"{value.Label} is retired. Pick another value."));
        return Result.Success<CompanyListValue?>(value);
    }

    /// <summary>
    /// The import's way in until it learns jobs (B-186): the job with this title, or a new one. A retired job with
    /// the title is brought back, since the file says someone holds it. Not saved here; the caller's save does it.
    /// </summary>
    public async Task<Job> JobByTitleAsync(string title, string? actor, CancellationToken cancellationToken)
    {
        var normalized = CatalogName.Normalize(title);
        var job = dbContext.Jobs.Local.FirstOrDefault(item => item.NormalizedTitle == normalized && item.TenantId == tenantContext.TenantId)
            ?? await dbContext.Jobs.FirstOrDefaultAsync(item => item.NormalizedTitle == normalized, cancellationToken);
        if (job is null)
        {
            job = Job.Create(tenantContext.TenantId, title, null, null, actor);
            dbContext.Jobs.Add(job);
        }
        else if (job.IsRetired) job.Restore(actor);
        return job;
    }

    /// <summary>The place with this name, or a new one; like <see cref="JobByTitleAsync"/>.</summary>
    public async Task<Place?> PlaceByNameAsync(string? name, string? actor, CancellationToken cancellationToken)
    {
        var normalized = CatalogName.Normalize(name);
        if (normalized.Length == 0) return null;
        var place = dbContext.Places.Local.FirstOrDefault(item => item.NormalizedName == normalized && item.TenantId == tenantContext.TenantId)
            ?? await dbContext.Places.FirstOrDefaultAsync(item => item.NormalizedName == normalized, cancellationToken);
        if (place is null)
        {
            place = Place.Create(tenantContext.TenantId, name!, null, null, actor);
            dbContext.Places.Add(place);
        }
        else if (place.IsRetired) place.Restore(actor);
        return place;
    }
}
