using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Settings;

namespace EY.HRPlatform.Performance.Domain.Reviews;

public enum ReviewItemKind { Objective, Competency }

/// <summary>Formal review input for one live objective or snapshotted competency.</summary>
public sealed class ReviewItemResponse : PerformanceChildEntity
{
    private ReviewItemResponse() { }

    public Guid ReviewId { get; private set; }
    public ReviewItemKind Kind { get; private set; }
    public Guid ItemId { get; private set; }
    public string? SelfReflection { get; private set; }
    public int? SelfRating { get; private set; }
    public string? SelfComment { get; private set; }
    public string? ManagerAssessment { get; private set; }
    public int? ManagerRating { get; private set; }
    /// <summary>A goal's grade changed from the measure's by the person (D-38), with why; null keeps the measure's.</summary>
    public decimal? SelfGrade { get; private set; }
    public string? SelfGradeReason { get; private set; }
    /// <summary>A goal's grade changed from the measure's by the manager, with why; null keeps the measure's.</summary>
    public decimal? ManagerGrade { get; private set; }
    public string? ManagerGradeReason { get; private set; }

    public const int MaxGradeReason = 300;

    public static ReviewItemResponse Create(Guid tenantId, Guid reviewId, ReviewItemKind kind, Guid itemId)
    {
        if (tenantId == Guid.Empty || reviewId == Guid.Empty || itemId == Guid.Empty)
            throw new ArgumentException("A review item requires tenant, review, and source item identities.");
        return new ReviewItemResponse { TenantId = tenantId, ReviewId = reviewId, Kind = kind, ItemId = itemId };
    }

    public void SaveSelf(string? reflection, int? rating, string? comment)
    {
        SelfReflection = Normalize(reflection, 4000, nameof(reflection));
        SelfRating = rating;
        SelfComment = Normalize(comment, 2000, nameof(comment));
        MarkUpdated();
    }

    public void SaveManager(string? assessment, int? rating)
    {
        ManagerAssessment = Normalize(assessment, 4000, nameof(assessment));
        ManagerRating = rating;
        MarkUpdated();
    }

    /// <summary>Changes a goal's grade from its measure's with a short reason (D-38); a null grade goes back to the measure's.</summary>
    public void SetGrade(bool self, decimal? grade, string? reason)
    {
        if (Kind != ReviewItemKind.Objective) throw new InvalidOperationException("Only a goal has a grade.");
        string? why = null;
        if (grade is decimal value)
        {
            if (value is < 0m or > 1m) throw new ArgumentException("A grade is between 0.00 and 1.00.", nameof(grade));
            why = Normalize(reason, MaxGradeReason, nameof(reason)) ?? throw new ArgumentException("Say why the grade changed.", nameof(reason));
            grade = decimal.Round(value, 2);
        }
        if (self) { SelfGrade = grade; SelfGradeReason = why; }
        else { ManagerGrade = grade; ManagerGradeReason = why; }
        MarkUpdated();
    }

    private static string? Normalize(string? value, int max, string parameter)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var cleaned = value.Trim();
        if (cleaned.Length > max) throw new ArgumentException($"An item response cannot exceed {max} characters.", parameter);
        return cleaned;
    }
}
