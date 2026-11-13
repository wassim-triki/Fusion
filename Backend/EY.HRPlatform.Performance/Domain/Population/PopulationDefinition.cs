using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Population;

/// <summary>
/// How a Cycle's population is selected: the mode, any selected organizational units, and
/// explicit individual inclusions/exclusions. One per Cycle. This records the <em>rule</em>;
/// the confirmed named roster is the set of <see cref="Participant"/> records frozen at
/// confirmation. Eligibility is always evaluated as-of the Cycle start date.
/// </summary>
public sealed class PopulationDefinition : PerformanceAggregate
{
    private readonly List<PopulationOrgUnitSelection> _orgUnitSelections = [];
    private readonly List<PopulationInclusion> _inclusions = [];
    private readonly List<PopulationExclusion> _exclusions = [];

    private PopulationDefinition() { }

    public Guid CycleId { get; private set; }
    public PopulationMode Mode { get; private set; }
    public DateOnly EligibilityDate { get; private set; }
    public bool IsConfirmed { get; private set; }
    public DateTime? ConfirmedAt { get; private set; }

    public IReadOnlyList<PopulationOrgUnitSelection> OrgUnitSelections => _orgUnitSelections;
    public IReadOnlyList<PopulationInclusion> Inclusions => _inclusions;
    public IReadOnlyList<PopulationExclusion> Exclusions => _exclusions;

    public static PopulationDefinition Create(Guid tenantId, Guid cycleId, DateOnly eligibilityDate)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (cycleId == Guid.Empty) throw new ArgumentException("CycleId is required.", nameof(cycleId));

        return new PopulationDefinition
        {
            TenantId = tenantId,
            CycleId = cycleId,
            Mode = PopulationMode.AllActive,
            EligibilityDate = eligibilityDate,
        };
    }

    /// <summary>
    /// Who's in (D-104): everyone active in Core HR on the year's first day, less the Leave out rules, with exceptions by
    /// name and a reason: one person left out though no rule catches them, or brought in though one does. Editing it
    /// clears any prior confirmation.
    /// </summary>
    public void SetWhoIsIn(IEnumerable<LeaveOutRule> rules, IEnumerable<(Guid EmployeeId, bool In, string Reason)> exceptions)
    {
        GuardDraft();
        _orgUnitSelections.Clear();
        _inclusions.Clear();
        _exclusions.Clear();
        LeaveOut = rules.Select(rule => rule.ToString()).Distinct().ToList();

        foreach (var (employeeId, brought, reason) in exceptions)
        {
            if (employeeId == Guid.Empty) continue;
            if (string.IsNullOrWhiteSpace(reason))
                throw new ArgumentException("An exception by name requires a reason.", nameof(exceptions));
            if (IsExcluded(employeeId) || IsExplicitlyIncluded(employeeId)) continue;
            var why = reason.Trim();
            if (why.Length > 500) throw new ArgumentException("A reason is at most 500 characters.", nameof(exceptions));
            if (brought) _inclusions.Add(PopulationInclusion.Create(TenantId, Id, employeeId, why));
            else _exclusions.Add(PopulationExclusion.Create(TenantId, Id, employeeId, why));
        }

        Mode = PopulationMode.AllActive;
        IsConfirmed = false;
        ConfirmedAt = null;
        MarkUpdated();
    }

    /// <summary>The Leave out rules, each as <see cref="LeaveOutRule"/> writes it.</summary>
    public List<string> LeaveOut { get; private set; } = [];

    public IReadOnlyList<LeaveOutRule> Rules => LeaveOut.Select(LeaveOutRule.Parse).ToList();

    public void MarkConfirmed()
    {
        GuardDraft();
        IsConfirmed = true;
        ConfirmedAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    public void Reopen()
    {
        GuardDraft();
        IsConfirmed = false;
        ConfirmedAt = null;
        MarkUpdated();
    }

    /// <summary>
    /// Realigns eligibility to a new as-of date (the Cycle's start date). Because the roster is
    /// resolved as-of this date, moving it invalidates any prior confirmation — the caller must
    /// re-resolve and re-confirm against the new date.
    /// </summary>
    public void RealignEligibility(DateOnly eligibilityDate)
    {
        GuardDraft();
        if (eligibilityDate == EligibilityDate) return;
        EligibilityDate = eligibilityDate;
        IsConfirmed = false;
        ConfirmedAt = null;
        MarkUpdated();
    }

    private void GuardDraft()
    {
        // The confirmed-vs-draft distinction here is about the population rule while the
        // Cycle is still Draft. The Cycle aggregate guards that population is only edited
        // before activation; this aggregate carries no lifecycle of its own beyond confirm.
    }

    public bool IsExcluded(Guid employeeId) => _exclusions.Any(exclusion => exclusion.EmployeeId == employeeId);

    public bool IsExplicitlyIncluded(Guid employeeId) => _inclusions.Any(inclusion => inclusion.EmployeeId == employeeId);

    public string? ExclusionReason(Guid employeeId)
        => _exclusions.FirstOrDefault(exclusion => exclusion.EmployeeId == employeeId)?.Reason;

    public string? InclusionReason(Guid employeeId)
        => _inclusions.FirstOrDefault(inclusion => inclusion.EmployeeId == employeeId)?.Reason;
}

