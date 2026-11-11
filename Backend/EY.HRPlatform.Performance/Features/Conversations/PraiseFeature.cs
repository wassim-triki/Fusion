using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Conversations;

// ── Contracts ────────────────────────────────────────────────────────────────

public sealed record PraiseReactionDto(PraiseReactionKind Kind, int Count, bool Mine);

public sealed record PraiseDto(
    Guid Id,
    PersonRefDto Author,
    IReadOnlyList<PersonRefDto> Recipients,
    CompanyValueDto Value,
    string Message,
    DateTime GivenAt,
    IReadOnlyList<PraiseReactionDto> Reactions,
    bool CanDelete);

/// <summary>One praise for a drawer or deep link: removed praise answers with no content.</summary>
public sealed record PraiseDetailDto(bool Removed, PraiseDto? Praise);

public sealed record PraisePageDto(IReadOnlyList<PraiseDto> Items, string? Next);

public enum PraiseScope { All = 0, ForMe = 1, ByMe = 2 }

public sealed record GivePraiseRequest(Guid Id, IReadOnlyList<Guid> RecipientEmployeeIds, Guid ValueId, string Message);

public sealed record PraiseActor(Guid EmployeeId, bool IsAdministrator);

public sealed record ListPraiseQuery(PraiseScope Scope, Guid? EmployeeId, string? Before, int Limit, PraiseActor Actor) : IQuery<Result<PraisePageDto>>;
public sealed record GetPraiseQuery(Guid PraiseId, PraiseActor Actor) : IQuery<Result<PraiseDetailDto>>;
public sealed record GivePraiseCommand(GivePraiseRequest Request, PraiseActor Actor) : ICommand<Result<PraiseDto>>;
public sealed record ReactToPraiseCommand(Guid PraiseId, PraiseReactionKind Kind, bool Add, PraiseActor Actor) : ICommand<Result<PraiseDto>>;
public sealed record DeletePraiseCommand(Guid PraiseId, PraiseActor Actor) : ICommand<Result>;

/// <summary>How often a value was named in praise across the company this month.</summary>
public sealed record PraiseValueCountDto(Guid Id, string Name, int Count);

/// <summary>
/// The wall's week (from Monday, UTC) and how much praise it holds; each of the company's values with how often it was
/// named this month; how much praise the caller has received and given.
/// </summary>
public sealed record PraiseSummaryDto(DateOnly WeekStart, int ThisWeek, IReadOnlyList<PraiseValueCountDto> Values, int Received, int Given);

public sealed record GetPraiseSummaryQuery(Guid EmployeeId) : IQuery<Result<PraiseSummaryDto>>;

// ── Projection ───────────────────────────────────────────────────────────────

public sealed class PraiseReader(PerformanceDbContext db)
{
    public async Task<IReadOnlyList<PraiseDto>> ProjectAsync(IReadOnlyList<Praise> items, PraiseActor actor, CancellationToken token)
    {
        if (items.Count == 0) return [];
        var ids = items.Select(p => p.Id).ToList();
        var values = await CompanyValues.NamesAsync(db, items.Select(p => p.ValueId), token);
        var reactions = await db.PraiseReactions.AsNoTracking().Where(r => ids.Contains(r.PraiseId))
            .Select(r => new { r.PraiseId, r.Kind, r.ReactorEmployeeId }).ToListAsync(token);
        var me = actor.EmployeeId;
        return items.Select(p => new PraiseDto(p.Id, new PersonRefDto(p.AuthorEmployeeId, p.AuthorName),
            p.Recipients.OrderBy(r => r.Name).Select(r => new PersonRefDto(r.EmployeeId, r.Name)).ToList(),
            new CompanyValueDto(p.ValueId, values.GetValueOrDefault(p.ValueId) ?? CompanyValues.Fallback), p.Message, p.GivenAt,
            Enum.GetValues<PraiseReactionKind>().Select(kind =>
            {
                var mine = reactions.Where(r => r.PraiseId == p.Id && r.Kind == kind).ToList();
                return new PraiseReactionDto(kind, mine.Count, me != Guid.Empty && mine.Any(r => r.ReactorEmployeeId == me));
            }).ToList(),
            PraisePolicy.CanDelete(p, me, actor.IsAdministrator))).ToList();
    }

