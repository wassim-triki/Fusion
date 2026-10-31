using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
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
/// <param name="ViewsTenant">Reads every employee (<c>core.employee.view</c> at tenant scope).</param>
/// <param name="ManagesTeam">A manager who reads their own branch.</param>
/// <param name="UpdatesSelf">May change their own profile (<c>core.profile.self.update</c>).</param>
public sealed record PeopleViewer(
    Guid? EmployeeId,
    bool ManagesPeople,
    bool ViewsTenant,
    bool ManagesTeam,
    bool UpdatesSelf);

/// <summary>How much of a person's personal details a viewer may read.</summary>
public enum PersonalAccess
{
    /// <summary>The preferred name only: what any colleague sees.</summary>
    Directory,
    /// <summary>Adds the mobile: a manager for their branch, and tenant-wide readers.</summary>
    Contact,
    /// <summary>Everything: the person themselves and people admins.</summary>
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
        var isSelf = viewer.EmployeeId == employeeId;
        if (viewer.ManagesPeople)
            return new(PersonalAccess.Full, CanEdit: true, CanReadJobHistory: true);
        if (isSelf)
            return new(PersonalAccess.Full, CanEdit: viewer.UpdatesSelf, CanReadJobHistory: viewer.ViewsTenant);
        if (viewer.ViewsTenant)
            return new(PersonalAccess.Contact, CanEdit: false, CanReadJobHistory: true);
        if (viewer.ManagesTeam && viewer.EmployeeId is { } managerId
            && (await Changes.ChangeSupport.BranchAsync(dbContext, managerId, cancellationToken)).Contains(employeeId))
            return new(PersonalAccess.Contact, CanEdit: false, CanReadJobHistory: true);
        return new(PersonalAccess.Directory, CanEdit: false, CanReadJobHistory: false);
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
    PeoplePendingAddressDto? PendingHomeAddress = null);

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

public sealed record UpdatePeoplePersonalCommand(
    string EmployeeKey,
    PeopleViewer Viewer,
    uint ExpectedVersion,
    UpdatePersonalRequest Request,
    string Actor) : ICommand<Result<PeoplePersonalDto>>;

// --- Handlers ---------------------------------------------------------------------------------------

public sealed class PeoplePersonalQueryHandler(CoreHRDbContext dbContext)
    : IQueryHandler<PeoplePersonalQuery, Result<PeoplePersonalDto>>
{
    public async Task<Result<PeoplePersonalDto>> Handle(PeoplePersonalQuery request, CancellationToken cancellationToken)
    {
        var employee = await PersonalSupport.FindAsync(dbContext, request.EmployeeKey, tracked: false, cancellationToken);
        if (employee is null)
            return Result.Failure<PeoplePersonalDto>(new Error("Employee.NotFound", "Employee was not found."));

        var decision = await PeopleAccess.DecideAsync(dbContext, request.Viewer, employee.Id, cancellationToken);
        return Result.Success(PersonalSupport.Project(employee, decision, await PersonalSupport.PendingAddressAsync(dbContext, employee.Id, decision, cancellationToken)));
    }
}

public sealed class UpdatePeoplePersonalCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    ITenantSettingsReadService? tenantSettingsReadService = null,
    Changes.ChangeRequestService? changeRequests = null)
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
        if (!command.Viewer.ManagesPeople)
        {
            var selfService = (await tenantSettingsReader.GetCurrentAsync(cancellationToken)).SelfService;
            if (!selfService.CanEditPreferredName && Blank(body.PreferredName) != employee.PreferredName)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your preferred name."));
            if (!selfService.CanEditPhone && Blank(body.Mobile) != employee.Phone)
                return Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("Your company doesn't let you change your mobile."));
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
            if (!command.Viewer.ManagesPeople && changeRequests is not null
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
