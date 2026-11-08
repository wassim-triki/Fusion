using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Interceptors;

/// <summary>What a person's role grant records say (B-314): the role, and whether it was chosen or came by rule.</summary>
public static class AccessGrantAudit
{
    public const string Given = "access.grant.given";
    public const string Removed = "access.grant.removed";
    public const string ResourceType = "Account";
    public const string Chosen = "chosen";
    public const string Rule = "rule";

    public sealed record Record(Guid RoleId, string RoleName, string How);
}

/// <summary>
/// Records a person gaining or losing a role, in the same save that changes their <see cref="UserAccessProfile"/>
/// rows, whichever service made the change. A chosen grant names who saved it; a rule's doesn't, the rule did it.
/// A row that only gains or loses its rule while still chosen tells nothing new and isn't recorded.
/// </summary>
public sealed class AccessGrantAuditInterceptor(IHttpContextAccessor? httpContextAccessor = null) : SaveChangesInterceptor
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is AppIdentityDbContext db)
        {
            var changes = Changes(db);
            var missing = MissingNames(db, changes);
            Record(db, changes, missing.Count == 0 ? [] : NamesQuery(db, missing).ToDictionary(profile => profile.Id, profile => profile.Name));
        }
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is AppIdentityDbContext db)
        {
            var changes = Changes(db);
            var missing = MissingNames(db, changes);
            Record(db, changes, missing.Count == 0
                ? []
                : await NamesQuery(db, missing).ToDictionaryAsync(profile => profile.Id, profile => profile.Name, cancellationToken));
        }
        return result;
    }

    private sealed record RoleName(Guid Id, string Name);

    private static IQueryable<RoleName> NamesQuery(AppIdentityDbContext db, List<Guid> ids)
        => db.AccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(profile => ids.Contains(profile.Id)).Select(profile => new RoleName(profile.Id, profile.Name));

    private sealed record Change(UserAccessProfile Row, string Action, string How);

    private static List<Change> Changes(AppIdentityDbContext db)
    {
        db.ChangeTracker.DetectChanges();
        var changes = new List<Change>();
        foreach (var entry in db.ChangeTracker.Entries<UserAccessProfile>())
        {
            switch (entry.State)
            {
                case EntityState.Added when entry.Entity.IsHeld:
                    changes.Add(new(entry.Entity, AccessGrantAudit.Given, entry.Entity.IsChosen ? AccessGrantAudit.Chosen : AccessGrantAudit.Rule));
                    break;
                case EntityState.Deleted:
                    // Lost its rule while not chosen: the rule took it. Anything else was someone's save.
                    var lostRule = Was(entry, nameof(UserAccessProfile.ByRule)) && !entry.Entity.ByRule
                        && !Was(entry, nameof(UserAccessProfile.IsChosen));
                    changes.Add(new(entry.Entity, AccessGrantAudit.Removed, lostRule ? AccessGrantAudit.Rule : AccessGrantAudit.Chosen));
                    break;
                case EntityState.Modified when entry.Entity.IsHeld && Was(entry, nameof(UserAccessProfile.IsChosen)) != entry.Entity.IsChosen:
                    // Still held, now for another reason: chosen by someone, or left to the rule.
                    changes.Add(new(entry.Entity, AccessGrantAudit.Given, entry.Entity.IsChosen ? AccessGrantAudit.Chosen : AccessGrantAudit.Rule));
                    break;
            }
        }
        return changes;
    }

    private static bool Was(EntityEntry<UserAccessProfile> entry, string property)
        => entry.OriginalValues.GetValue<bool>(property);

    private static Dictionary<Guid, string> TrackedNames(AppIdentityDbContext db)
        => db.ChangeTracker.Entries<AccessProfile>().GroupBy(entry => entry.Entity.Id)
            .ToDictionary(group => group.Key, group => group.First().Entity.Name);

    private static List<Guid> MissingNames(AppIdentityDbContext db, List<Change> changes)
    {
        var tracked = TrackedNames(db);
        return changes.Select(change => change.Row.AccessProfileId).Distinct().Where(id => !tracked.ContainsKey(id)).ToList();
    }

    private void Record(AppIdentityDbContext db, List<Change> changes, Dictionary<Guid, string> loaded)
    {
        if (changes.Count == 0)
            return;
        var names = TrackedNames(db);
        foreach (var (id, name) in loaded)
            names[id] = name;

        var (actorId, actorName) = Actor(httpContextAccessor?.HttpContext);
        foreach (var change in changes)
        {
            var role = names.GetValueOrDefault(change.Row.AccessProfileId, string.Empty);
            var byRule = change.How == AccessGrantAudit.Rule;
            db.AccessAuditEvents.Add(AccessAuditEvent.Create(
                change.Row.TenantId,
                byRule ? null : actorId,
                byRule ? AccessAuditEvent.UnresolvedActor : actorName,
                AccessAuditEvent.UnresolvedActor,
                change.Action,
                AccessGrantAudit.ResourceType,
                change.Row.UserId.ToString(),
                $"{(role.Length > 0 ? role : "Role")} {(change.Action == AccessGrantAudit.Given ? "given" : "removed")}{(byRule ? " by rule" : string.Empty)}",
                null,
                JsonSerializer.Serialize(new AccessGrantAudit.Record(change.Row.AccessProfileId, role, change.How), JsonOptions),
                null));
        }
    }

    /// <summary>
    /// Who is saving: the signed-in person, or on an internal route (which only Fusion's services reach, each call
    /// checked by the internal authorizer) the person Core HR acts for. The name is resolved from the id when read.
    /// </summary>
    private static (Guid? Id, string Name) Actor(HttpContext? context)
    {
        if (context is null)
            return (null, AccessAuditEvent.UnresolvedActor);
        if (context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value is { } claim && Guid.TryParse(claim, out var signedIn))
            return (signedIn, context.User.FindFirst(CustomClaimTypes.FullName)?.Value ?? AccessAuditEvent.UnresolvedActor);
        return context.Request.Path.StartsWithSegments("/internal")
            && Guid.TryParse(context.Request.Headers["X-Acting-User-Id"].FirstOrDefault(), out var acting)
                ? (acting, AccessAuditEvent.UnresolvedActor)
                : (null, AccessAuditEvent.UnresolvedActor);
    }
}
