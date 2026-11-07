using System.Data;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed class HireEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IEmployeeNumberAllocator employeeNumberAllocator,
    IWorkforceMutationService mutationService,
    IOrganizationService organizationService,
    CoreChangeNotifications? notifications = null,
    ITenantSettingsReadService? settings = null,
    PeopleInvitations? invitations = null)
    : ICommandHandler<HireEmployeeCommand, Result<EstablishmentResultDto>>
{
    public Task<Result<EstablishmentResultDto>> Handle(HireEmployeeCommand command, CancellationToken cancellationToken)
        => EstablishmentOrchestrator.ExecuteAsync(
            dbContext,
            tenantContext,
            employeeNumberAllocator,
            mutationService,
            organizationService,
            EstablishmentInput.FromHire(command.Request) with { CanInvite = command.CanInvite },
            command.Actor,
            cancellationToken,
            notifications,
            settings,
            invitations);
}

public sealed class AddExistingEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IEmployeeNumberAllocator employeeNumberAllocator,
    IWorkforceMutationService mutationService,
    IOrganizationService organizationService,
    ITenantSettingsReadService? settings = null,
    PeopleInvitations? invitations = null)
    : ICommandHandler<AddExistingEmployeeCommand, Result<EstablishmentResultDto>>
{
    public Task<Result<EstablishmentResultDto>> Handle(AddExistingEmployeeCommand command, CancellationToken cancellationToken)
        => EstablishmentOrchestrator.ExecuteAsync(
            dbContext,
            tenantContext,
            employeeNumberAllocator,
            mutationService,
            organizationService,
            EstablishmentInput.FromAddExisting(command.Request) with { CanInvite = command.CanInvite },
            command.Actor,
            cancellationToken,
            settings: settings,
            invitations: invitations);
}

internal sealed record EstablishmentInput(
    string FirstName,
    string LastName,
    string? PreferredName,
    string? WorkEmail,
    string? Phone,
    EmployeeNumberMode NumberMode,
    string? ManualEmployeeNumber,
    DateTime EmploymentStart,
    DateTime WorkEffectiveFrom,
    Guid? EmploymentTypeId,
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId,
    Guid? ManagerEmployeeId,
    WorkforceAuditAction EstablishmentAction,
    string? SourceReference = null,
    Guid? OpenRoleId = null,
    HireInvite? Invite = null,
    IReadOnlyDictionary<string, JsonElement>? Fields = null,
    bool CanInvite = false)
{
    public static EstablishmentInput FromHire(HireEmployeeRequest request) => new(
        request.FirstName, request.LastName, request.PreferredName, request.WorkEmail, request.Phone,
        request.EmployeeNumberMode, request.EmployeeNumber, request.StartDate, request.StartDate,
        request.EmploymentTypeId, request.OrgUnitId, request.JobId, request.PlaceId,
        request.PrimaryManagerEmployeeId, WorkforceAuditAction.Hire, null, request.OpenRoleId, request.Invite, request.Fields);

    public static EstablishmentInput FromAddExisting(AddExistingEmployeeRequest request) => new(
        request.FirstName, request.LastName, request.PreferredName, request.WorkEmail, request.Phone,
        request.EmployeeNumberMode, request.EmployeeNumber, request.EmploymentStart, request.WorkDetailsEffectiveFrom,
        request.EmploymentTypeId, request.OrgUnitId, request.JobId, request.PlaceId,
        request.PrimaryManagerEmployeeId, WorkforceAuditAction.Establish, null, request.OpenRoleId, request.Invite, request.Fields);
}

