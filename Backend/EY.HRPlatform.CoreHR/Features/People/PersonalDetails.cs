using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using System.Net.Http.Json;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Security;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

// --- Who is looking ---------------------------------------------------------------------------------

/// <summary>
/// The caller as the profile endpoints see them, read from their claims by the controller. Never built
/// from a request value.
/// </summary>
/// <param name="ManagesPeople">People admin (<c>core.employee.manage</c> at tenant scope).</param>
/// <param name="ViewsTenant">Reads every employee's job (<c>core.employee.view</c> at tenant scope).</param>
/// <param name="ManagesTeam">A manager who reads their own branch.</param>
/// <param name="UpdatesSelf">May change their own profile (<c>core.profile.self.update</c>).</param>
/// <param name="Personal">How far they read others' personal details (<c>core.personal.*</c>), apart from jobs.</param>
/// <param name="JobReach">Below tenant scope, whose jobs they read: their team, or their unit (B-212).</param>
public sealed record PeopleViewer(
    Guid? EmployeeId,
    bool ManagesPeople,
    bool ViewsTenant,
    bool ManagesTeam,
    bool UpdatesSelf,
    PersonalGrant Personal = PersonalGrant.None,
    string JobReach = PermissionScopes.DirectReports);

/// <summary>A role's Personal details area for others (B-214): their keys, separate from Jobs.</summary>
public enum PersonalGrant
{
    None,
    /// <summary>Contact details of their branch (<c>core.personal.view</c> for direct reports).</summary>
    Team,
    /// <summary>Contact details of their unit and their branch (<c>core.personal.view</c> for an org unit, B-212).</summary>
    Unit,
    /// <summary>Contact details of everyone (<c>core.personal.view</c> for the tenant).</summary>
    Everyone,
    /// <summary>Reads and changes everyone's personal details (<c>core.personal.manage</c>).</summary>
    Change,
}

/// <summary>How much of a person's personal details a viewer may read.</summary>
public enum PersonalAccess
{
    /// <summary>The preferred name only: what any colleague sees.</summary>
    Directory,
    /// <summary>Adds the mobile: whoever sees personal details for the person's team or for everyone.</summary>
    Contact,
    /// <summary>Everything: the person themselves and whoever changes personal details.</summary>
    Full,
}

public sealed record PeopleAccessDecision(PersonalAccess Access, bool CanEdit, bool CanReadJobHistory);

public static class PeopleAccess
{
    public const string ForbiddenCode = "People.Forbidden";

    /// <summary>Decides what the viewer may do with one person; the branch is read only when it matters.</summary>
    public static async Task<PeopleAccessDecision> DecideAsync(
        CoreHRDbContext dbContext, PeopleViewer viewer, Guid employeeId, CancellationToken cancellationToken)
    {
        // Personal details follow the Personal keys and job history the Jobs keys (B-214); each reach is read once.
        var isSelf = viewer.EmployeeId == employeeId;
        var reached = new Dictionary<string, bool>();
        async Task<bool> ReachesAsync(string scope)
        {
            if (viewer.EmployeeId is not { } viewerId) return false;
            if (!reached.TryGetValue(scope, out var reaches))
                reached[scope] = reaches = (await ViewerReach.PeopleAsync(dbContext, viewerId, scope, cancellationToken)).Contains(employeeId);
            return reaches;
        }

        var access = isSelf || viewer.Personal == PersonalGrant.Change ? PersonalAccess.Full
            : viewer.Personal == PersonalGrant.Everyone
                || (viewer.Personal == PersonalGrant.Team && await ReachesAsync(PermissionScopes.DirectReports))
                || (viewer.Personal == PersonalGrant.Unit && await ReachesAsync(PermissionScopes.OrgUnit)) ? PersonalAccess.Contact
            : PersonalAccess.Directory;
        var canEdit = viewer.Personal == PersonalGrant.Change || (isSelf && viewer.UpdatesSelf);
        var jobHistory = viewer.ManagesPeople || viewer.ViewsTenant || (!isSelf && viewer.ManagesTeam && await ReachesAsync(viewer.JobReach));
        return new(access, canEdit, jobHistory);
    }

