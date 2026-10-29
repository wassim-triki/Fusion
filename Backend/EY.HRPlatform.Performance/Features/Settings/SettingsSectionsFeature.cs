using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Settings;

/// <summary>Performance's settings sections (B-071 D1; Notifications from B-002 N7) and which cycle-settings fields each one holds (D6).</summary>
public static class SettingsSections
{
    public const string RatingScale = "rating-scale";
    public const string Competencies = "competencies";
    public const string ReviewQuestions = "review-questions";
    public const string Reviews = "reviews";
    public const string Planning = "planning";
    public const string Conversations = "conversations";
    public const string AiAndData = "ai-and-data";
    public const string Notifications = "notifications";

    public sealed record Section(string Id, string Label);

    public static readonly IReadOnlyList<Section> All =
    [
        new(RatingScale, "Rating scale"),
        new(Competencies, "Competencies"),
        new(ReviewQuestions, "Review questions"),
        new(Reviews, "Reviews"),
        new(Planning, "Planning"),
        new(Conversations, "Conversations"),
        new(AiAndData, "AI and data"),
        new(Notifications, "Notifications"),
    ];

    /// <summary>The sections that share the one <c>CycleSettings</c> aggregate (D7).</summary>
    public static readonly IReadOnlyList<string> CycleSettingsSections = [Reviews, Planning, Conversations, AiAndData];

    private static readonly IReadOnlyDictionary<string, string> SectionOfField =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["DefaultMeasurementMethod"] = Planning,
            ["SuggestedObjectiveCountMin"] = Planning,
            ["SuggestedObjectiveCountMax"] = Planning,
            ["PlanningDeadlineOffsetDays"] = Planning,
            ["PlanAlignmentPolicy"] = Planning,
            ["DefaultSelfAssessmentEnabled"] = Reviews,
            ["DefaultObjectiveRatingsEnabled"] = Reviews,
            ["DefaultCalibrationEnabled"] = Reviews,
            ["SelfAssessmentDueDays"] = Reviews,
            ["PeerInputDueDays"] = Reviews,
            ["ManagerAssessmentDueDays"] = Reviews,
            ["AcknowledgementReminderDays"] = Reviews,
            ["NineBoxLowTop"] = Reviews,
            ["NineBoxMidTop"] = Reviews,
            ["DefaultOneOnOneCadence"] = Conversations,
            ["AiAssistanceEnabled"] = AiAndData,
            ["EvidenceRetentionMonths"] = AiAndData,
        };

    /// <summary>The sections whose values differ between two snapshots of the cycle settings.</summary>
    public static IReadOnlyList<string> Touched(JsonElement before, JsonElement after)
    {
        var touched = new HashSet<string>(StringComparer.Ordinal);
        if (after.ValueKind != JsonValueKind.Object) return [];
        foreach (var property in after.EnumerateObject())
        {
            if (!SectionOfField.TryGetValue(property.Name, out var section)) continue;
            var previous = before.ValueKind == JsonValueKind.Object && before.TryGetProperty(property.Name, out var value)
                ? value.GetRawText() : null;
            if (previous != property.Value.GetRawText()) touched.Add(section);
        }
        return CycleSettingsSections.Where(touched.Contains).ToArray();
    }

    /// <summary>
    /// The sections a <c>Settings.Changed</c> entry counts for: the ids it recorded, else its before/after diff,
    /// else (an empty diff) all four cycle-settings sections, conservatively.
    /// </summary>
    public static IReadOnlyList<string> Of(string summary)
    {
        try
        {
            using var json = JsonDocument.Parse(summary);
            var root = json.RootElement;
            if (root.TryGetProperty("sections", out var recorded) && recorded.ValueKind == JsonValueKind.Array)
                return recorded.EnumerateArray().Select(item => item.GetString()).OfType<string>().ToArray();
            if (root.TryGetProperty("before", out var before) && root.TryGetProperty("after", out var after)
                && Touched(before, after) is { Count: > 0 } diffed)
                return diffed;
        }
        catch (JsonException)
        {
        }
        return CycleSettingsSections;
    }
}

/// <summary>The caller's sections. <paramref name="Access"/> is null when they can't view Performance settings.</summary>
public sealed record GetSettingsSectionsQuery(string? Access) : IQuery<Result<IReadOnlyList<FusionSettingsSectionDto>>>;