internal static class EstablishmentOrchestrator
{
    public static async Task<Result<EstablishmentResultDto>> ExecuteAsync(
        CoreHRDbContext dbContext,
        ITenantContext tenantContext,
        IEmployeeNumberAllocator employeeNumberAllocator,
        IWorkforceMutationService mutationService,
        IOrganizationService organizationService,
        EstablishmentInput input,
        string actor,
        CancellationToken cancellationToken,
        CoreChangeNotifications? notifications = null,
        ITenantSettingsReadService? settings = null,
        PeopleInvitations? invitations = null)
    {
        var employmentStart = NormalizeDate(input.EmploymentStart);
        var workEffectiveFrom = NormalizeDate(input.WorkEffectiveFrom);
        var now = DateTime.UtcNow;
        var today = now.Date;

        var validation = Validate(input, employmentStart, workEffectiveFrom, today);
        if (validation is not null)
            return Result.Failure<EstablishmentResultDto>(validation);

        // The company's first-day invitation covers a joiner unless HR says otherwise; anything sent on top needs access rights.
        var companyFirstDay = settings is null
            || (await settings.GetCurrentAsync(cancellationToken)).Provisioning.InviteJoinersOnFirstDay;
        var ownFirstDay = input.Invite == HireInvite.FirstDay && !companyFirstDay;
        if ((input.Invite == HireInvite.Now || ownFirstDay) && !input.CanInvite)
            return Result.Failure<EstablishmentResultDto>(new Error(
                "Invite.Forbidden", "You can't send invitations. Choose Later, and someone who manages access can invite them.", Field("invite")));
        var sendNow = input.Invite == HireInvite.Now || (ownFirstDay && employmentStart <= today);

        var fields = await ReadFieldsAsync(dbContext, input.Fields, cancellationToken);
        if (fields.IsFailure)
            return Result.Failure<EstablishmentResultDto>(fields.Error);

        var useTransaction = dbContext.Database.IsRelational();
        await using var transaction = useTransaction
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        try
        {
            var number = input.NumberMode == EmployeeNumberMode.Generated
                ? await employeeNumberAllocator.AllocateAsync(cancellationToken)
                : input.ManualEmployeeNumber!.Trim().ToUpperInvariant();
            var numberOwner = await dbContext.Employees.AsNoTracking()
                .Where(employee => employee.EmployeeNumber == number)
                .Select(employee => new
                {
                    employee.StableEmployeeKey,
                    DisplayName = (employee.PreferredName ?? employee.FirstName) + " " + employee.LastName
                })
                .FirstOrDefaultAsync(cancellationToken);
            if (numberOwner is not null)
            {
                await RollbackAsync(transaction, cancellationToken);
                return Result.Failure<EstablishmentResultDto>(Error.Conflict(
                    "EmployeeNumber.AlreadyOwned",
                    $"Employee number {number} already belongs to {numberOwner.DisplayName}. Open /core/people/{numberOwner.StableEmployeeKey}."));
            }

            OpenRole? role = null;
            if (input.OpenRoleId is { } roleId)
            {
                // Read inside the tenant filter: another company's role is refused like one that doesn't exist.
                role = await dbContext.OpenRoles.FirstOrDefaultAsync(item => item.Id == roleId, cancellationToken);
                var refusal = role is null
                    ? Error.Validation("OpenRole.Missing", "That open role isn't here any more. Pick another, or none.", Field("openRole"))
                    : !role.IsActive
                        ? Error.Validation("OpenRole.Taken", "That role was already filled or closed.", Field("openRole"))
                        : role.ManagerEmployeeId != input.ManagerEmployeeId
                            ? Error.Validation("OpenRole.OtherManager", "That role reports to someone else. Pick its manager, or another role.", Field("openRole"))
                            : null;
                if (refusal is not null)
                {
                    await RollbackAsync(transaction, cancellationToken);
                    return Result.Failure<EstablishmentResultDto>(refusal);
                }
            }

            var suggestions = await FindSuggestionsAsync(dbContext, input, cancellationToken);
            var employee = Employee.Create(
                tenantContext.TenantId,
                input.FirstName,
                input.LastName,
                input.WorkEmail,
                employmentStart,
                department: null,
                jobTitle: null,
                employeeNumber: number,
                phone: input.Phone,
                workLocation: null,
                employmentType: null);
            if (!string.IsNullOrWhiteSpace(input.PreferredName))
                employee.UpdateProfile(input.FirstName, input.LastName, input.WorkEmail, input.PreferredName, input.Phone);
            dbContext.Employees.Add(employee);

            var employmentResult = await mutationService.StartEmploymentAsync(
                employee.Id,
                new StartEmploymentInput(employmentStart, input.EmploymentTypeId, WorkforceSourceType.Manual, input.SourceReference),
                actor,
                cancellationToken);
            if (employmentResult.IsFailure)
                return await FailAsync(dbContext, transaction, employmentResult.Error, cancellationToken);

            var assignmentResult = await mutationService.ChangeWorkAssignmentAsync(
                employee.Id,
                new ChangeWorkAssignmentInput(
                    input.OrgUnitId,
                    input.JobId,
                    input.PlaceId,
                    workEffectiveFrom,
                    WorkforceSourceType.Manual, input.SourceReference),
                actor,
                cancellationToken);
            if (assignmentResult.IsFailure)
                return await FailAsync(dbContext, transaction, assignmentResult.Error, cancellationToken);

            string? managerName = null;
            if (input.ManagerEmployeeId.HasValue)
            {
                var managerResult = await mutationService.ChangeManagerAsync(
                    employee.Id,
                    new ChangeManagerInput(
                        input.ManagerEmployeeId.Value,
                        workEffectiveFrom,
                        WorkforceSourceType.Manual),
                    actor,
                    cancellationToken);
                if (managerResult.IsFailure)
                    return await FailAsync(dbContext, transaction, managerResult.Error, cancellationToken);

                managerName = await dbContext.Employees
                    .Where(item => item.Id == input.ManagerEmployeeId.Value)
                    .Select(item => (item.PreferredName ?? item.FirstName) + " " + item.LastName)
                    .FirstAsync(cancellationToken);
            }

            var orgUnit = await organizationService.GetUnitAsync(
                input.OrgUnitId,
                DateOnly.FromDateTime(workEffectiveFrom),
                cancellationToken);
            dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
                tenantContext.TenantId,
                "Employee",
                employee.Id,
                input.EstablishmentAction,
                WorkforceSourceType.Manual,
                actor,
                employmentStart,
                sourceReference: input.SourceReference,
                changeDetails: input.EstablishmentAction == WorkforceAuditAction.Hire
                    ? $"Hire established Employment and work from {employmentStart:yyyy-MM-dd}."
                    : $"Employee established with Employment from {employmentStart:yyyy-MM-dd} and work from {workEffectiveFrom:yyyy-MM-dd}."));

