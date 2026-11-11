using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Multitenancy;
using MediatR;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Slice 8 (B-408): the round opening on its day and followed by manager from the Year, the year beside the review by
/// lens, cited answers, taking a self-review back, the manager's nudges and talking the result over in a 1:1.
/// </summary>
public sealed class ReviewsFromTheYearTests
{
    private static uint Version(ReviewWorld world, Guid reviewId)
    {
        using var db = world.Factory.Store.NewContext();
        return db.PerformanceReviews.Single(r => r.Id == reviewId).Version;
    }

    private static HttpClient Foreign(ReviewWorld world, WorkforceSnapshot person)
        => world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: person.EmployeeId,
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
                new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)]);

    private static object[] Answers(JsonElement review, string audience, string text = "A considered answer")
        => review.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == audience)
            .Select(q => (object)new { questionId = q.GetProperty("questionId").GetGuid(), text }).ToArray();

    [Fact]
    public async Task A_drafted_round_opens_by_itself_on_its_day_and_not_before()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var later = await world.CreateRoundAsync(name: "Opens later");
        await using (var db = world.Factory.Store.NewContext())
        {
            var cycle = db.Cycles.Single();
            var round = db.ReviewRounds.Single();
            round.SetOpensOn(cycle, Today.AddDays(5));
            await db.SaveChangesAsync();
        }
        var year = await Data(await world.Admin.GetAsync($"/api/performance/cycles/{world.Cycle.Id}/year"));
        var move = year.GetProperty("nextMove");
        Assert.Equal(Today.AddDays(5).ToString("yyyy-MM-dd"), move.GetProperty("opensOn").GetString());
        Assert.Equal(4, move.GetProperty("opens").GetProperty("people").GetInt32());
        Assert.Equal(12, move.GetProperty("opens").GetProperty("peers").GetInt32());

        async Task<int> ScanAsync(DateOnly day)
        {
            await using var scope = world.Factory.Services.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(world.Factory.Store.TenantId);
            return await ReviewRoundOpeningScanner.ScanTenantAsync(scope.ServiceProvider.GetRequiredService<PerformanceDbContext>(),
                scope.ServiceProvider.GetRequiredService<ISender>(), NullLogger.Instance, day, default);
        }
        Assert.Equal(0, await ScanAsync(Today));
        Assert.Equal(1, await ScanAsync(Today.AddDays(5)));
        await using (var db = world.Factory.Store.NewContext())
        {
            Assert.Equal(ReviewRoundState.Active, db.ReviewRounds.Single().State);
            Assert.Equal(4, db.PerformanceReviews.Count());
        }
        Assert.Equal(0, await ScanAsync(Today.AddDays(6)));
    }

    [Fact]
    public async Task Hr_follows_the_running_round_by_manager_from_the_year_and_nobody_else_sees_it()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false);
        await world.LaunchAsync(round);

        var year = await Data(await world.Admin.GetAsync($"/api/performance/cycles/{world.Cycle.Id}/year"));
        Assert.Equal("Review", year.GetProperty("phase").GetString());
        var review = year.GetProperty("review");
        Assert.Equal(0, review.GetProperty("reviewed").GetInt32());
        Assert.Equal(4, review.GetProperty("total").GetInt32());
        var mariam = review.GetProperty("reviewers").EnumerateArray().Single(r => r.GetProperty("employeeId").GetGuid() == world.Mariam.EmployeeId);
        Assert.Equal(3, mariam.GetProperty("people").GetInt32());
        Assert.Equal(3, mariam.GetProperty("waitingOnSelf").GetInt32());
        Assert.Equal(0, mariam.GetProperty("written").GetInt32());

        var managerYear = await Data(await world.As(world.Mariam).GetAsync($"/api/performance/cycles/{world.Cycle.Id}/year"));
        Assert.Equal(JsonValueKind.Null, managerYear.GetProperty("review").ValueKind);
    }

    [Fact]
    public async Task The_year_beside_the_review_reads_through_each_writers_lens_and_nobody_elses()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var tenant = world.Factory.Store.TenantId;
        await using (var db = world.Factory.Store.NewContext())
        {
            var at = DateTime.UtcNow.AddDays(-15);
            db.Add(Praise.Give(Guid.NewGuid(), tenant, world.Leila.EmployeeId, world.Leila.DisplayName, Guid.NewGuid(), "The incident drill was the best we've run.",
                [(world.Aicha.EmployeeId, world.Aicha.DisplayName)], at));
            db.Add(Feedback.Give(Guid.NewGuid(), tenant, world.Fares.EmployeeId, world.Fares.DisplayName, world.Aicha.EmployeeId, world.Aicha.DisplayName,
                FeedbackVisibility.ManagerOnly, world.Mariam.EmployeeId, world.Mariam.DisplayName, FeedbackSubject.None, "MANAGERONLY estimates slipped", at));
            await db.SaveChangesAsync();
        }
        var round = await world.CreateRoundAsync(peers: false);
        await world.LaunchAsync(round);
        var reviewId = world.ReviewOf(round, world.Aicha);
        var path = $"/api/performance/reviews/{reviewId}/year";

        var own = (await Data(await world.As(world.Aicha).GetAsync(path))).EnumerateArray().ToList();
        var praise = Assert.Single(own, i => i.GetProperty("kind").GetString() == "praise");
        Assert.StartsWith("praise:", praise.GetProperty("key").GetString());
        Assert.Equal("Leila Ben Salah", praise.GetProperty("who").GetString());
        Assert.DoesNotContain(own, i => i.GetProperty("kind").GetString() == "feedback");

        var managers = (await Data(await world.As(world.Mariam).GetAsync(path))).EnumerateArray().ToList();
        var feedback = Assert.Single(managers, i => i.GetProperty("kind").GetString() == "feedback");
        Assert.True(feedback.GetProperty("private").GetBoolean());
        Assert.Equal(Enumerable.Range(1, managers.Count), managers.Select(i => i.GetProperty("number").GetInt32()));

        foreach (var outsider in new[] { world.As(world.Fares), world.Admin, Foreign(world, world.Mariam) })
            Assert.Equal(HttpStatusCode.NotFound, (await Failure(await outsider.GetAsync(path))).Status);
    }

    [Fact]
    public async Task A_drafted_answer_keeps_its_citations_until_it_is_edited()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false);
        await world.LaunchAsync(round);
        var reviewId = world.ReviewOf(round, world.Aicha);
        var aicha = world.As(world.Aicha);
        var review = await Data(await aicha.GetAsync($"/api/performance/reviews/{reviewId}"));
        var question = review.GetProperty("questions").EnumerateArray().First(q => q.GetProperty("audience").GetString() == "Person")
            .GetProperty("questionId").GetGuid();
        var praiseKey = $"praise:{Guid.NewGuid():N}";
        var goalKey = $"objective:{Guid.NewGuid():N}";

        async Task<JsonElement> SaveAsync(string text, object[]? citations)
        {
            await Data(await aicha.PutAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
            {
                expectedVersion = Version(world, reviewId), summary = "",
                answers = new[] { new { questionId = question, text, citations } },
            }));
            var read = await Data(await aicha.GetAsync($"/api/performance/reviews/{reviewId}"));
            return read.GetProperty("questions").EnumerateArray().Single(q => q.GetProperty("questionId").GetGuid() == question);
        }

        var drafted = await SaveAsync("I ran the incident drill. Two goals are done in full.",
            [new { text = "I ran the incident drill.", key = praiseKey }, new { text = "Two goals are done in full.", key = goalKey }]);
        Assert.Equal(new[] { praiseKey, goalKey }, drafted.GetProperty("selfCitations").EnumerateArray().Select(c => c.GetProperty("key").GetString()));
        // The manager doesn't read a draft self-review, citations included.
        var reviewer = await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}"));
        Assert.DoesNotContain(praiseKey, reviewer.GetRawText());

        var edited = await SaveAsync("I ran the incident drill, with Leila.",
            [new { text = "I ran the incident drill.", key = praiseKey }]);
        Assert.Empty(edited.GetProperty("selfCitations").EnumerateArray());
        var badKey = await SaveAsync("I ran the incident drill.", [new { text = "I ran the incident drill.", key = "<script>" }]);
        Assert.Empty(badKey.GetProperty("selfCitations").EnumerateArray());
    }

    [Fact]
    public async Task The_person_takes_their_self_review_back_until_the_manager_sends_theirs()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false, potential: false);
        await world.LaunchAsync(round);
        var reviewId = world.ReviewOf(round, world.Aicha);
        var aicha = world.As(world.Aicha);
        var takeBack = $"/api/performance/reviews/{reviewId}/self-assessment/take-back";

        async Task SubmitSelfAsync()
        {
            var review = await Data(await aicha.GetAsync($"/api/performance/reviews/{reviewId}"));
            // No summary: the words are the round's questions.
            await Data(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
            {
                expectedVersion = review.GetProperty("version").GetUInt32(), summary = "", overallRating = 4, answers = Answers(review, "Person"),
            }));
        }

        await SubmitSelfAsync();
        Assert.True((await Data(await aicha.GetAsync($"/api/performance/reviews/{reviewId}"))).GetProperty("canTakeBack").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await world.As(world.Mariam).PostAsync(takeBack, null))).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await Foreign(world, world.Aicha).PostAsync(takeBack, null))).Status);
        var back = await Data(await aicha.PostAsync(takeBack, null));
        Assert.Equal("SelfAssessment", back.GetProperty("state").GetString());
        var reopened = await Data(await aicha.GetAsync($"/api/performance/reviews/{reviewId}"));
        Assert.True(reopened.GetProperty("canEditSelfAssessment").GetBoolean());
        Assert.Contains(reopened.GetProperty("questions").EnumerateArray(), q => q.GetProperty("selfAnswer").GetString() == "A considered answer");

        await SubmitSelfAsync();
        var manager = await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}"));
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment", new
        {
            expectedVersion = manager.GetProperty("version").GetUInt32(), summary = "", overallRating = 4, answers = Answers(manager, "Manager"),
        }));
        Assert.Equal(HttpStatusCode.Conflict, (await Failure(await aicha.PostAsync(takeBack, null))).Status);
    }

    [Fact]
    public async Task Only_the_reviewer_nudges_the_person_and_the_peers_who_have_not_answered()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync();
        await world.LaunchAsync(round);
        await world.AskAsync(round, world.Aicha, world.Leila, world.Khaled);
        var reviewId = world.ReviewOf(round, world.Aicha);
        var path = $"/api/performance/reviews/{reviewId}/nudge";

        foreach (var outsider in new[] { world.As(world.Aicha), world.As(world.Fares), world.Admin, Foreign(world, world.Mariam) })
            Assert.Equal(HttpStatusCode.NotFound, (await Failure(await outsider.PostAsJsonAsync(path, new { who = "self" }))).Status);
        var mariam = world.As(world.Mariam);
        Assert.Equal(HttpStatusCode.BadRequest, (await Failure(await mariam.PostAsJsonAsync(path, new { who = "everyone" }))).Status);
        Assert.Equal(1, (await Data(await mariam.PostAsJsonAsync(path, new { who = "self" }))).GetProperty("nudged").GetInt32());
        Assert.Equal(2, (await Data(await mariam.PostAsJsonAsync(path, new { who = "peers" }))).GetProperty("nudged").GetInt32());

        await using var db = world.Factory.Store.NewContext();
        var nudges = db.Notifications.Where(n => n.Kind == PerformanceNotificationKind.YearNudge).ToList();
        Assert.Equal(new[] { world.Aicha.EmployeeId, world.Khaled.EmployeeId, world.Leila.EmployeeId }.ToHashSet(),
            nudges.Select(n => n.RecipientEmployeeId!.Value).ToHashSet());
        Assert.Equal(3, nudges.Count);
    }

    [Fact]
    public async Task Talking_it_over_puts_the_released_review_on_the_next_one_on_one_once()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false, questions: false, potential: false);
        await world.UpdateRoundAsync(round, self: false);
        await world.LaunchAsync(await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{round.GetProperty("id").GetGuid()}")));
        var reviewId = world.ReviewOf(round, world.Aicha);
        var path = $"/api/performance/reviews/{reviewId}/talk-it-over";
        var aicha = world.As(world.Aicha);

        Assert.Equal(HttpStatusCode.Conflict, (await Failure(await aicha.PostAsync(path, null))).Status);
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment",
            new { expectedVersion = Version(world, reviewId), summary = "A strong year.", overallRating = 4 }));
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/finalize", new { expectedVersion = Version(world, reviewId) }));
        // No 1:1 planned yet.
        Assert.Equal(HttpStatusCode.Conflict, (await Failure(await aicha.PostAsync(path, null))).Status);

        var meetingAt = DateTime.UtcNow.AddDays(3);
        await using (var db = world.Factory.Store.NewContext())
        {
            var (series, meeting) = OneOnOneSeries.Start(world.Factory.Store.TenantId, world.Mariam.EmployeeId, world.Aicha.EmployeeId,
                OneOnOneCadence.Weekly, world.Mariam.EmployeeId, meetingAt, DateTime.UtcNow, world.Mariam.DisplayName, world.Aicha.DisplayName);
            db.OneOnOneSeries.Add(series);
            db.OneOnOneMeetings.Add(meeting);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await world.As(world.Mariam).PostAsync(path, null))).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await Foreign(world, world.Aicha).PostAsync(path, null))).Status);
        var first = await Data(await aicha.PostAsync(path, null));
        var again = await Data(await aicha.PostAsync(path, null));
        Assert.Equal(first.GetProperty("meetingId").GetGuid(), again.GetProperty("meetingId").GetGuid());

        await using (var db = world.Factory.Store.NewContext())
        {
            var item = Assert.Single(db.OneOnOneAgendaItems.Where(i => i.SourceKind == AgendaSourceKind.Review).ToList());
            Assert.Equal(reviewId, item.SourceId);
            Assert.Equal(world.Aicha.EmployeeId, item.AuthorEmployeeId);
        }
        var review = await Data(await aicha.GetAsync($"/api/performance/reviews/{reviewId}"));
        Assert.Equal(meetingAt, review.GetProperty("talkItOverAt").GetDateTime().ToUniversalTime(), TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void A_goal_grade_changed_by_hand_needs_a_reason_and_stays_between_zero_and_one()
    {
        var response = ReviewItemResponse.Create(Guid.NewGuid(), Guid.NewGuid(), ReviewItemKind.Objective, Guid.NewGuid());
        Assert.Throws<ArgumentException>(() => response.SetGrade(true, 0.8m, " "));
        Assert.Throws<ArgumentException>(() => response.SetGrade(true, 1.2m, "Overshot"));
        response.SetGrade(true, 0.854m, "The vendor delay was outside my hands");
        Assert.Equal(0.85m, response.SelfGrade);
        Assert.Null(response.ManagerGrade);
        response.SetGrade(true, null, null);
        Assert.Null(response.SelfGrade);
        Assert.Null(response.SelfGradeReason);
        var competency = ReviewItemResponse.Create(Guid.NewGuid(), Guid.NewGuid(), ReviewItemKind.Competency, Guid.NewGuid());
        Assert.Throws<InvalidOperationException>(() => competency.SetGrade(false, 0.5m, "No"));
    }
}
