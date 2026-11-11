using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Calibration needs the calibrate grant alone (D-35); round administration confers nothing there, and releasing results
/// stays with round administration. A calibrator never sees or decides their own review; another tenant's round is not found.
/// </summary>
public sealed class CalibrationHttpTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly EffectivePermissionGrant[] Calibrator =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.ReviewCalibrate, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] RoundAdmin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] Employee =
        [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];

    [Fact]
    public async Task Only_the_calibrate_grant_reads_or_decides_and_only_round_administration_releases()
    {
        using var factory = new PerformanceApiFactory();
        var world = await ArrangeReviewAsync(factory);
        var calibration = $"/api/performance/review-rounds/{world.RoundId}/calibration";
        var decision = $"{calibration}/subjects/{world.ReviewId}/decision";
        var release = $"/api/performance/review-rounds/{world.RoundId}/finalize";

        var admin = factory.CreateAuthenticatedClient(permissions: RoundAdmin);
        var employee = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee);
        foreach (var client in new[] { admin, employee })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(calibration)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"{calibration}/everyone")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync(decision, new { rating = 4, expectedVersion = 0 })).StatusCode);
        }

        // Any holder of the grant calibrates; no one opens or staffs a session first.
        var calibrator = factory.CreateAuthenticatedClient(permissions: Calibrator, userId: Guid.NewGuid());
        var read = await Data(await calibrator.GetAsync(calibration));
        Assert.Equal(1, read.GetProperty("ready").GetProperty("count").GetInt32());
        Assert.False(read.GetProperty("canRelease").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await calibrator.PutAsJsonAsync(decision, new { rating = 4, expectedVersion = 0 })).StatusCode);

        // Releasing is the year's move: a calibrator alone can't, an administrator can.
        var version = (await Data(await admin.GetAsync($"/api/performance/review-rounds/{world.RoundId}"))).GetProperty("version").GetUInt32();
        Assert.Equal(HttpStatusCode.Forbidden, (await calibrator.PostAsJsonAsync(release, new { expectedVersion = version })).StatusCode);
        var released = await Data(await admin.PostAsJsonAsync(release, new { expectedVersion = version }));
        Assert.Equal(world.ReviewId.ToString(), released.GetProperty("finalized")[0].GetProperty("reviewId").GetString());
    }

    [Fact]
    public async Task A_changed_rating_reaches_the_reviewer_with_its_reason_and_the_subject_sees_only_the_result()
    {
        using var factory = new PerformanceApiFactory();
        var world = await ArrangeReviewAsync(factory);
        var calibration = $"/api/performance/review-rounds/{world.RoundId}/calibration";
        var reviewPath = $"/api/performance/reviews/{world.ReviewId}";
        var hr = factory.CreateAuthenticatedClient(permissions: [.. Calibrator, .. RoundAdmin], userId: Guid.NewGuid());
        var reviewer = factory.CreateAuthenticatedClient(employeeId: world.ReviewerId,
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)]);
        var subject = factory.CreateAuthenticatedClient(employeeId: world.SubjectId, permissions: Employee);
        var outsider = factory.CreateAuthenticatedClient(permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Tenant)]);

        // A calibrator reads the review while it is in calibration; someone without the grant cannot.
        var during = await Data(await hr.GetAsync(reviewPath));
        Assert.Equal(4, during.GetProperty("calibration").GetProperty("originalRating").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync(reviewPath)).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Data(await reviewer.GetAsync(reviewPath))).GetProperty("calibration").ValueKind);

        Assert.Equal(HttpStatusCode.OK, (await hr.PutAsJsonAsync($"{calibration}/subjects/{world.ReviewId}/decision",
            new { rating = 3, reason = "Peer outcomes were stronger", expectedVersion = 0 })).StatusCode);
        var reviewerView = (await Data(await reviewer.GetAsync(reviewPath))).GetProperty("calibration");
        Assert.Equal((4, 3, "Peer outcomes were stronger"), (reviewerView.GetProperty("originalRating").GetInt32(),
            reviewerView.GetProperty("calibratedRating").GetInt32(), reviewerView.GetProperty("rationale").GetString()));

        var round = await Data(await hr.GetAsync($"/api/performance/review-rounds/{world.RoundId}"));
        Assert.Equal(HttpStatusCode.OK, (await hr.PostAsJsonAsync($"/api/performance/review-rounds/{world.RoundId}/finalize",
            new { expectedVersion = round.GetProperty("version").GetUInt32() })).StatusCode);
        var subjectRaw = await (await subject.GetAsync(reviewPath)).Content.ReadAsStringAsync();
        var subjectView = JsonDocument.Parse(subjectRaw).RootElement.GetProperty("data");
        Assert.Equal(3, subjectView.GetProperty("finalRating").GetInt32());
        Assert.Equal(JsonValueKind.Null, subjectView.GetProperty("calibration").ValueKind);
        Assert.Equal(JsonValueKind.Null, subjectView.GetProperty("finalRatingSource").ValueKind);
        Assert.DoesNotContain("Peer outcomes were stronger", subjectRaw);
        Assert.Equal(HttpStatusCode.Forbidden, (await subject.GetAsync(calibration)).StatusCode);
    }

    [Fact]
    public async Task Only_round_administrators_get_the_rating_distribution_and_its_drill_through_opens()
    {
        using var factory = new PerformanceApiFactory();
        var world = await ArrangeReviewAsync(factory);
        var status = $"/api/performance/review-rounds/{world.RoundId}/status";

        var admin = factory.CreateAuthenticatedClient(permissions: RoundAdmin);
        var data = await Data(await admin.GetAsync(status));
        var strong = data.GetProperty("ratingDistribution").EnumerateArray().Single(level => level.GetProperty("value").GetInt32() == 4);
        Assert.Equal(1, strong.GetProperty("count").GetInt32());
        Assert.Equal(1, data.GetProperty("managerAssessments").GetProperty("submitted").GetInt32());
        var drill = strong.GetProperty("reviews")[0].GetProperty("reviewId").GetString();
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/performance/reviews/{drill}")).StatusCode);

        // Reviewer, subject and a facilitator without round administration get no round-wide distribution.
        var reviewer = factory.CreateAuthenticatedClient(employeeId: world.ReviewerId, permissions: [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)]);
        var subject = factory.CreateAuthenticatedClient(employeeId: world.SubjectId, permissions: Employee);
        var calibrator = factory.CreateAuthenticatedClient(permissions: Calibrator);
        foreach (var client in new[] { reviewer, subject, calibrator })
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(status)).StatusCode);
        var subjectReview = await (await subject.GetAsync($"/api/performance/reviews/{world.ReviewId}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("ratingDistribution", subjectReview, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("distribution", subjectReview, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_calibrator_who_is_also_in_the_round_calibrates_others_but_never_sees_their_own_review()
    {
        using var factory = new PerformanceApiFactory();
        var world = await ArrangeTwoSubjectsAsync(factory);
        var calibration = $"/api/performance/review-rounds/{world.RoundId}/calibration";
        var ownId = world.Own.ToString();
        var self = factory.CreateAuthenticatedClient(employeeId: world.SelfEmployeeId, permissions: Calibrator, userId: Guid.NewGuid());

        foreach (var path in new[] { calibration, $"{calibration}/everyone" })
        {
            var raw = await (await self.GetAsync(path)).Content.ReadAsStringAsync();
            Assert.DoesNotContain(ownId, raw, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Hana", raw);
        }
        var everyone = await Data(await self.GetAsync($"{calibration}/everyone"));
        Assert.Equal(world.Other.ToString(), Assert.Single(everyone.GetProperty("people").EnumerateArray()).GetProperty("reviewId").GetString());
        Assert.Equal(1, everyone.GetProperty("spread").EnumerateArray().Sum(level => level.GetProperty("count").GetInt32()));

        // Their own review stays a subject's view, and deciding on it is refused; others' still decide.
        var ownRaw = await (await self.GetAsync($"/api/performance/reviews/{world.Own}")).Content.ReadAsStringAsync();
        Assert.Equal(JsonValueKind.Null, JsonDocument.Parse(ownRaw).RootElement.GetProperty("data").GetProperty("calibration").ValueKind);
        Assert.DoesNotContain("Own manager note", ownRaw);
        Assert.Equal(HttpStatusCode.Forbidden, (await self.PutAsJsonAsync($"{calibration}/subjects/{world.Own}/decision",
            new { rating = 5, reason = "Self", expectedVersion = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await self.PutAsJsonAsync($"{calibration}/subjects/{world.Other}/decision",
            new { rating = 4, expectedVersion = 0 })).StatusCode);
    }

    [Fact]
    public async Task Another_tenants_calibration_is_not_found()
    {
        using var factory = new PerformanceApiFactory();
        var world = await ArrangeReviewAsync(factory);
        var path = $"/api/performance/review-rounds/{world.RoundId}/calibration";
        var outsider = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), permissions: Calibrator, userId: Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"{path}/everyone")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PutAsJsonAsync($"{path}/subjects/{world.ReviewId}/decision",
            new { rating = 3, reason = "Elsewhere", expectedVersion = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.DeleteAsync($"{path}/subjects/{world.ReviewId}/decision?expectedVersion=0")).StatusCode);
    }

    private sealed record TwoSubjects(Guid CycleId, Guid RoundId, Guid Other, Guid Own, Guid SelfEmployeeId);

    /// <summary>Two reviews in calibration: another employee rated 4, and the facilitator's own review rated 2.</summary>
    private static async Task<TwoSubjects> ArrangeTwoSubjectsAsync(PerformanceApiFactory factory)
    {
        var tenant = factory.Store.TenantId;
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", Start, Start.AddYears(1).AddDays(-1), Start.AddDays(30)).Activated();
        var round = ReviewRound.CreateDraft(tenant, cycle, "Year-end", Start, Start.AddMonths(11), false, false, true);
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var selfEmployee = Guid.NewGuid();
        var other = Participant.Create(tenant, cycle.Id, Guid.NewGuid(), "Nour", null, null, null, Guid.NewGuid(), "Lina", false, Start);
        var self = Participant.Create(tenant, cycle.Id, selfEmployee, "Hana", null, null, null, Guid.NewGuid(), "Sami", false, Start);
        var otherSubject = ReviewRoundSubject.Create(tenant, round.Id, other, other.ManagerEmployeeId, "Lina");
        var selfSubject = ReviewRoundSubject.Create(tenant, round.Id, self, self.ManagerEmployeeId, "Sami");
        var otherReview = PerformanceReview.Open(tenant, round, otherSubject, version.Id, version.LevelsJson, DateTime.UtcNow);
        var ownReview = PerformanceReview.Open(tenant, round, selfSubject, version.Id, version.LevelsJson, DateTime.UtcNow);
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        otherReview.SubmitManagerAssessment(otherReview.ReviewerEmployeeId, "Strong year", 4, DateTime.UtcNow);
        ownReview.SubmitManagerAssessment(ownReview.ReviewerEmployeeId, "Own manager note", 2, DateTime.UtcNow);
        await using var db = factory.Store.NewContext();
        db.Cycles.Add(cycle);
        db.Participants.AddRange(other, self);
        db.RatingScales.Add(scale);
        db.RatingScaleVersions.Add(version);
        db.ReviewRounds.Add(round);
        db.ReviewRoundSubjects.AddRange(otherSubject, selfSubject);
        db.PerformanceReviews.AddRange(otherReview, ownReview);
        await db.SaveChangesAsync();
        return new(cycle.Id, round.Id, otherReview.Id, ownReview.Id, selfEmployee);
    }

    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private sealed record Arranged(Guid RoundId, Guid ReviewId, Guid SubjectId, Guid ReviewerId);

    private static async Task<Arranged> ArrangeReviewAsync(PerformanceApiFactory factory)
    {
        var tenant = factory.Store.TenantId;
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", Start, Start.AddYears(1).AddDays(-1), Start.AddDays(30)).Activated();
        var round = ReviewRound.CreateDraft(tenant, cycle, "Year-end", Start, Start.AddMonths(11), false, false, true);
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var participant = Participant.Create(tenant, cycle.Id, Guid.NewGuid(), "Nour", null, null, null, Guid.NewGuid(), "Lina", false, Start);
        var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, participant.ManagerEmployeeId, "Lina");
        var review = PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, DateTime.UtcNow);
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        review.SubmitManagerAssessment(review.ReviewerEmployeeId, "Strong year", 4, DateTime.UtcNow);
        await using var db = factory.Store.NewContext();
        db.Cycles.Add(cycle);
        db.Participants.Add(participant);
        db.RatingScales.Add(scale);
        db.RatingScaleVersions.Add(version);
        db.ReviewRounds.Add(round);
        db.ReviewRoundSubjects.Add(subject);
        db.PerformanceReviews.Add(review);
        await db.SaveChangesAsync();
        return new(round.Id, review.Id, review.SubjectEmployeeId, review.ReviewerEmployeeId);
    }
}