    public static Error Forbidden(string message) => new(ForbiddenCode, message);
}

// --- Contracts --------------------------------------------------------------------------------------

public sealed record PeopleHomeAddressDto(string? Street, string? City, string? PostalCode, string? Country);

public sealed record PeopleEmergencyContactDto(string Name, string? Relationship, string Phone);

/// <summary>
/// The Personal tab, shaped for the viewer: fields above their <see cref="Access"/> come back null, so the
/// client tells "hidden" from "empty" by the access level, not by the values.
/// </summary>
public sealed record PeoplePersonalDto(
    string EmployeeKey,
    PersonalAccess Access,
    bool CanEdit,
    string FirstName,
    string LastName,
    string? PreferredName,
    string? Mobile,
    string? PersonalEmail,
    PeopleHomeAddressDto? HomeAddress,
    DateOnly? DateOfBirth,
    IReadOnlyList<PeopleEmergencyContactDto>? EmergencyContacts,
    uint Version,
    PeoplePendingAddressDto? PendingHomeAddress = null,
    PeoplePersonalAudienceDto? Audience = null);

/// <summary>
/// Who sees each tier of the Personal tab besides the person, from the company's roles (B-214). The preferred name is
/// everyone's; the mobile reaches <see cref="Contact"/> roles and, when <see cref="ContactTeam"/>, the managers above
/// the person; the rest only <see cref="Full"/> roles. The Administrators role, which holds everything, is named only
/// when no other role is.
/// </summary>
public sealed record PeoplePersonalAudienceDto(IReadOnlyList<string> Contact, bool ContactTeam, IReadOnlyList<string> Full);

/// <summary>Reads the company's roles that reach personal details, from Identity.</summary>
public interface IPersonalAudienceDirectory
{
    Task<PeoplePersonalAudienceDto?> GetAsync(CancellationToken cancellationToken);
}

public sealed class PersonalAudienceDirectory(HttpClient httpClient, IInternalServiceRequestSigner signer, ITenantContext tenant)
    : IPersonalAudienceDirectory
{
    public async Task<PeoplePersonalAudienceDto?> GetAsync(CancellationToken cancellationToken)
    {
        if (!tenant.IsResolved) return null;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(httpClient.BaseAddress!, "internal/identity/access/permission-roles"))
            {
                Content = JsonContent.Create(new PermissionRolesRequest(tenant.TenantId, [CorePermissions.PersonalView, CorePermissions.PersonalManage])),
            };
            await signer.SignAsync(request, cancellationToken);
            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode) return null;
            return Compose(await response.Content.ReadFromJsonAsync<List<PermissionRole>>(cancellationToken) ?? []);
        }
        catch (HttpRequestException)
        {
            // The labels are a courtesy: without Identity the tab shows its fields and no "who sees".
            return null;
        }
    }

    public static PeoplePersonalAudienceDto Compose(IReadOnlyList<PermissionRole> roles)
    {
        IReadOnlyList<string> Names(Func<PermissionRole, bool> reaches)
        {
            var matching = roles.Where(reaches).ToList();
            var named = matching.Where(role => !role.IsAdministrators).Select(role => role.Name).Distinct().ToList();
            return named.Count > 0 ? named : matching.Select(role => role.Name).Distinct().ToList();
        }

        var full = Names(role => role.PermissionKey == CorePermissions.PersonalManage);
        var contact = Names(role => role.Scope == PermissionScopes.Tenant);
        var team = roles.Any(role => role.PermissionKey == CorePermissions.PersonalView && role.Scope is PermissionScopes.DirectReports or PermissionScopes.OrgUnit);
        return new PeoplePersonalAudienceDto(contact, team, full);
    }
}

