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

public sealed class PerformanceReviewsHttpTests
{
    [Fact]
    public async Task Item_assessment_http_contract_rejects_missing_ratings_and_exposes_submitted_item_data()
    {
        await using var factory = new PerformanceApiFactory();
        var start = new DateOnly(2026, 9, 24);
        var end = new DateOnly(2027, 9, 23);
        var subjectId = Guid.NewGuid();
        var reviewerId = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(factory.Store.TenantId, "FY27", start, end, start.AddDays(30)).Activated();
        var participant = Participant.Create(factory.Store.TenantId, cycle.Id, subjectId, "Subject", null, null, null,
            reviewerId, "Reviewer", false, start);
        var round = ReviewRound.CreateDraft(factory.Store.TenantId, cycle, "Mid-year", start, end, true, true, false);
        var competencyId = Guid.NewGuid();
        round.UpdateDraft(cycle, "Mid-year", start, end, true, true, false, start.AddDays(100), end,
            System.Text.Json.JsonSerializer.Serialize(new[] { competencyId }));
        var roundSubject = ReviewRoundSubject.Create(factory.Store.TenantId, round.Id, participant, reviewerId, "Reviewer");
        var scale = RatingScale.CreateDefault(factory.Store.TenantId);
        var scaleVersion = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var review = PerformanceReview.Open(factory.Store.TenantId, round, roundSubject, scaleVersion.Id,
            scaleVersion.LevelsJson, DateTime.UtcNow);
        round.Launch(System.Text.Json.JsonSerializer.Serialize(new
        {
            competencies = new[] { new { id = competencyId, name = "Develops others", description = "Builds others", behaviors = Array.Empty<string>() } },
        }), scaleVersion.Id, DateTime.UtcNow);
        await using (var db = factory.Store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Participants.Add(participant);
            db.RatingScales.Add(scale);
            db.RatingScaleVersions.Add(scaleVersion);
            db.ReviewRounds.Add(round);
            db.ReviewRoundSubjects.Add(roundSubject);
            db.PerformanceReviews.Add(review);
            await db.SaveChangesAsync();
        }

        using var subject = factory.CreateAuthenticatedClient(employeeId: subjectId,
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Self),
                new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)]);
        using var reviewer = factory.CreateAuthenticatedClient(employeeId: reviewerId,
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)]);

        using (var missing = await subject.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/self-assessment", new
        {
            expectedVersion = review.Version,
            summary = "Reflection",
            items = new[] { new { kind = "Competency", itemId = competencyId, rating = (int?)null } },
        }))
            Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);

        using (var submitted = await subject.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/self-assessment", new
        {
            expectedVersion = review.Version,
            summary = "Reflection",
            overallRating = 4,
            items = new[] { new { kind = "Competency", itemId = competencyId, rating = (int?)4, comment = "Useful" } },
        }))
            Assert.Equal(HttpStatusCode.OK, submitted.StatusCode);

        using var visible = await reviewer.GetAsync($"/api/performance/reviews/{review.Id}");
        using var json = JsonDocument.Parse(await visible.Content.ReadAsStringAsync());
        var item = Assert.Single(json.RootElement.GetProperty("data").GetProperty("items").EnumerateArray());
        Assert.Equal("Competency", item.GetProperty("kind").GetString());
        Assert.Equal(4, item.GetProperty("selfRating").GetInt32());
        Assert.Equal("Useful", item.GetProperty("selfComment").GetString());
    }

    [Fact]
    public async Task Review_routes_enforce_relationship_stage_visibility_and_tenant_boundaries()
    {
        await using var factory = new PerformanceApiFactory();
        var start = new DateOnly(2026, 1, 1);
        var end = new DateOnly(2026, 12, 31);
        var cycle = PerformanceCycle.CreateDraft(factory.Store.TenantId, "FY26", start, end, start.AddDays(30)).Activated();
        var subjectPerson = factory.Core.Add("Subject");
        var reviewerPerson = factory.Core.Add("Reviewer");
        var participant = Participant.Create(factory.Store.TenantId, cycle.Id, subjectPerson.EmployeeId, subjectPerson.DisplayName,
            null, null, null, reviewerPerson.EmployeeId, reviewerPerson.DisplayName, false, start);
        var round = ReviewRound.CreateDraft(factory.Store.TenantId, cycle, "Mid-year", start, end, true, true, false);
        var roundSubject = ReviewRoundSubject.Create(factory.Store.TenantId, round.Id, participant, reviewerPerson.EmployeeId, reviewerPerson.DisplayName);
        var scale = RatingScale.CreateDefault(factory.Store.TenantId);
        var scaleVersion = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var review = PerformanceReview.Open(factory.Store.TenantId, round, roundSubject, scaleVersion.Id,
            System.Text.Json.JsonSerializer.Serialize(RatingScaleDefaults.Levels), DateTime.UtcNow);
        round.Launch("{}", scaleVersion.Id, DateTime.UtcNow);
        await using (var db = factory.Store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Participants.Add(participant);
            db.RatingScales.Add(scale);
            db.RatingScaleVersions.Add(scaleVersion);
            db.ReviewRounds.Add(round);
            db.ReviewRoundSubjects.Add(roundSubject);
            db.PerformanceReviews.Add(review);
            await db.SaveChangesAsync();
        }

        var viewSelf = new[] { new EffectivePermissionGrant(PerformancePermissions.CycleView, PermissionScopes.Self) };
        var selfAssessment = new[] { new EffectivePermissionGrant(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self) };
        var viewTeam = new[] { new EffectivePermissionGrant(PerformancePermissions.CycleView, PermissionScopes.DirectReports) };
        var viewTenant = new[] { new EffectivePermissionGrant(PerformancePermissions.CycleView, PermissionScopes.Tenant) };
        using var subject = factory.CreateAuthenticatedClient(employeeId: subjectPerson.EmployeeId, permissions: [.. viewSelf, .. selfAssessment]);
        using var subjectWithoutParticipationGrant = factory.CreateAuthenticatedClient(employeeId: subjectPerson.EmployeeId, permissions: viewSelf);
        using var reviewer = factory.CreateAuthenticatedClient(employeeId: reviewerPerson.EmployeeId, permissions: viewTeam);
        using var reviewerWithoutReportsGrant = factory.CreateAuthenticatedClient(employeeId: reviewerPerson.EmployeeId, permissions: viewSelf);
        using var administratorReviewer = factory.CreateAuthenticatedClient(employeeId: reviewerPerson.EmployeeId,
            permissions: [new(PerformancePermissions.CycleManage, PermissionScopes.Tenant), .. viewTenant]);
        using var stranger = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: viewTenant);
        using var admin = factory.CreateAuthenticatedClient(permissions: [new(PerformancePermissions.CycleManage, PermissionScopes.Tenant), .. viewTenant]);

        using (var reviewerInitial = await reviewer.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            Assert.Equal(HttpStatusCode.OK, reviewerInitial.StatusCode);
            using var json = JsonDocument.Parse(await reviewerInitial.Content.ReadAsStringAsync());
            var data = json.RootElement.GetProperty("data");
            Assert.Equal(JsonValueKind.Null, data.GetProperty("selfAssessment").ValueKind);
            Assert.Equal(JsonValueKind.Object, data.GetProperty("managerAssessment").ValueKind);
            // The manager may start while the self-review is being written (D-60).
            Assert.True(data.GetProperty("canEditManagerAssessment").GetBoolean());
            Assert.Equal(5, data.GetProperty("ratingScale").GetArrayLength());
            Assert.Equal("Mid-year", data.GetProperty("reviewRoundName").GetString());
        }
        using (var subjectInitial = await subject.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            using var json = JsonDocument.Parse(await subjectInitial.Content.ReadAsStringAsync());
            Assert.True(json.RootElement.GetProperty("data").GetProperty("canEditSelfAssessment").GetBoolean());
        }
        using (var adminInitial = await admin.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            using var json = JsonDocument.Parse(await adminInitial.Content.ReadAsStringAsync());
            var data = json.RootElement.GetProperty("data");
            Assert.Equal(JsonValueKind.Object, data.GetProperty("selfAssessment").ValueKind);
            Assert.Equal(JsonValueKind.Object, data.GetProperty("managerAssessment").ValueKind);
            Assert.False(data.GetProperty("canEditSelfAssessment").GetBoolean());
            Assert.False(data.GetProperty("canEditManagerAssessment").GetBoolean());
        }
        using (var adminCannotImpersonate = await admin.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/self-assessment",
            new { expectedVersion = review.Version, summary = "Cannot impersonate subject" }))
            Assert.Equal(HttpStatusCode.Forbidden, adminCannotImpersonate.StatusCode);
        using (var subjectWithoutGrant = await subjectWithoutParticipationGrant.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/self-assessment",
            new { expectedVersion = review.Version, summary = "Missing participation grant" }))
            Assert.Equal(HttpStatusCode.Forbidden, subjectWithoutGrant.StatusCode);
        using (var unrelated = await stranger.GetAsync($"/api/performance/reviews/{review.Id}"))
            Assert.Equal(HttpStatusCode.Forbidden, unrelated.StatusCode);

        // The manager may start writing early (D-60), but can't send before the self-review is in.
        using (var prematureManagerSubmit = await reviewer.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/manager-assessment",
            new { expectedVersion = review.Version, summary = "Too early", overallRating = 3 }))
            Assert.Contains(prematureManagerSubmit.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict });

        using (var selfSubmit = await subject.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/self-assessment",
            new { expectedVersion = review.Version, summary = "I delivered the plan.", overallRating = 4 }))
            Assert.Equal(HttpStatusCode.OK, selfSubmit.StatusCode);
        using (var reviewerCanReadSubmittedSelf = await reviewer.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            using var json = JsonDocument.Parse(await reviewerCanReadSubmittedSelf.Content.ReadAsStringAsync());
            Assert.Equal("I delivered the plan.", json.RootElement.GetProperty("data").GetProperty("selfAssessment").GetProperty("summary").GetString());
            Assert.True(json.RootElement.GetProperty("data").GetProperty("canEditManagerAssessment").GetBoolean());
        }
        using (var reviewerWithoutGrant = await reviewerWithoutReportsGrant.GetAsync($"/api/performance/reviews/{review.Id}"))
            Assert.Equal(HttpStatusCode.Forbidden, reviewerWithoutGrant.StatusCode);
        using (var workWithoutGrant = await reviewerWithoutReportsGrant.GetAsync($"/api/performance/reviews/work?cycleId={cycle.Id}"))
        {
            Assert.Equal(HttpStatusCode.OK, workWithoutGrant.StatusCode);
            using var json = JsonDocument.Parse(await workWithoutGrant.Content.ReadAsStringAsync());
            Assert.Empty(json.RootElement.GetProperty("data").EnumerateArray());
        }
        using (var deniedManagerSubmit = await reviewerWithoutReportsGrant.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/manager-assessment",
            new { expectedVersion = review.Version, summary = "Missing report grant", overallRating = 4 }))
            Assert.Equal(HttpStatusCode.Forbidden, deniedManagerSubmit.StatusCode);
        using (var adminReviewerView = await administratorReviewer.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            using var json = JsonDocument.Parse(await adminReviewerView.Content.ReadAsStringAsync());
            Assert.True(json.RootElement.GetProperty("data").GetProperty("canEditManagerAssessment").GetBoolean());
        }
        using (var managerSubmit = await administratorReviewer.PostAsJsonAsync($"/api/performance/reviews/{review.Id}/manager-assessment",
            new { expectedVersion = review.Version, summary = "Good outcome.", overallRating = 4 }))
            Assert.Equal(HttpStatusCode.OK, managerSubmit.StatusCode);

        using (var subjectCannotSeeManager = await subject.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            using var json = JsonDocument.Parse(await subjectCannotSeeManager.Content.ReadAsStringAsync());
            Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("data").GetProperty("managerAssessment").ValueKind);
        }
        using (var adminSeesBoth = await admin.GetAsync($"/api/performance/reviews/{review.Id}"))
        {
            using var json = JsonDocument.Parse(await adminSeesBoth.Content.ReadAsStringAsync());
            Assert.Equal(JsonValueKind.Object, json.RootElement.GetProperty("data").GetProperty("selfAssessment").ValueKind);
            Assert.Equal(JsonValueKind.Object, json.RootElement.GetProperty("data").GetProperty("managerAssessment").ValueKind);
        }
        using var otherTenant = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: subjectPerson.EmployeeId, permissions: viewTenant);
        using var hidden = await otherTenant.GetAsync($"/api/performance/reviews/{review.Id}");
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
    }
}