public sealed class GetSettingsSectionsHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, IPermissionHoldersClient holders)
    : IQueryHandler<GetSettingsSectionsQuery, Result<IReadOnlyList<FusionSettingsSectionDto>>>
{
    private const string Someone = "Someone";

    private static readonly string[] SettingsActions =
    [
        PerformanceAuditActions.SettingsChanged,
        PerformanceAuditActions.RatingScaleChanged,
        PerformanceAuditActions.CompetencyCreated,
        PerformanceAuditActions.CompetencyChanged,
        PerformanceAuditActions.CompetencyArchived,
        PerformanceAuditActions.CompetencyDeleted,
        PerformanceAuditActions.ReviewQuestionCreated,
        PerformanceAuditActions.ReviewQuestionChanged,
        PerformanceAuditActions.ReviewQuestionArchived,
        PerformanceAuditActions.ReviewQuestionDeleted,
        PerformanceAuditActions.ReviewQuestionsReordered,
        PerformanceAuditActions.NotificationDefaultsChanged,
    ];

    public async Task<Result<IReadOnlyList<FusionSettingsSectionDto>>> Handle(GetSettingsSectionsQuery query, CancellationToken token)
    {
        if (query.Access is null) return Result.Success<IReadOnlyList<FusionSettingsSectionDto>>([]);

        // Settings changes are rare, so the tenant's whole settings audit is small enough to attribute in memory.
        var entries = await db.AuditEntries.AsNoTracking()
            .Where(entry => SettingsActions.Contains(entry.Action))
            .OrderByDescending(entry => entry.OccurredAt)
            .Select(entry => new { entry.Action, entry.Summary, entry.OccurredAt, entry.ActorEmployeeId, entry.ActorSubject })
            .ToListAsync(token);

        var latest = new Dictionary<string, (DateTime At, Guid? EmployeeId, string Subject)>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            var sections = entry.Action switch
            {
                PerformanceAuditActions.SettingsChanged => SettingsSections.Of(entry.Summary),
                PerformanceAuditActions.RatingScaleChanged => [SettingsSections.RatingScale],
                PerformanceAuditActions.NotificationDefaultsChanged => [SettingsSections.Notifications],
                _ when entry.Action.StartsWith("Competency.", StringComparison.Ordinal) => [SettingsSections.Competencies],
                _ => [SettingsSections.ReviewQuestions],
            };
            foreach (var section in sections)
                latest.TryAdd(section, (entry.OccurredAt, entry.ActorEmployeeId, entry.ActorSubject));
        }

        var names = await ActorNamesAsync(latest.Values, token);
        var settingsCreated = await db.CycleSettings.AsNoTracking().Select(item => (DateTime?)item.CreatedAt).FirstOrDefaultAsync(token);
        var setUp = new Dictionary<string, DateTime?>(StringComparer.Ordinal)
        {
            [SettingsSections.RatingScale] = await db.RatingScales.AsNoTracking().Select(item => (DateTime?)item.CreatedAt).FirstOrDefaultAsync(token),
            [SettingsSections.Competencies] = await db.Competencies.AsNoTracking().MinAsync(item => (DateTime?)item.CreatedAt, token),
            [SettingsSections.ReviewQuestions] = await db.ReviewQuestions.AsNoTracking().MinAsync(item => (DateTime?)item.CreatedAt, token),
            [SettingsSections.Notifications] = await db.NotificationDefaults.AsNoTracking().Select(item => (DateTime?)item.CreatedAt).FirstOrDefaultAsync(token),
        };
        foreach (var section in SettingsSections.CycleSettingsSections) setUp[section] = settingsCreated;
        var sectionsDto = SettingsSections.All
            .Select((section, index) => new FusionSettingsSectionDto(
                section.Id,
                section.Label,
                index + 1,
                $"/performance/settings/{section.Id}",
                query.Access,
                latest.TryGetValue(section.Id, out var change)
                    ? new FusionSettingsLastChangeDto(change.At, NameOf(change.EmployeeId, change.Subject, names))
                    : null,
                setUp[section.Id]))
            .ToList();
        return Result.Success<IReadOnlyList<FusionSettingsSectionDto>>(sectionsDto);
    }

    private static string NameOf(Guid? employeeId, string subject, ActorNames names)
        => employeeId is Guid id && names.ByEmployee.TryGetValue(id, out var byEmployee) ? byEmployee
            : Guid.TryParse(subject, out var userId) && names.ByUser.TryGetValue(userId, out var byUser) ? byUser
            : Someone;

    private sealed record ActorNames(IReadOnlyDictionary<Guid, string> ByEmployee, IReadOnlyDictionary<Guid, string> ByUser);

    /// <summary>
    /// Employees through Core HR's people lookup; accounts without an employee record through the settings and cycle
    /// administrators Identity knows. A lookup that fails leaves those actors as "Someone".
    /// </summary>
    private async Task<ActorNames> ActorNamesAsync(IEnumerable<(DateTime At, Guid? EmployeeId, string Subject)> actors, CancellationToken token)
    {
        var list = actors.ToList();
        var byEmployee = new Dictionary<Guid, string>();
        var employeeIds = list.Select(actor => actor.EmployeeId).OfType<Guid>().Distinct().ToList();
        if (employeeIds.Count > 0)
        {
            try
            {
                foreach (var snapshot in await workforce.ResolveAsync(DateTime.UtcNow, employeeIds, token))
                    byEmployee[snapshot.EmployeeId] = snapshot.DisplayName;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !token.IsCancellationRequested)
            {
            }
        }

        var byUser = new Dictionary<Guid, string>();
        if (list.Any(actor => actor.EmployeeId is not Guid id || !byEmployee.ContainsKey(id)))
        {
            foreach (var key in new[] { PerformancePermissions.SettingsManage, PerformancePermissions.CycleManage })
            {
                try
                {
                    foreach (var holder in await holders.GetHoldersAsync(key, PermissionScopes.Tenant, token))
                        byUser.TryAdd(holder.UserId, holder.DisplayName);
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !token.IsCancellationRequested)
                {
                }
            }
        }

        return new ActorNames(byEmployee, byUser);
    }
}
