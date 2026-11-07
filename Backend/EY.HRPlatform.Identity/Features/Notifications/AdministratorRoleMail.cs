using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.Identity.Features.Notifications;

/// <summary>An administrator role someone gained or lost, told to them after it committed.</summary>
public sealed record AdministratorRoleChange(Guid TenantId, Guid UserId, string RoleName, bool Gained, Guid ActorUserId);

/// <summary>
/// Account mail (B-002 N2, N8): a person hears when they gain or lose an administrator role. It is about access, so no
/// preference silences it and it carries no unsubscribe link. Sent after the change commits and never throws: a mail
/// problem must not undo a committed access change.
/// </summary>
public interface IAdministratorRoleMail
{
    Task SendAsync(AdministratorRoleChange change, CancellationToken cancellationToken = default);

    /// <summary>
    /// Mails each person whose access profiles gained or lost an administrator profile (HR Admin, Org Admin). Other
    /// profiles (Employee, Manager, custom ones) change no administration and send nothing.
    /// </summary>
    Task SendProfileChangesAsync(Guid tenantId, Guid actorUserId,
        IReadOnlyList<(Guid UserId, IReadOnlyCollection<Guid> Before, IReadOnlyCollection<Guid> After)> people,
        CancellationToken cancellationToken = default);
}

public interface IAccountMailSender
{
    Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken);
}

/// <summary>Uses the workforce invitation transport (Mailpit locally); off when that transport is off.</summary>
public sealed class SmtpAccountMailSender(IOptions<WorkforceInvitationEmailOptions> options) : IAccountMailSender
{
    public Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken)
    {
        var config = options.Value;
        if (!config.Enabled || string.IsNullOrWhiteSpace(config.SmtpHost)) return Task.CompletedTask;
        return FusionMailer.SendAsync(new FusionSmtpOptions
        {
            Host = config.SmtpHost, Port = config.SmtpPort, From = config.FromEmail, UseSsl = config.UseSsl,
            Username = config.Username, Password = config.Password,
        }, email, cancellationToken);
    }
}

public sealed class AdministratorRoleMail(AppIdentityDbContext db, IAccountMailSender sender, IConfiguration configuration,
    ILogger<AdministratorRoleMail> logger) : IAdministratorRoleMail
{
    public static readonly NotificationCatalog Text =
        NotificationCatalog.FromAssembly(typeof(AdministratorRoleMail).Assembly, "EY.HRPlatform.Identity.Notifications.Text.account");

    public async Task SendAsync(AdministratorRoleChange change, CancellationToken cancellationToken = default)
    {
        try
        {
            var person = await db.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.Id == change.UserId)
                .Select(user => new { user.Email, user.PreferredLanguage }).FirstOrDefaultAsync(cancellationToken);
            var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(item => item.Id == change.TenantId)
                .Select(item => new { item.Name, item.Locale }).FirstOrDefaultAsync(cancellationToken);
            var brand = await Branding.CompanyBrandReader.ForInvitationAsync(db, change.TenantId, cancellationToken);
            if (person is null || tenant is null || string.IsNullOrWhiteSpace(person.Email)) return;
            var actor = await db.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.Id == change.ActorUserId)
                .Select(user => (user.FirstName + " " + user.LastName).Trim()).FirstOrDefaultAsync(cancellationToken);

            var email = Render(change, FusionLanguages.Resolve(person.PreferredLanguage, tenant.Locale),
                new NotificationCompany(tenant.Name, brand.Brand.Color, brand.Brand.LogoPng),
                string.IsNullOrWhiteSpace(actor) ? null : actor, ShellBaseUrl());
            await sender.SendAsync(new FusionOutgoingEmail(person.Email, email,
                $"<{Guid.NewGuid():N}@fusion-identity>"), cancellationToken);
            logger.LogInformation("Audit Event: AdministratorRoleMailSent | TenantId={TenantId} | UserId={UserId} | Gained={Gained}",
                change.TenantId, change.UserId, change.Gained);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("Administrator role mail failed ({ErrorType}) | TenantId={TenantId} | UserId={UserId}",
                ex.GetType().Name, change.TenantId, change.UserId);
        }
    }

    /// <summary>The seeded profiles that administer something; Tenant Administrator has its own commands.</summary>
    public static readonly string[] AdministratorProfileKeys = ["hr-admin", "org-admin"];

    public async Task SendProfileChangesAsync(Guid tenantId, Guid actorUserId,
        IReadOnlyList<(Guid UserId, IReadOnlyCollection<Guid> Before, IReadOnlyCollection<Guid> After)> people,
        CancellationToken cancellationToken = default)
    {
        var changed = people.SelectMany(person => person.Before.Except(person.After).Concat(person.After.Except(person.Before))).Distinct().ToList();
        if (changed.Count == 0) return;
        Dictionary<Guid, string> administrators;
        try
        {
            administrators = await db.AccessProfiles.IgnoreQueryFilters().AsNoTracking()
                .Where(profile => profile.TenantId == tenantId && changed.Contains(profile.Id)
                    && profile.InternalKey != null && AdministratorProfileKeys.Contains(profile.InternalKey))
                .ToDictionaryAsync(profile => profile.Id, profile => profile.Name, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("Administrator role mail failed ({ErrorType}) | TenantId={TenantId}", ex.GetType().Name, tenantId);
            return;
        }
        foreach (var (userId, before, after) in people)
        {
            foreach (var gained in after.Except(before).Where(administrators.ContainsKey))
                await SendAsync(new AdministratorRoleChange(tenantId, userId, administrators[gained], true, actorUserId), cancellationToken);
            foreach (var lost in before.Except(after).Where(administrators.ContainsKey))
                await SendAsync(new AdministratorRoleChange(tenantId, userId, administrators[lost], false, actorUserId), cancellationToken);
        }
    }

    /// <summary>The words only name the role, the company and who acted; nothing about what the role allows.</summary>
    public static RenderedEmail Render(AdministratorRoleChange change, string language, NotificationCompany company, string? actorName,
        string shellBaseUrl)
    {
        var companyName = company.Name;
        var self = change.ActorUserId == change.UserId;
        var values = new Dictionary<string, string>
        {
            ["role"] = change.RoleName, ["company"] = companyName, ["actor"] = actorName ?? companyName,
        };
        var key = change.Gained ? "RoleGranted" : "RoleRemoved";
        return FusionNotificationEmail.Render(language,
            new NotificationEmailText(Text.Text(language, $"{key}.subject", values)!,
                Text.Text(language, self && !change.Gained ? "RoleRemoved.self.lead" : $"{key}.lead", values)!,
                Text.Text(language, "action")!),
            $"{shellBaseUrl.TrimEnd('/')}/",
            new NotificationEmailGroup(Text.Text(language, "group")!, CanTurnOff: false),
            company, shellBaseUrl);
    }

    private string ShellBaseUrl() => configuration["Application:PublicBaseUrl"] is { Length: > 0 } url ? url : "http://localhost:3000";
}