            if (input.EstablishmentAction == WorkforceAuditAction.Hire)
            {
                // A hire is a Join change, so a scheduled one shows as coming and can be cancelled.
                var manager = input.ManagerEmployeeId is { } managerId
                    ? Changes.WorkforceChangeService.Ref(await dbContext.Employees.FirstAsync(item => item.Id == managerId, cancellationToken))
                    : null;
                var details = Changes.WorkforceChangeService.JoinDetails(
                    manager, input.OrgUnitId, orgUnit.Name, assignmentResult.Value, employmentResult.Value, isHire: true);
                var change = Changes.WorkforceChangeRecorder.Record(
                    dbContext, tenantContext.TenantId, employee.Id, WorkforceChangeKind.Join, DateOnly.FromDateTime(employmentStart), null,
                    details, actor);
                // The new hire's manager hears who joins their team.
                if (notifications is not null)
                    await notifications.StageAsync(change, details, cancellationToken);
                await Checklists.ChecklistService.StageAsync(dbContext, tenantContext.TenantId, change, details, actor, cancellationToken);
            }

            role?.Fill(employee.Id, DateOnly.FromDateTime(employmentStart), actor);
            foreach (var (fieldId, json) in fields.Value)
                dbContext.EmployeeFieldValues.Add(EmployeeFieldValue.Create(tenantContext.TenantId, employee.Id, fieldId, json, actor));

