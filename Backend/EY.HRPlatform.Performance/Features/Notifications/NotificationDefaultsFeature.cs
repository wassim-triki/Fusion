using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Notifications;

public sealed record GetNotificationDefaultsQuery : IQuery<Result<NotificationDefaultsDto>>;

public sealed record UpdateNotificationDefaultsCommand(UpdateNotificationDefaultsRequest Request) : ICommand<Result<NotificationDefaultsDto>>;

internal static class NotificationDefaultsMapper
{
    public static NotificationDefaultsDto ToDto(NotificationDefaults? defaults)
        => new(NotificationGroups.All.Select(group =>
        {
            var (label, summary) = NotificationPreferenceCatalog.Describe(group);
            return new NotificationDefaultGroupDto(group, label, summary,
                NotificationEmailModes.Name(NotificationDefaults.ModeOf(defaults, group)),
                NotificationEmailModes.Name(NotificationGroups.FusionDefault(group)));
        }).ToList(), defaults?.Version ?? 0);
}

public sealed class GetNotificationDefaultsHandler(PerformanceDbContext db)
    : IQueryHandler<GetNotificationDefaultsQuery, Result<NotificationDefaultsDto>>
{
    public async Task<Result<NotificationDefaultsDto>> Handle(GetNotificationDefaultsQuery query, CancellationToken token)
        => NotificationDefaultsMapper.ToDto(await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(token));
}

/// <summary>Sets the company's email mode per group (B-002 N7). People's own choices are kept and read against the new modes.</summary>
public sealed class UpdateNotificationDefaultsHandler(PerformanceDbContext db, ITenantContext tenant, IPerformanceAudit audit)
    : ICommandHandler<UpdateNotificationDefaultsCommand, Result<NotificationDefaultsDto>>
{
    public async Task<Result<NotificationDefaultsDto>> Handle(UpdateNotificationDefaultsCommand command, CancellationToken token)
    {
        var modes = new Dictionary<string, NotificationEmailMode>(StringComparer.Ordinal);
        foreach (var (group, value) in command.Request.Modes ?? new Dictionary<string, string>())
        {
            if (!NotificationGroups.All.Contains(group) || NotificationEmailModes.Parse(value) is not { } mode)
                return Result.Failure<NotificationDefaultsDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.NotificationDefaultsInvalid,
                    "Each Performance notification group is required, on or off."));
            modes[group] = mode;
        }

        var defaults = await db.NotificationDefaults.FirstOrDefaultAsync(token);
        if (defaults is null)
        {
            if (command.Request.ExpectedVersion != 0) return Result.Failure<NotificationDefaultsDto>(PerformanceErrors.Changed());
            defaults = NotificationDefaults.For(tenant.TenantId);
            db.NotificationDefaults.Add(defaults);
        }
        else if (VersionGuard.Check(defaults, command.Request.ExpectedVersion) is { } stale)
        {
            return Result.Failure<NotificationDefaultsDto>(stale);
        }

        var before = NotificationDefaultsMapper.ToDto(defaults).Groups.ToDictionary(group => group.Key, group => group.Mode);
        defaults.Set(modes);
        var after = NotificationDefaultsMapper.ToDto(defaults).Groups.ToDictionary(group => group.Key, group => group.Mode);
        if (!before.SequenceEqual(after))
        {
            audit.Record(tenant.TenantId, "NotificationDefaults", defaults.Id, null, PerformanceAuditActions.NotificationDefaultsChanged,
                new { before, after });
        }
        await db.SaveChangesAsync(token);
        return NotificationDefaultsMapper.ToDto(defaults);
    }
}