    public async Task<PraiseDto?> OneAsync(Guid praiseId, PraiseActor actor, CancellationToken token)
    {
        var praise = await PraisePolicy.Readable(db.Praise.AsNoTracking()).FirstOrDefaultAsync(p => p.Id == praiseId, token);
        return praise is null ? null : (await ProjectAsync([praise], actor, token))[0];
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

public sealed class ListPraiseHandler(PerformanceDbContext db) : IQueryHandler<ListPraiseQuery, Result<PraisePageDto>>
{
    public const int MaxLimit = 20;

    public async Task<Result<PraisePageDto>> Handle(ListPraiseQuery query, CancellationToken token)
    {
        var me = query.Actor.EmployeeId;
        var items = PraisePolicy.Readable(db.Praise.AsNoTracking());
        if (query.EmployeeId is Guid person) items = items.Where(p => p.Recipients.Any(r => r.EmployeeId == person));
        else
            items = query.Scope switch
            {
                PraiseScope.ForMe => items.Where(p => p.Recipients.Any(r => r.EmployeeId == me)),
                PraiseScope.ByMe => items.Where(p => p.AuthorEmployeeId == me),
                _ => items,
            };
        if (Cursor.Parse(query.Before) is DateTime before) items = items.Where(p => p.GivenAt < before);
        var limit = Math.Clamp(query.Limit, 1, MaxLimit);
        var page = await items.OrderByDescending(p => p.GivenAt).Take(limit + 1).ToListAsync(token);
        var more = page.Count > limit;
        if (more) page.RemoveAt(page.Count - 1);
        return Result.Success(new PraisePageDto(await new PraiseReader(db).ProjectAsync(page, query.Actor, token),
            more ? Cursor.Format(page[^1].GivenAt) : null));
    }
}

public sealed class GetPraiseHandler(PerformanceDbContext db) : IQueryHandler<GetPraiseQuery, Result<PraiseDetailDto>>
{
    public async Task<Result<PraiseDetailDto>> Handle(GetPraiseQuery query, CancellationToken token)
    {
        var praise = await db.Praise.AsNoTracking().FirstOrDefaultAsync(p => p.Id == query.PraiseId, token);
        if (praise is null) return Result.Failure<PraiseDetailDto>(PerformanceErrors.NotFound("Praise", query.PraiseId));
        if (praise.IsDeleted) return Result.Success(new PraiseDetailDto(true, null));
        return Result.Success(new PraiseDetailDto(false, (await new PraiseReader(db).ProjectAsync([praise], query.Actor, token))[0]));
    }
}

public sealed class GivePraiseHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit,
    IPerformanceNotifications notifications)
    : ICommandHandler<GivePraiseCommand, Result<PraiseDto>>
{
    public async Task<Result<PraiseDto>> Handle(GivePraiseCommand command, CancellationToken token)
    {
        var request = command.Request;
        var me = command.Actor.EmployeeId;
        var reader = new PraiseReader(db);
        var existing = await db.Praise.AsNoTracking().FirstOrDefaultAsync(p => p.Id == request.Id, token);
        if (existing is not null)
            return existing.AuthorEmployeeId == me && !existing.IsDeleted
                ? Result.Success((await reader.ProjectAsync([existing], command.Actor, token))[0])
                : Result.Failure<PraiseDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.FeedbackIdConflict, "Send it again from a fresh form."));

        var wanted = (request.RecipientEmployeeIds ?? []).Distinct().ToList();
        if (wanted.Count is 0 or > Praise.MaxRecipients) return Invalid($"Praise 1 to {Praise.MaxRecipients} people.");
        if (wanted.Contains(me)) return Invalid("Praise someone other than yourself.");
        var value = (await CompanyValues.ActiveAsync(db, tenant.TenantId, token)).FirstOrDefault(v => v.Id == request.ValueId);
        if (value is null) return Invalid("Choose one of the company's values.");

        var people = await workforce.ResolveAsync(PerformanceClock.UtcNow, [.. wanted, me], token);
        var author = people.FirstOrDefault(p => p.EmployeeId == me);
        var recipients = wanted.Select(id => people.FirstOrDefault(p => p.EmployeeId == id)).ToList();
        if (author is null || recipients.Any(r => r is not { IsActive: true }))
            return Result.Failure<PraiseDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.FeedbackReceiverUnavailable,
                "Everyone you praise needs to be an active colleague in this company."));

        Praise praise;
        try
        {
            praise = Praise.Give(request.Id, tenant.TenantId, me, author.DisplayName, value.Id, request.Message,
                recipients.Select(r => (r!.EmployeeId, r.DisplayName)).ToList(), PerformanceClock.UtcNow);
        }
        catch (ArgumentException ex) { return Invalid(ex.Message); }
        db.Praise.Add(praise);
        audit.Record(praise.TenantId, "Praise", praise.Id, null, PerformanceAuditActions.PraiseGiven,
            new { authorEmployeeId = me, recipientEmployeeIds = wanted, valueId = value.Id });

        // Recipients hear it themselves; a recipient's manager hears once per praise, unless they were praised too.
        var recipientIds = wanted.ToHashSet();
        foreach (var recipient in recipients)
            notifications.EnqueueConversation(praise.TenantId, PerformanceNotificationKind.PraiseReceived, recipient!.EmployeeId, me,
                "Praise", praise.Id, praise.Id, PerformanceNotificationTemplates.ForPraiseReceived(author.DisplayName, value.Name, praise.Id));
        foreach (var group in recipients.Where(r => r!.Manager is { IsActive: true } m && !recipientIds.Contains(m.EmployeeId))
                     .GroupBy(r => r!.Manager!.EmployeeId))
        {
            var names = group.Select(r => r!.DisplayName).ToList();
            var who = names.Count == 1 ? names[0] : $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";
            notifications.EnqueueConversation(praise.TenantId, PerformanceNotificationKind.PraiseForReport, group.Key, me,
                "Praise", praise.Id, praise.Id, PerformanceNotificationTemplates.ForPraiseForReport(author.DisplayName, who, value.Name, praise.Id));
        }
        await db.SaveChangesAsync(token);
        return Result.Success((await reader.ProjectAsync([praise], command.Actor, token))[0]);
    }

    private static Result<PraiseDto> Invalid(string message)
        => Result.Failure<PraiseDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PraiseInvalid, message));
}