public sealed class PopulationOrgUnitSelection : PerformanceChildEntity
{
    private PopulationOrgUnitSelection() { }

    public Guid PopulationDefinitionId { get; private set; }
    public Guid OrgUnitId { get; private set; }
    public bool IncludeDescendants { get; private set; }

    public static PopulationOrgUnitSelection Create(Guid tenantId, Guid populationDefinitionId, Guid orgUnitId, bool includeDescendants)
        => new()
        {
            TenantId = tenantId,
            PopulationDefinitionId = populationDefinitionId,
            OrgUnitId = orgUnitId,
            IncludeDescendants = includeDescendants,
        };
}

public sealed class PopulationInclusion : PerformanceChildEntity
{
    private PopulationInclusion() { }

    public Guid PopulationDefinitionId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public string? Reason { get; private set; }

    public static PopulationInclusion Create(Guid tenantId, Guid populationDefinitionId, Guid employeeId, string? reason = null)
        => new()
        {
            TenantId = tenantId,
            PopulationDefinitionId = populationDefinitionId,
            EmployeeId = employeeId,
            Reason = reason,
        };
}

public sealed class PopulationExclusion : PerformanceChildEntity
{
    private PopulationExclusion() { }

    public Guid PopulationDefinitionId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public string Reason { get; private set; } = string.Empty;

    public static PopulationExclusion Create(Guid tenantId, Guid populationDefinitionId, Guid employeeId, string reason)
        => new()
        {
            TenantId = tenantId,
            PopulationDefinitionId = populationDefinitionId,
            EmployeeId = employeeId,
            Reason = reason,
        };
}

/// <summary>
/// One Leave out rule (D-104): people of an employment type, in a unit (with the units under it), who started after a
/// date, or on leave on the year's first day. Written "employmentType:Contractor", "unit:{id}", "startedAfter:2028-03-01"
/// or "onLeave".
/// </summary>
public sealed record LeaveOutRule(string Kind, string? Value)
{
    public const string EmploymentType = "employmentType";
    public const string Unit = "unit";
    public const string StartedAfter = "startedAfter";
    public const string OnLeave = "onLeave";

    public static LeaveOutRule Parse(string text)
    {
        var at = (text ?? string.Empty).IndexOf(':');
        var kind = at < 0 ? text?.Trim() ?? string.Empty : text![..at].Trim();
        var value = at < 0 ? null : text![(at + 1)..].Trim();
        var valid = kind switch
        {
            EmploymentType => !string.IsNullOrWhiteSpace(value) && value.Length <= 100,
            Unit => Guid.TryParse(value, out _),
            StartedAfter => DateOnly.TryParseExact(value, "yyyy-MM-dd", out _),
            OnLeave => value is null,
            _ => false,
        };
        if (!valid) throw new ArgumentException($"\"{text}\" is not a rule for who's left out.", nameof(text));
        return new LeaveOutRule(kind, value);
    }

    public Guid? UnitId => Kind == Unit ? Guid.Parse(Value!) : null;
    public DateOnly? Date => Kind == StartedAfter ? DateOnly.ParseExact(Value!, "yyyy-MM-dd") : null;

    public override string ToString() => Value is null ? Kind : $"{Kind}:{Value}";
}
