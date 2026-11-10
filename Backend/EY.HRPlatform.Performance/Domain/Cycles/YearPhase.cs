namespace EY.HRPlatform.Performance.Domain.Cycles;

/// <summary>What already happened in a year: the evidence the phase is read from.</summary>
public sealed record YearEvidence(bool RoundLaunched, bool ResultsReleased)
{
    public static readonly YearEvidence None = new(false, false);
}

/// <summary>
/// The one phase rule (D-34): the year's step reads from what happened and the dates together and
/// never goes backwards. Results released → Results out; a round launched → Review; planning closed by
/// HR or the deadline passed → Execution; else Planning. Null for a Draft or Closed year.
/// </summary>
public static class YearPhase
{
    public static CyclePhase? Of(PerformanceCycle cycle, DateOnly today, YearEvidence evidence)
    {
        if (!cycle.IsActive) return null;
        if (evidence.ResultsReleased) return CyclePhase.ResultsOut;
        if (evidence.RoundLaunched) return CyclePhase.Review;
        if (cycle.PlanningClosedOn is not null || today > cycle.PlanningDeadline) return CyclePhase.Execution;
        return CyclePhase.Planning;
    }
}