/// <summary>A new home address waiting for HR (D-16); its asker can withdraw it.</summary>
public sealed record PeoplePendingAddressDto(Guid RequestId, PeopleHomeAddressDto Address, DateTime RequestedAt, string RequestedBy);

/// <summary>Replaces every field of the Personal tab; send back what you read with your change applied.</summary>
public sealed record UpdatePersonalRequest(
    string? PreferredName,
    string? Mobile,
    string? PersonalEmail,
    PeopleHomeAddressDto? HomeAddress,
    DateOnly? DateOfBirth,
    IReadOnlyList<PeopleEmergencyContactDto>? EmergencyContacts);

public sealed record PeoplePersonalQuery(string EmployeeKey, PeopleViewer Viewer) : IQuery<Result<PeoplePersonalDto>>;

/// <summary>The person's About, written by them or by whoever changes personal details (B-180).</summary>
public sealed record UpdateAboutRequest(string? About);

public sealed record UpdatePeopleAboutCommand(string EmployeeKey, PeopleViewer Viewer, string? About, string Actor)
    : ICommand<Result<string?>>;

public sealed record UpdatePeoplePersonalCommand(
    string EmployeeKey,
    PeopleViewer Viewer,
    uint ExpectedVersion,
    UpdatePersonalRequest Request,
    string Actor) : ICommand<Result<PeoplePersonalDto>>;

// --- Handlers ---------------------------------------------------------------------------------------

public sealed class PeoplePersonalQueryHandler(CoreHRDbContext dbContext, IPersonalAudienceDirectory? audience = null)
    : IQueryHandler<PeoplePersonalQuery, Result<PeoplePersonalDto>>
{
    public async Task<Result<PeoplePersonalDto>> Handle(PeoplePersonalQuery request, CancellationToken cancellationToken)
    {
        var employee = await PersonalSupport.FindAsync(dbContext, request.EmployeeKey, tracked: false, cancellationToken);
        if (employee is null)
            return Result.Failure<PeoplePersonalDto>(new Error("Employee.NotFound", "Employee was not found."));

        var decision = await PeopleAccess.DecideAsync(dbContext, request.Viewer, employee.Id, cancellationToken);
        return Result.Success(PersonalSupport.Project(employee, decision, await PersonalSupport.PendingAddressAsync(dbContext, employee.Id, decision, cancellationToken))
            with { Audience = audience is null ? null : await audience.GetAsync(cancellationToken) });
    }
}

public sealed class UpdatePeoplePersonalCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    ITenantSettingsReadService? tenantSettingsReadService = null,
    Changes.ChangeRequestService? changeRequests = null,
    EmployeeFieldService? employeeFields = null)
    : ICommandHandler<UpdatePeoplePersonalCommand, Result<PeoplePersonalDto>>
{
    private readonly ITenantSettingsReadService tenantSettingsReader =
        tenantSettingsReadService ?? new TenantSettingsReadService(dbContext);

    public async Task<Result<PeoplePersonalDto>> Handle(UpdatePeoplePersonalCommand command, CancellationToken cancellationToken)
    {
        var employee = await PersonalSupport.FindAsync(dbContext, command.EmployeeKey, tracked: true, cancellationToken);
        if (employee is null)
            return Result.Failure<PeoplePersonalDto>(new Error("Employee.NotFound", "Employee was not found."));

        var decision = await PeopleAccess.DecideAsync(dbContext, command.Viewer, employee.Id, cancellationToken);
        if (!decision.CanEdit)
            return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("You can't change this person's details."));
        if (employee.Version != command.ExpectedVersion)
            throw new ConcurrencyException("Employee", employee.Id);

        var body = command.Request;
        // The company's self-service settings bind the person, never HR.
        var hr = command.Viewer.Personal == PersonalGrant.Change;
        if (!hr)
        {
            var selfService = (await tenantSettingsReader.GetCurrentAsync(cancellationToken)).SelfService;
            async Task<bool> CanChange(string sourceKey, bool fallback)
                => employeeFields is null
                    ? fallback
                    : await employeeFields.CanSelfEditSourceAsync(sourceKey, cancellationToken) ?? fallback;

            if (!await CanChange("preferredName", selfService.CanEditPreferredName) && Blank(body.PreferredName) != employee.PreferredName)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your preferred name."));
            if (!await CanChange("phone", selfService.CanEditPhone) && Blank(body.Mobile) != employee.Phone)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your mobile."));
            if (!await CanChange("personalEmail", true) && Blank(body.PersonalEmail) != employee.PersonalEmail)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your personal email."));
            if (!await CanChange("homeAddress", true) && RequestedAddress(body.HomeAddress) != employee.CurrentHomeAddress)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your home address."));
            if (!await CanChange("emergencyContacts", true) && EmergencyContactsChanged(body.EmergencyContacts, employee))
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your emergency contacts."));
            // Locked on the Personal tab (D-16): the date of birth is HR's to change.
            if (body.DateOfBirth != employee.DateOfBirth)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Only HR changes your date of birth."));
        }

        IReadOnlyList<string> changed;
        try
        {
            var address = body.HomeAddress is { } home
                ? new HomeAddress(home.Street, home.City, home.PostalCode, home.Country)
                : null;
            var contacts = (body.EmergencyContacts ?? [])
                .Select(contact => new EmergencyContactDetails(contact.Name, contact.Relationship, contact.Phone))
                .ToList();
            // A person's own new address waits for HR when the company asks for it (D-16); the rest saves now.
            if (!hr && changeRequests is not null
                && Employee.NormalizedHomeAddress(address) is var wanted && wanted != employee.CurrentHomeAddress
                && await dbContext.ChangeApprovalRules.AnyAsync(rule => rule.Type == ChangeApprovalTypes.HomeAddress, cancellationToken))
            {
                var separator = command.Actor.IndexOf('|');
                var actor = new Changes.ChangeActor(
                    Guid.TryParse(separator > 0 ? command.Actor[..separator] : command.Actor, out var userId) ? userId.ToString() : command.Actor,
                    command.Viewer.EmployeeId,
                    separator > 0 ? command.Actor[(separator + 1)..] : employee.DisplayName, false, false, false);
                var asked = await changeRequests.StageAddressRequestAsync(employee, wanted, actor, cancellationToken);
                if (asked.IsFailure)
                    return Result.Failure<PeoplePersonalDto>(asked.Error);
                address = employee.CurrentHomeAddress;
            }
            changed = employee.UpdatePersonalDetails(
                new PersonalDetails(body.PreferredName, body.Mobile, body.PersonalEmail, address, body.DateOfBirth, contacts),
                DateOnly.FromDateTime(DateTime.UtcNow));
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<PeoplePersonalDto>(new Error("Employee.Validation", ex.Message));
        }

        if (changed.Count > 0)
            dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
                tenantContext.TenantId, "Employee", employee.Id, WorkforceAuditAction.PersonalDetailsUpdated,
                WorkforceSourceType.Manual, command.Actor, changeDetails: string.Join(", ", changed)));
        if (dbContext.ChangeTracker.HasChanges())
            await dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success(PersonalSupport.Project(employee, decision, await PersonalSupport.PendingAddressAsync(dbContext, employee.Id, decision, cancellationToken)));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static HomeAddress? RequestedAddress(PeopleHomeAddressDto? value)
        => value is null ? null : Employee.NormalizedHomeAddress(new HomeAddress(value.Street, value.City, value.PostalCode, value.Country));

    private static bool EmergencyContactsChanged(IReadOnlyList<PeopleEmergencyContactDto>? requested, Employee employee)
    {
        var wanted = (requested ?? []).Select(item => (item.Name.Trim(), Blank(item.Relationship), item.Phone.Trim())).ToList();
        var current = employee.EmergencyContacts.OrderBy(item => item.Position)
            .Select(item => (item.Name, item.Relationship, item.Phone)).ToList();
        return !wanted.SequenceEqual(current);
    }
}