public sealed class ReactToPraiseHandler(PerformanceDbContext db, ITenantContext tenant) : ICommandHandler<ReactToPraiseCommand, Result<PraiseDto>>
{
    public async Task<Result<PraiseDto>> Handle(ReactToPraiseCommand command, CancellationToken token)
    {
        var me = command.Actor.EmployeeId;
        if (!Enum.IsDefined(command.Kind))
            return Result.Failure<PraiseDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PraiseInvalid, "Choose one of the four reactions."));
        if (!await PraisePolicy.Readable(db.Praise.AsNoTracking()).AnyAsync(p => p.Id == command.PraiseId, token))
            return Result.Failure<PraiseDto>(PerformanceErrors.NotFound("Praise", command.PraiseId));
        var existing = await db.PraiseReactions.FirstOrDefaultAsync(r => r.PraiseId == command.PraiseId && r.ReactorEmployeeId == me
            && r.Kind == command.Kind, token);
        // Setting a reaction to what it already is changes nothing.
        if (command.Add && existing is null) db.PraiseReactions.Add(PraiseReaction.Create(tenant.TenantId, command.PraiseId, me, command.Kind));
        else if (!command.Add && existing is not null) db.PraiseReactions.Remove(existing);
        try { await db.SaveChangesAsync(token); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); /* A concurrent identical reaction already landed. */ }
        return Result.Success((await new PraiseReader(db).OneAsync(command.PraiseId, command.Actor, token))!);
    }
}

public sealed class DeletePraiseHandler(PerformanceDbContext db, IPerformanceAudit audit) : ICommandHandler<DeletePraiseCommand, Result>
{
    public async Task<Result> Handle(DeletePraiseCommand command, CancellationToken token)
    {
        var praise = await db.Praise.FirstOrDefaultAsync(p => p.Id == command.PraiseId, token);
        if (praise is null) return Result.Failure(PerformanceErrors.NotFound("Praise", command.PraiseId));
        if (praise.IsDeleted) return Result.Success();
        var me = command.Actor.EmployeeId;
        if (!PraisePolicy.CanDelete(praise, me, command.Actor.IsAdministrator))
            return Result.Failure(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PraiseDeleteForbidden, "Only its author or HR removes praise."));
        var role = me != Guid.Empty && praise.AuthorEmployeeId == me ? PraiseDeletedBy.Author : PraiseDeletedBy.Administrator;
        praise.Delete(me, role, PerformanceClock.UtcNow);
        audit.Record(praise.TenantId, "Praise", praise.Id, null, PerformanceAuditActions.PraiseDeleted,
            new { deletedBy = role.ToString(), authorEmployeeId = praise.AuthorEmployeeId });
        try { await db.SaveChangesAsync(token); }
        catch (DbUpdateConcurrencyException) { return Result.Failure(PerformanceErrors.Changed()); }
        return Result.Success();
    }
}

public sealed class GetPraiseSummaryHandler(PerformanceDbContext db, ITenantContext tenant) : IQueryHandler<GetPraiseSummaryQuery, Result<PraiseSummaryDto>>
{
    public async Task<Result<PraiseSummaryDto>> Handle(GetPraiseSummaryQuery query, CancellationToken token)
    {
        var me = query.EmployeeId;
        var now = PerformanceClock.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var weekStart = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var weekFrom = weekStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var monthFrom = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var praise = PraisePolicy.Readable(db.Praise.AsNoTracking());
        var thisWeek = await praise.CountAsync(p => p.GivenAt >= weekFrom, token);
        var counts = await praise.Where(p => p.GivenAt >= monthFrom).GroupBy(p => p.ValueId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(c => c.Id, c => c.Count, token);
        var values = (await CompanyValues.ActiveAsync(db, tenant.TenantId, token))
            .Select(v => new PraiseValueCountDto(v.Id, v.Name, counts.GetValueOrDefault(v.Id))).ToList();
        var received = me == Guid.Empty ? 0 : await praise.CountAsync(p => p.Recipients.Any(r => r.EmployeeId == me), token);
        var given = me == Guid.Empty ? 0 : await praise.CountAsync(p => p.AuthorEmployeeId == me, token);
        return Result.Success(new PraiseSummaryDto(weekStart, thisWeek, values, received, given));
    }
}
