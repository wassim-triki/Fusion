using System.Globalization;
using EY.HRPlatform.SharedKernel.Api;

namespace EY.HRPlatform.Performance.Features.Work;

/// <summary>
/// The path a plan or review item belongs to, composed for the home's lead (fusion-attention): where the work stands
/// without the shell knowing Performance's kinds. Text is English, like the rest of the work-item contract.
/// </summary>
public static class WorkSteps
{
    private static FusionWorkStepDto Step(string label, string? detail, string state) => new(label, detail, state);

    public static string Due(DateOnly? date) => date is DateOnly d ? $"Due {d.ToString("ddd d MMM", CultureInfo.InvariantCulture)}" : "No due date";

    public static string FirstName(string? displayName)
        => string.IsNullOrWhiteSpace(displayName) ? "Your reviewer" : displayName.Trim().Split(' ')[0];

    /// <summary>Writing or revising one's plan: you, then the reviewer's decision, then the year.</summary>
    public static IReadOnlyList<FusionWorkStepDto> Plan(bool returned, int openChanges, string? reviewerName) =>
    [
        Step(returned ? "You revise it" : "You write it",
            returned ? (openChanges == 1 ? "1 change" : openChanges > 1 ? $"{openChanges} changes" : "Returned") : "Draft",
            FusionWorkStepDto.Current),
        Step($"{FirstName(reviewerName)} approves", reviewerName, FusionWorkStepDto.Upcoming),
        Step("Your year starts", "Progress and status", FusionWorkStepDto.Upcoming),
    ];

    /// <summary>The subject's self-assessment: you, the reviewer, calibration when the round has it, the result.</summary>
    public static IReadOnlyList<FusionWorkStepDto> SelfAssessment(
        string reviewerName, DateOnly? selfDue, DateOnly? managerDue, bool calibration)
    {
        var steps = new List<FusionWorkStepDto>
        {
            Step("You", Due(selfDue), FusionWorkStepDto.Current),
            Step(FirstName(reviewerName), Due(managerDue), FusionWorkStepDto.Upcoming),
        };
        if (calibration) steps.Add(Step("Calibration", "HR", FusionWorkStepDto.Upcoming));
        steps.Add(Step("Your result", "Released by HR", FusionWorkStepDto.Upcoming));
        return steps;
    }

    /// <summary>The reviewer's assessment: the person's self-assessment, you, calibration when on, the release.</summary>
    public static IReadOnlyList<FusionWorkStepDto> ManagerAssessment(
        string subjectName, bool selfAssessmentEnabled, DateOnly? managerDue, bool calibration)
    {
        var steps = new List<FusionWorkStepDto>
        {
            Step(FirstName(subjectName), selfAssessmentEnabled ? "Self-assessment in" : "No self-assessment", FusionWorkStepDto.Done),
            Step("You", Due(managerDue), FusionWorkStepDto.Current),
        };
        if (calibration) steps.Add(Step("Calibration", "HR", FusionWorkStepDto.Upcoming));
        steps.Add(Step("Release", "By HR", FusionWorkStepDto.Upcoming));
        return steps;
    }

    /// <summary>A round whose reviews are all ready: everything before release is done, release is the administrator's.</summary>
    public static IReadOnlyList<FusionWorkStepDto> RoundRelease(bool calibration)
    {
        var steps = new List<FusionWorkStepDto>
        {
            Step("Self", "Done", FusionWorkStepDto.Done),
            Step("Managers", "Done", FusionWorkStepDto.Done),
        };
        if (calibration) steps.Add(Step("Calibration", "Looked at", FusionWorkStepDto.Done));
        steps.Add(Step("Release", "By you", FusionWorkStepDto.Current));
        return steps;
    }
}
