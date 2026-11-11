using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Conversations;

public sealed record CompanyValueDto(Guid Id, string Name);
public sealed record CompanyValueRequest(string Name);

/// <summary>The company's values in their order; a company that never had any gets the starters first (D-36).</summary>
public sealed record ListCompanyValuesQuery : IQuery<Result<IReadOnlyList<CompanyValueDto>>>;
public sealed record AddCompanyValueCommand(CompanyValueRequest Request) : ICommand<Result<IReadOnlyList<CompanyValueDto>>>;
public sealed record RenameCompanyValueCommand(Guid Id, CompanyValueRequest Request) : ICommand<Result<IReadOnlyList<CompanyValueDto>>>;
public sealed record RemoveCompanyValueCommand(Guid Id) : ICommand<Result<IReadOnlyList<CompanyValueDto>>>;

public static class CompanyValues
{
    /// <summary>
    /// The active values in order. A company with no values at all, removed ones included, gets the starters, so a
    /// company that removes every value isn't handed them back.
    /// </summary>
    public static async Task<IReadOnlyList<CompanyValue>> ActiveAsync(PerformanceDbContext db, Guid tenantId, CancellationToken token)
    {
        if (!await db.CompanyValues.AnyAsync(token) && tenantId != Guid.Empty)
        {
            db.CompanyValues.AddRange(CompanyValue.Starters.Select((name, index) => CompanyValue.Create(tenantId, name, index)));
            try { await db.SaveChangesAsync(token); }
            catch (DbUpdateException) { db.ChangeTracker.Clear(); /* A concurrent first read already added them. */ }
        }
        return await db.CompanyValues.AsNoTracking().Where(v => v.RemovedAt == null).OrderBy(v => v.Position).ThenBy(v => v.Name).ToListAsync(token);
    }

    public static async Task<IReadOnlyList<CompanyValueDto>> ListAsync(PerformanceDbContext db, Guid tenantId, CancellationToken token)
        => (await ActiveAsync(db, tenantId, token)).Select(v => new CompanyValueDto(v.Id, v.Name)).ToList();

    /// <summary>Every value's name by id, removed ones included: praise keeps the name it was given under.</summary>
    public static Task<Dictionary<Guid, string>> NamesAsync(PerformanceDbContext db, IEnumerable<Guid> ids, CancellationToken token)
    {
        var wanted = ids.Distinct().ToList();
        return db.CompanyValues.AsNoTracking().Where(v => wanted.Contains(v.Id)).ToDictionaryAsync(v => v.Id, v => v.Name, token);
    }

    public const string Fallback = "A company value";

    internal static Result<IReadOnlyList<CompanyValueDto>> Invalid(string message)
        => Result.Failure<IReadOnlyList<CompanyValueDto>>(PerformanceErrors.Validation("Value.Invalid", message));
}

public sealed class ListCompanyValuesHandler(PerformanceDbContext db, ITenantContext tenant)
    : IQueryHandler<ListCompanyValuesQuery, Result<IReadOnlyList<CompanyValueDto>>>
{
    public async Task<Result<IReadOnlyList<CompanyValueDto>>> Handle(ListCompanyValuesQuery query, CancellationToken token)
        => Result.Success(await CompanyValues.ListAsync(db, tenant.TenantId, token));
}

public sealed class AddCompanyValueHandler(PerformanceDbContext db, ITenantContext tenant, IPerformanceAudit audit)
    : ICommandHandler<AddCompanyValueCommand, Result<IReadOnlyList<CompanyValueDto>>>
{
    public async Task<Result<IReadOnlyList<CompanyValueDto>>> Handle(AddCompanyValueCommand command, CancellationToken token)
    {
        var active = await CompanyValues.ActiveAsync(db, tenant.TenantId, token);
        if (active.Count >= CompanyValue.MaxActive) return CompanyValues.Invalid($"Keep the list to {CompanyValue.MaxActive} values.");
        var name = command.Request.Name?.Trim() ?? string.Empty;
        var key = CompanyValue.Key(name);
        if (active.Any(v => v.NameKey == key)) return CompanyValues.Invalid("That value is already on the list.");
        var position = active.Count == 0 ? 0 : active.Max(v => v.Position) + 1;

        // A removed value with the same name comes back, so its praise counts with it again.
        var removed = await db.CompanyValues.FirstOrDefaultAsync(v => v.RemovedAt != null && v.NameKey == key, token);
        CompanyValue value;
        try
        {
            if (removed is not null) { removed.Restore(position); removed.Rename(name); value = removed; }
            else { value = CompanyValue.Create(tenant.TenantId, name, position); db.CompanyValues.Add(value); }
        }
        catch (ArgumentException ex) { return CompanyValues.Invalid(ex.Message); }
        audit.Record(tenant.TenantId, "Value", value.Id, null, PerformanceAuditActions.ValueAdded, new { value.Name });
        try { await db.SaveChangesAsync(token); }
        catch (DbUpdateException) { return CompanyValues.Invalid("That value is already on the list."); }
        return Result.Success(await CompanyValues.ListAsync(db, tenant.TenantId, token));
    }
}

public sealed class RenameCompanyValueHandler(PerformanceDbContext db, ITenantContext tenant, IPerformanceAudit audit)
    : ICommandHandler<RenameCompanyValueCommand, Result<IReadOnlyList<CompanyValueDto>>>
{
    public async Task<Result<IReadOnlyList<CompanyValueDto>>> Handle(RenameCompanyValueCommand command, CancellationToken token)
    {
        var value = await db.CompanyValues.FirstOrDefaultAsync(v => v.Id == command.Id && v.RemovedAt == null, token);
        if (value is null) return Result.Failure<IReadOnlyList<CompanyValueDto>>(PerformanceErrors.NotFound("Value", command.Id));
        var before = value.Name;
        var key = CompanyValue.Key(command.Request.Name ?? string.Empty);
        if (await db.CompanyValues.AnyAsync(v => v.Id != value.Id && v.RemovedAt == null && v.NameKey == key, token))
            return CompanyValues.Invalid("That value is already on the list.");
        try { value.Rename(command.Request.Name ?? string.Empty); }
        catch (ArgumentException ex) { return CompanyValues.Invalid(ex.Message); }
        audit.Record(tenant.TenantId, "Value", value.Id, null, PerformanceAuditActions.ValueRenamed, new { before, after = value.Name });
        await db.SaveChangesAsync(token);
        return Result.Success(await CompanyValues.ListAsync(db, tenant.TenantId, token));
    }
}

public sealed class RemoveCompanyValueHandler(PerformanceDbContext db, ITenantContext tenant, IPerformanceAudit audit)
    : ICommandHandler<RemoveCompanyValueCommand, Result<IReadOnlyList<CompanyValueDto>>>
{
    public async Task<Result<IReadOnlyList<CompanyValueDto>>> Handle(RemoveCompanyValueCommand command, CancellationToken token)
    {
        var value = await db.CompanyValues.FirstOrDefaultAsync(v => v.Id == command.Id, token);
        if (value is null) return Result.Failure<IReadOnlyList<CompanyValueDto>>(PerformanceErrors.NotFound("Value", command.Id));
        if (value.Remove(PerformanceClock.UtcNow))
        {
            audit.Record(tenant.TenantId, "Value", value.Id, null, PerformanceAuditActions.ValueRemoved, new { value.Name });
            await db.SaveChangesAsync(token);
        }
        return Result.Success(await CompanyValues.ListAsync(db, tenant.TenantId, token));
    }
}
