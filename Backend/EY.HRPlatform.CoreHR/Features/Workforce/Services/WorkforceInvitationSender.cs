using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

/// <summary>
/// Brings resolved people into Fusion: a new account gets one invitation, an existing one is linked, connected or
/// reactivated. Each person commits on their own; one failure never undoes the others. The caller resolves the
/// Employees (a person's own scope, or the scheduler's whole company) before anything reaches Identity.
/// </summary>
public sealed class WorkforceInvitationSender(
    IWorkforceAccessIdentityClient workforceAccessClient,
    IWorkforceBulkProvisioner workforceBulkProvisioner)
{
    public async Task<WorkforceAccessBulkResultDto> SendAsync(
        IReadOnlyList<WorkforceEmployeeSummaryDto> employees,
        IReadOnlyDictionary<Guid, string>? baselines,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<Guid, WorkforceAccessCandidateResult> candidates;
        try
        {
            candidates = await workforceAccessClient.ResolveCandidatesAsync(
                employees.Select(employee => new WorkforceAccessCandidateSubject(
                    employee.EmployeeId,
                    NormalizeEmail(employee.WorkEmail))).ToArray(),
                cancellationToken);
        }
        catch
        {
            candidates = new Dictionary<Guid, WorkforceAccessCandidateResult>();
        }

        var results = new WorkforceAccessBulkResultItemDto[employees.Count];
        var invitations = new List<(int Index, WorkforceEmployeeSummaryDto Employee, string Baseline, string AccountState)>();

        for (var index = 0; index < employees.Count; index++)
        {
            var employee = employees[index];
            var display = employee.DisplayName;
            var email = NormalizeEmail(employee.WorkEmail);
            var baseline = NormalizeBaseline(baselines?.GetValueOrDefault(employee.EmployeeId)) ?? RecommendedBaseline(employee.DirectReportCount);
            if (!candidates.TryGetValue(employee.EmployeeId, out var candidate))
            {
                results[index] = new WorkforceAccessBulkResultItemDto(
                    employee.EmployeeId, display, "Failed", null, "The account state could not be resolved.");
                continue;
            }

            switch (candidate.AccountState)
            {
                case WorkforceAccountStates.NewAccount when string.IsNullOrEmpty(email):
                    results[index] = new WorkforceAccessBulkResultItemDto(
                        employee.EmployeeId, display, "Blocked", candidate.AccountState,
                        "No work email — add one before sending an invitation.");
                    break;
                case WorkforceAccountStates.NewAccount:
                    invitations.Add((index, employee, baseline, candidate.AccountState));
                    break;
                case WorkforceAccountStates.ExistingAccountReadyToLink:
                    results[index] = await DispatchMutateAsync(
                        employee, email, "Link", baseline, display, "Linked", "Account linked.", cancellationToken);
                    break;
                case WorkforceAccountStates.SuspendedAccountReadyToReactivate:
                    results[index] = await DispatchMutateAsync(
                        employee, email, "ReactivateAndLink", baseline, display, "Reactivated", "Reactivated and linked.", cancellationToken);
                    break;
                case WorkforceAccountStates.ExistingAccountReadyToJoinTenant:
                    results[index] = await DispatchMutateAsync(
                        employee, email, "Connect", baseline, display, "Linked", "Account connected.", cancellationToken);
                    break;
                case WorkforceAccountStates.Active:
                    results[index] = new WorkforceAccessBulkResultItemDto(
                        employee.EmployeeId, display, "AlreadyActive", candidate.AccountState, "Already active.");
                    break;
                case WorkforceAccountStates.BindingConflict:
                    results[index] = new WorkforceAccessBulkResultItemDto(
                        employee.EmployeeId, display, "Blocked", candidate.AccountState,
                        "Linked to a different employee. Use correction.");
                    break;
                case WorkforceAccountStates.AccountUnavailable:
                    results[index] = new WorkforceAccessBulkResultItemDto(
                        employee.EmployeeId, display, "Blocked", candidate.AccountState, "Account in use elsewhere.");
                    break;
                default:
                    results[index] = new WorkforceAccessBulkResultItemDto(
                        employee.EmployeeId, display, "Failed", candidate.AccountState, "Unrecognised account state.");
                    break;
            }
        }

        if (invitations.Count > 0)
        {
            try
            {
                var provision = await workforceBulkProvisioner.BulkProvisionAsync(
                    invitations.Select(invitation => new WorkforceBulkProvisionSubject(
                        invitation.Employee.EmployeeId,
                        NormalizeEmail(invitation.Employee.WorkEmail)!,
                        invitation.Employee.FirstName,
                        invitation.Employee.LastName,
                        invitation.Baseline)).ToList(),
                    Guid.Empty,
                    cancellationToken);
                var provisionByEmployeeId = provision.Items.ToDictionary(item => item.EmployeeId);

                foreach (var invitation in invitations)
                {
                    var employee = invitation.Employee;
                    var item = provisionByEmployeeId.GetValueOrDefault(employee.EmployeeId);
                    results[invitation.Index] = item?.Outcome switch
                    {
                        "Created" => new WorkforceAccessBulkResultItemDto(
                            employee.EmployeeId, employee.DisplayName, "Invited", invitation.AccountState, "Invitation sent."),
                        "Pending" => new WorkforceAccessBulkResultItemDto(
                            employee.EmployeeId, employee.DisplayName, "AlreadyPending", invitation.AccountState, "Invitation already pending."),
                        "Active" => new WorkforceAccessBulkResultItemDto(
                            employee.EmployeeId, employee.DisplayName, "AlreadyActive", invitation.AccountState, "Already active."),
                        _ => new WorkforceAccessBulkResultItemDto(
                            employee.EmployeeId, employee.DisplayName, "Failed", invitation.AccountState,
                            item?.Message ?? "The invitation could not be issued."),
                    };
                }
            }
            catch
            {
                foreach (var invitation in invitations)
                {
                    var employee = invitation.Employee;
                    results[invitation.Index] = new WorkforceAccessBulkResultItemDto(
                        employee.EmployeeId, employee.DisplayName, "Failed", invitation.AccountState,
                        "The invitation service was unavailable.");
                }
            }
        }

        var completed = results.ToList();
        return new WorkforceAccessBulkResultDto(
            completed,
            completed.Count(r => r.Outcome == "Invited"),
            completed.Count(r => r.Outcome == "Linked"),
            completed.Count(r => r.Outcome == "Reactivated"),
            completed.Count(r => r.Outcome == "AlreadyActive"),
            completed.Count(r => r.Outcome == "Blocked"),
            completed.Count(r => r.Outcome is "Failed" or "Stale"));
    }

    private async Task<WorkforceAccessBulkResultItemDto> DispatchMutateAsync(
        WorkforceEmployeeSummaryDto employee, string? email, string action, string baseline,
        string display, string okOutcome, string okMessage, CancellationToken cancellationToken)
    {
        var result = await workforceAccessClient.MutateAsync(employee.EmployeeId, email, action, baseline, cancellationToken);
        return result.Outcome switch
        {
            "Ok" => new WorkforceAccessBulkResultItemDto(employee.EmployeeId, display, okOutcome, result.AccountState, okMessage),
            "Conflict" => new WorkforceAccessBulkResultItemDto(employee.EmployeeId, display, "Blocked", result.AccountState, result.Message),
            "Unavailable" => new WorkforceAccessBulkResultItemDto(employee.EmployeeId, display, "Blocked", result.AccountState, result.Message),
            _ => new WorkforceAccessBulkResultItemDto(employee.EmployeeId, display, "Stale", result.AccountState, result.Message),
        };
    }

    internal static string RecommendedBaseline(int directReportCount)
        => directReportCount > 0 ? WorkforceBaselineChoices.Manager : WorkforceBaselineChoices.Employee;

    internal static string? NormalizeBaseline(string? baseline)
        => string.Equals(baseline, WorkforceBaselineChoices.Manager, StringComparison.OrdinalIgnoreCase)
            ? WorkforceBaselineChoices.Manager
            : string.Equals(baseline, WorkforceBaselineChoices.Employee, StringComparison.OrdinalIgnoreCase)
                ? WorkforceBaselineChoices.Employee
                : null;

    internal static string? NormalizeEmail(string? email)
        => string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
}