public sealed class UpdatePeopleAboutCommandHandler(CoreHRDbContext dbContext, ITenantContext tenantContext)
    : ICommandHandler<UpdatePeopleAboutCommand, Result<string?>>
{
    public async Task<Result<string?>> Handle(UpdatePeopleAboutCommand command, CancellationToken cancellationToken)
    {
        var employee = await PersonalSupport.FindAsync(dbContext, command.EmployeeKey, tracked: true, cancellationToken);
        if (employee is null)
            return Result.Failure<string?>(new Error("Employee.NotFound", "Employee was not found."));
        if (!(await PeopleAccess.DecideAsync(dbContext, command.Viewer, employee.Id, cancellationToken)).CanEdit)
            return Result.Failure<string?>(PeopleAccess.Forbidden("You can't change what this person says about themselves."));

        bool changed;
        try
        {
            changed = employee.SetAbout(command.About);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<string?>(new Error("Employee.Validation", ex.Message));
        }
        if (changed)
        {
            dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
                tenantContext.TenantId, "Employee", employee.Id, WorkforceAuditAction.PersonalDetailsUpdated,
                WorkforceSourceType.Manual, command.Actor, changeDetails: "About"));
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        return Result.Success(employee.About);
    }
}

internal static class PersonalSupport
{
    public static Task<Employee?> FindAsync(
        CoreHRDbContext dbContext, string employeeKey, bool tracked, CancellationToken cancellationToken)
    {
        var key = employeeKey.Trim().ToUpperInvariant();
        var query = dbContext.Employees.Include(item => item.EmergencyContacts).AsQueryable();
        if (!tracked)
            query = query.AsNoTracking();
        return query.FirstOrDefaultAsync(item => item.StableEmployeeKey == key, cancellationToken);
    }

    /// <summary>The address waiting for HR, for whoever reads the full Personal tab.</summary>
    public static async Task<PeoplePendingAddressDto?> PendingAddressAsync(
        CoreHRDbContext dbContext, Guid employeeId, PeopleAccessDecision decision, CancellationToken cancellationToken)
    {
        if (decision.Access != PersonalAccess.Full) return null;
        var pending = await dbContext.WorkforceChangeRequests.AsNoTracking()
            .Where(item => item.SubjectEmployeeId == employeeId && item.Kind == WorkforceChangeRequestKind.HomeAddress
                && item.Status == WorkforceChangeRequestStatus.Pending)
            .OrderByDescending(item => item.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (pending is null) return null;
        var address = System.Text.Json.JsonSerializer.Deserialize<PeopleHomeAddressDto>(pending.PayloadJson,
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        return new PeoplePendingAddressDto(pending.Id, address, pending.CreatedAt, pending.RequestedByName);
    }

    public static PeoplePersonalDto Project(Employee employee, PeopleAccessDecision decision, PeoplePendingAddressDto? pendingAddress = null)
    {
        var full = decision.Access == PersonalAccess.Full;
        var contact = decision.Access >= PersonalAccess.Contact;
        return new PeoplePersonalDto(
            employee.StableEmployeeKey,
            decision.Access,
            decision.CanEdit,
            employee.FirstName,
            employee.LastName,
            employee.PreferredName,
            contact ? employee.Phone : null,
            full ? employee.PersonalEmail : null,
            full ? new PeopleHomeAddressDto(employee.HomeStreet, employee.HomeCity, employee.HomePostalCode, employee.HomeCountry) : null,
            full ? employee.DateOfBirth : null,
            full
                ? employee.EmergencyContacts.OrderBy(item => item.Position)
                    .Select(item => new PeopleEmergencyContactDto(item.Name, item.Relationship, item.Phone))
                    .ToList()
                : null,
            employee.Version,
            pendingAddress);
    }
}