            if (input.Invite == HireInvite.Later && companyFirstDay)
                // Counted as handled, so the company's first-day send leaves them for HR to invite when they choose.
                dbContext.InvitationAutoSends.Add(InvitationAutoSend.Record(
                    tenantContext.TenantId, employee.Id, InvitationAutoSendKind.FirstDay, employmentResult.Value.Id, now));
            if (ownFirstDay && !sendNow)
            {
                if (employmentStart > today.AddYears(1))
                    return await FailAsync(dbContext, transaction, Error.Validation(
                        "Invite.TooFar", "Invitations can be planned up to a year ahead. Choose Later.", Field("invite")), cancellationToken);
                dbContext.InvitationSchedules.Add(InvitationSchedule.Plan(
                    tenantContext.TenantId, InvitationAudience.Chosen, [employee.Id], employmentStart.AddHours(8), now, actor));
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
                await transaction.CommitAsync(cancellationToken);

            var invitation = input.Invite switch { HireInvite.FirstDay => "FirstDay", HireInvite.Now => "Sent", HireInvite.Later => "Later", _ => companyFirstDay && input.EstablishmentAction == WorkforceAuditAction.Hire ? "FirstDay" : "Later" };
            if (sendNow)
                invitation = invitations is not null && await invitations.InviteOneAsync(employee.Id, cancellationToken) ? "Sent" : "NotSent";

            return Result.Success(new EstablishmentResultDto(
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                employee.DisplayName,
                employee.Email,
                employmentStart > today ? PeopleEmploymentState.Scheduled : PeopleEmploymentState.Active,
                employmentStart,
                workEffectiveFrom,
                assignmentResult.Value.JobTitle,
                orgUnit.Name,
                orgUnit.Path,
                assignmentResult.Value.WorkLocation,
                managerName,
                suggestions,
                invitation));
        }
        catch (DbUpdateException exception) when (TryMapConstraint(exception, out var error))
        {
            await RollbackAsync(transaction, cancellationToken);
            dbContext.ChangeTracker.Clear();
            return Result.Failure<EstablishmentResultDto>(error);
        }
        catch
        {
            await RollbackAsync(transaction, cancellationToken);
            dbContext.ChangeTracker.Clear();
            throw;
        }
    }

    private static Error? Validate(
        EstablishmentInput input,
        DateTime employmentStart,
        DateTime workEffectiveFrom,
        DateTime today)
    {
        if (string.IsNullOrWhiteSpace(input.FirstName) || string.IsNullOrWhiteSpace(input.LastName))
            return Error.Validation("Employee.NameRequired", "First name and last name are required.");
        if (input.OrgUnitId == Guid.Empty)
            return Error.Validation("WorkAssignment.OrgUnitRequired", "Organization is required.");
        if (input.JobId == Guid.Empty)
            return Error.Validation("WorkAssignment.JobRequired", "Pick a job.");
        if (input.NumberMode == EmployeeNumberMode.Manual && string.IsNullOrWhiteSpace(input.ManualEmployeeNumber))
            return Error.Validation("EmployeeNumber.Required", "Enter an Employee Number or choose Generate automatically.");
        if (input.NumberMode == EmployeeNumberMode.Generated && !string.IsNullOrWhiteSpace(input.ManualEmployeeNumber))
            return Error.Validation("EmployeeNumber.ModeMismatch", "Generated Employee Numbers cannot include a manual value.");
        if (input.EstablishmentAction == WorkforceAuditAction.Hire && employmentStart < today)
            return Error.Validation("Hire.StartDatePast", "Hire start date must be Today or later. Use Add existing employee for a past start.");
        if (input.EstablishmentAction == WorkforceAuditAction.Establish && employmentStart > today)
            return Error.Validation("Establish.StartDateFuture", "Employment start cannot be in the future. Use Hire employee instead.");
        if (workEffectiveFrom < employmentStart
            || (workEffectiveFrom > today && input.EstablishmentAction == WorkforceAuditAction.Establish))
            return Error.Validation("Establish.DateOrder", "Work details effective from must be on or after Employment start and no later than Today.");
        if (input.EstablishmentAction == WorkforceAuditAction.Hire && workEffectiveFrom != employmentStart)
            return Error.Validation("Hire.DateAlignment", "Hire work details must begin on the Employment start date.");
        if (input.Invite is { } chosen && !Enum.IsDefined(chosen))
            return Error.Validation("Invite.Unknown", "Choose when to invite them.", Field("invite"));
        if (input.Invite == HireInvite.FirstDay && input.EstablishmentAction != WorkforceAuditAction.Hire)
            return Error.Validation("Invite.FirstDayPast", "Their first day has passed. Invite them now or later.", Field("invite"));
        if (input.Invite is HireInvite.Now or HireInvite.FirstDay && string.IsNullOrWhiteSpace(input.WorkEmail))
            return Error.Validation("Invite.NeedsEmail", "Add a work email to invite them, or choose Later.", Field("workEmail"));
        if (input.OpenRoleId is not null && input.ManagerEmployeeId is null)
            return Error.Validation("OpenRole.OtherManager", "Pick the manager the role reports to.", Field("openRole"));
        return null;
    }

    private static object Field(string name) => new { field = name };

    /// <summary>
    /// The values given for the company's own fields, checked against its catalogue: known keys only, each in its
    /// field's shape, and every required field answered.
    /// </summary>
    private static async Task<Result<List<(Guid FieldId, string Json)>>> ReadFieldsAsync(
        CoreHRDbContext dbContext, IReadOnlyDictionary<string, JsonElement>? given, CancellationToken cancellationToken)
    {
        var definitions = await dbContext.EmployeeFieldDefinitions.AsNoTracking()
            .Where(item => item.IsActive && item.SourceKey == null && item.Type != EmployeeFieldType.Section)
            .ToListAsync(cancellationToken);
        var byKey = definitions.ToDictionary(item => item.Key, StringComparer.OrdinalIgnoreCase);
        var values = new List<(Guid FieldId, string Json)>();
        foreach (var (key, value) in given ?? new Dictionary<string, JsonElement>())
        {
            if (!byKey.TryGetValue(CatalogName.Slug(key), out var definition))
                return Fail("EmployeeField.Unknown", "That field isn't one of the company's.", key);
            string json;
            try
            {
                json = EmployeeFieldService.NormalizeValue(definition.Type, value).GetRawText();
            }
            catch (ArgumentException exception)
            {
                return Fail("EmployeeField.Invalid", exception.Message, definition.Key);
            }
            if (EmployeeFieldService.HasValue(json)) values.Add((definition.Id, json));
        }
        var missing = definitions
            .Where(item => item.Required && values.All(value => value.FieldId != item.Id))
            .OrderBy(item => item.Area).ThenBy(item => item.SortOrder)
            .FirstOrDefault();
        return missing is not null
            ? Fail("EmployeeField.Required", $"{missing.Label} is required.", missing.Key)
            : Result.Success(values);

        static Result<List<(Guid FieldId, string Json)>> Fail(string code, string message, string key)
            => Result.Failure<List<(Guid FieldId, string Json)>>(Error.Validation(code, message, Field("fields." + key)));
    }

    private static async Task<IReadOnlyList<EstablishmentSuggestionDto>> FindSuggestionsAsync(
        CoreHRDbContext dbContext,
        EstablishmentInput input,
        CancellationToken cancellationToken)
    {
        var first = input.FirstName.Trim().ToLowerInvariant();
        var last = input.LastName.Trim().ToLowerInvariant();
        var email = string.IsNullOrWhiteSpace(input.WorkEmail) ? null : input.WorkEmail.Trim().ToLowerInvariant();
        return await dbContext.Employees.AsNoTracking()
            .Where(employee =>
                (employee.FirstName.ToLower() == first && employee.LastName.ToLower() == last)
                || (email != null && employee.Email == email))
            .OrderBy(employee => employee.LastName)
            .ThenBy(employee => employee.FirstName)
            .Take(3)
            .Select(employee => new EstablishmentSuggestionDto(
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                (employee.PreferredName ?? employee.FirstName) + " " + employee.LastName,
                email != null && employee.Email == email ? "Same work email" : "Same name"))
            .ToListAsync(cancellationToken);
    }

    private static async Task<Result<EstablishmentResultDto>> FailAsync(
        CoreHRDbContext dbContext,
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction,
        Error error,
        CancellationToken cancellationToken)
    {
        await RollbackAsync(transaction, cancellationToken);
        dbContext.ChangeTracker.Clear();
        return Result.Failure<EstablishmentResultDto>(error);
    }

    private static async Task RollbackAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction,
        CancellationToken cancellationToken)
    {
        if (transaction is not null)
            await transaction.RollbackAsync(cancellationToken);
    }

    private static bool TryMapConstraint(DbUpdateException exception, out Error error)
    {
        var postgres = exception.InnerException as PostgresException;
        error = postgres?.ConstraintName switch
        {
            "IX_Employees_TenantId_EmployeeNumber" => Error.Conflict(
                "EmployeeNumber.AlreadyOwned", "That Employee Number was just assigned. Review the existing Employee and choose another number."),
            "UX_WorkEmailOccupancies_TenantId_NormalizedEmail" => Error.Conflict(
                "WorkEmail.Occupied", "That work email is already used by an active or scheduled Employee."),
            _ => Error.Conflict("Establishment.ConcurrentChange", "The workforce changed while this employee was being added. Review and try again.")
        };
        return postgres?.SqlState == PostgresErrorCodes.UniqueViolation;
    }

    private static DateTime NormalizeDate(DateTime value)
        => DateTime.SpecifyKind(value.Date, DateTimeKind.Utc);
}
