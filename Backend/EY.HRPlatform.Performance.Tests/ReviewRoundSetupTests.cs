using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Slice 4 rounds: components, schedule, launch readiness (B-060), moves after launch and the round page per state.</summary>
public sealed class ReviewRoundSetupTests
{
    private static readonly DateOnly Start = new(2026, 10, 1);
    private static readonly DateOnly End = new(2027, 9, 30);

    private static (PerformanceCycle Cycle, ReviewRound Round) Draft()
    {
        var tenant = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", Start, End, Start.AddDays(30)).Activated();
        return (cycle, ReviewRound.CreateDraft(tenant, cycle, "Year-end review", Start, new DateOnly(2027, 8, 31),
            CycleSettings.CreateDefault(tenant)));
    }

    private static ReviewRoundComponents All => new(true, true, true, true, true, false);

    [Fact]
    public void Peer_input_needs_the_self_assessment()
    {
        var (cycle, round) = Draft();
        Assert.Throws<ArgumentException>(() => round.UpdateDraft(cycle, round.Name, round.PeriodStart, round.PeriodEnd,
            new ReviewRoundComponents(false, true, true, false, false, false), new(null, null, null), "[]", new DateOnly(2027, 9, 1)));
        round.UpdateDraft(cycle, round.Name, round.PeriodStart, round.PeriodEnd, All, new(null, null, null), "[]", new DateOnly(2027, 9, 1));
        Assert.True(round.PeerInputEnabled && round.QuestionsEnabled && round.PotentialEnabled);
    }

    [Fact]
    public void Default_dates_follow_the_launch_day_and_lie_between_launch_and_the_cycle_end()
    {
        var (cycle, round) = Draft();
        var launch = new DateOnly(2027, 9, 1);
        Assert.Equal(new ReviewRoundSchedule(new(2027, 9, 15), new(2027, 9, 15), new(2027, 9, 22)), round.ScheduleFor(launch));
        Assert.Empty(round.ScheduleIssues(cycle, launch));
        // After the review period (31 Aug) is fine; after the cycle end (30 Sep) is not.
        Assert.Throws<ArgumentException>(() => round.UpdateDraft(cycle, round.Name, round.PeriodStart, round.PeriodEnd, All,
            new(null, null, new DateOnly(2027, 10, 2)), "[]", launch));
        Assert.Throws<ArgumentException>(() => round.UpdateDraft(cycle, round.Name, round.PeriodStart, round.PeriodEnd, All,
            new(new DateOnly(2027, 9, 20), null, new DateOnly(2027, 9, 18)), "[]", launch));
        round.UpdateDraft(cycle, round.Name, round.PeriodStart, round.PeriodEnd, All, new(new DateOnly(2027, 9, 15), null, null), "[]", launch);
        // A Draft that waited too long: its own date now lies before launch.
        Assert.Contains(ReviewRoundIssueCodes.DueDateBeforeLaunch, round.ScheduleIssues(cycle, new DateOnly(2027, 9, 16)));
        // Computed defaults that run past the cycle end block launch too.
        var (late, lateRound) = Draft();
        Assert.Contains(ReviewRoundIssueCodes.DueDateAfterCycleEnd, lateRound.ScheduleIssues(late, new DateOnly(2027, 9, 25)));
    }

    [Fact]
    public void A_round_picks_up_to_five_active_questions_per_audience()
    {
        var (cycle, round) = Draft();
        var person = Enumerable.Range(0, 6).Select(i => ReviewQuestion.Create(round.TenantId, $"Question number {i}", ReviewQuestionAudience.Person, i)).ToList();
        Assert.Throws<ArgumentException>(() => round.SetQuestions(person));
        Assert.True(round.SetQuestions(person.Take(3).ToList()));
        Assert.False(round.SetQuestions(person.Take(3).ToList()));
        Assert.Equal([0, 1, 2], round.Questions.Select(q => q.SortOrder));
        person[4].Archive();
        Assert.Throws<ArgumentException>(() => round.SetQuestions([person[4]]));
        var foreign = ReviewQuestion.Create(Guid.NewGuid(), "Someone else's question", ReviewQuestionAudience.Manager, 0);
        Assert.Throws<ArgumentException>(() => round.SetQuestions([foreign]));
    }

    [Fact]
    public void Moves_after_launch_stay_between_launch_and_the_cycle_end_and_keep_manager_after_self()
    {
        var (cycle, round) = Draft();
        Assert.Throws<InvalidOperationException>(() => round.MoveDueDate(cycle, ReviewStage.SelfAssessment, new DateOnly(2027, 9, 17)));
        round.Launch("{}", Guid.NewGuid(), new DateTime(2027, 9, 1, 8, 0, 0, DateTimeKind.Utc));
        Assert.Equal(new DateOnly(2027, 9, 15), round.MoveDueDate(cycle, ReviewStage.SelfAssessment, new DateOnly(2027, 9, 17)));
        Assert.Throws<ArgumentException>(() => round.MoveDueDate(cycle, ReviewStage.SelfAssessment, new DateOnly(2027, 8, 31)));
        Assert.Throws<ArgumentException>(() => round.MoveDueDate(cycle, ReviewStage.ManagerAssessment, new DateOnly(2027, 10, 1)));
        Assert.Throws<ArgumentException>(() => round.MoveDueDate(cycle, ReviewStage.SelfAssessment, new DateOnly(2027, 9, 23)));
    }

    [Fact]
    public async Task Setup_reads_readiness_launch_snapshots_questions_and_fixes_dates_and_relaunch_is_idempotent()
    {
        await using var world = await CreateAsync();
        var draft = await world.CreateRoundAsync();
        Assert.Equal("Draft", draft.GetProperty("state").GetString());
        Assert.True(draft.GetProperty("peerInputEnabled").GetBoolean());
        Assert.Equal(6, draft.GetProperty("questions").GetArrayLength());
        var readiness = draft.GetProperty("readiness");
        Assert.True(readiness.GetProperty("ready").GetBoolean(), readiness.ToString());
        Assert.Equal(4, readiness.GetProperty("launchCount").GetInt32());
        var schedule = draft.GetProperty("schedule");
        Assert.Equal(Today.AddDays(14), DateOnly.Parse(schedule.GetProperty("selfAssessment").GetProperty("date").GetString()!));
        Assert.True(schedule.GetProperty("selfAssessment").GetProperty("followsDefault").GetBoolean());
        Assert.Equal(Today.AddDays(21), DateOnly.Parse(schedule.GetProperty("managerAssessment").GetProperty("date").GetString()!));

        // Questions on with nothing picked for the person or manager: readiness says so and launch refuses.
        var bare = await world.UpdateRoundAsync(draft, questionIds: draft.GetProperty("questions").EnumerateArray()
            .Where(q => q.GetProperty("audience").GetString() == "Peer").Select(q => q.GetProperty("questionId").GetGuid()).ToArray());
        Assert.Contains("NoQuestions", bare.GetProperty("readiness").GetProperty("issues").EnumerateArray().Select(i => i.GetString()));
        var refused = await Failure(await world.Admin.PostAsJsonAsync($"/api/performance/review-rounds/{bare.GetProperty("id").GetGuid()}/launch",
            new { expectedVersion = bare.GetProperty("version").GetUInt32() }));
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("ReviewRound.NotReady", refused.Code);

        var library = await Data(await world.Admin.GetAsync("/api/performance/settings/review-questions"));
        var ids = library.EnumerateArray().GroupBy(q => q.GetProperty("audience").GetString()).SelectMany(g => g.Take(2))
            .Select(q => q.GetProperty("id").GetGuid()).ToArray();
        draft = await world.UpdateRoundAsync(bare, questionIds: ids);
        var launched = await world.LaunchAsync(draft);
        Assert.Equal(4, launched.GetProperty("reviewCount").GetInt32());
        var again = await Data(await world.Admin.PostAsJsonAsync($"/api/performance/review-rounds/{draft.GetProperty("id").GetGuid()}/launch",
            new { expectedVersion = 0u }));
        Assert.Equal(launched.GetProperty("reviewIds").EnumerateArray().Select(i => i.GetGuid()).Order(),
            again.GetProperty("reviewIds").EnumerateArray().Select(i => i.GetGuid()).Order());

        await using (var db = world.Factory.Store.NewContext())
        {
            var roundId = draft.GetProperty("id").GetGuid();
            var snapshots = db.ReviewQuestionSnapshots.Where(q => q.ReviewRoundId == roundId).ToList();
            Assert.Equal(6, snapshots.Count);
            Assert.All(db.ReviewQuestions.Where(q => ids.Contains(q.Id)).ToList(), q => Assert.NotNull(q.FirstUsedAt));
            var round = db.ReviewRounds.Single(r => r.Id == roundId);
            Assert.Equal(Today.AddDays(14), round.SelfAssessmentDueDate);
            Assert.Equal(Today.AddDays(14), round.PeerInputDueDate);
            Assert.Equal(Today.AddDays(21), round.ManagerAssessmentDueDate);
            var review = db.PerformanceReviews.First(r => r.ReviewRoundId == roundId);
            Assert.Equal(Today.AddDays(14), review.CurrentStageDueDate);
            Assert.True(review.PeerInputEnabled && review.QuestionsEnabled && review.PotentialEnabled);
        }

        // Rewording a question after launch leaves the round's wording alone.
        var used = library.EnumerateArray().First(q => q.GetProperty("id").GetGuid() == ids[0]);
        var current = (await Data(await world.Admin.GetAsync("/api/performance/settings/review-questions")))
            .EnumerateArray().Single(q => q.GetProperty("id").GetGuid() == ids[0]);
        await Data(await world.Admin.PutAsJsonAsync($"/api/performance/settings/review-questions/{ids[0]}",
            new { expectedVersion = current.GetProperty("version").GetUInt32(), text = "A brand new wording for this question" }));
        var active = await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{draft.GetProperty("id").GetGuid()}"));
        Assert.Contains(active.GetProperty("questions").EnumerateArray(), q => q.GetProperty("text").GetString() == used.GetProperty("text").GetString());
    }

    [Fact]
    public async Task A_second_round_is_blocked_by_the_running_one_and_the_failure_names_it()
    {
        await using var world = await CreateAsync();
        var first = await world.CreateRoundAsync();
        await world.LaunchAsync(first);
        var second = await world.CreateRoundAsync("Product launch spot review", peers: false, potential: false);
        var readiness = second.GetProperty("readiness");
        Assert.False(readiness.GetProperty("ready").GetBoolean());
        Assert.Contains("RoundRunning", readiness.GetProperty("issues").EnumerateArray().Select(i => i.GetString()));
        var running = readiness.GetProperty("runningRound");
        Assert.Equal(first.GetProperty("id").GetGuid(), running.GetProperty("id").GetGuid());
        Assert.Equal("Year-end review", running.GetProperty("name").GetString());
        Assert.Equal(4, running.GetProperty("selfRequired").GetInt32());

        var refused = await Failure(await world.Admin.PostAsJsonAsync($"/api/performance/review-rounds/{second.GetProperty("id").GetGuid()}/launch",
            new { expectedVersion = second.GetProperty("version").GetUInt32() }));
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("ReviewRound.NotReady", refused.Code);
        var extra = refused.Body.GetProperty("details").GetProperty("extra");
        Assert.Equal(first.GetProperty("id").GetGuid(), extra.GetProperty("runningRound").GetProperty("id").GetGuid());
        Assert.Contains("RoundRunning", extra.GetProperty("roundIssues").EnumerateArray().Select(i => i.GetString()));
        Assert.Contains("Year-end review is running", refused.Body.GetProperty("errors")[0].GetString());
    }

    [Fact]
    public async Task HR_moves_due_dates_for_the_round_and_for_one_review_with_a_reason()
    {
        await using var world = await CreateAsync();
        var draft = await world.CreateRoundAsync();
        await world.LaunchAsync(draft);
        var roundId = draft.GetProperty("id").GetGuid();
        var round = await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{roundId}"));
        var meriem = world.ReviewOf(draft, world.Tarek);
        uint ReviewVersion(Guid id) { using var db = world.Factory.Store.NewContext(); return db.PerformanceReviews.Single(r => r.Id == id).Version; }

        // One review first: Tarek is back from leave.
        var personal = Today.AddDays(18);
        var single = await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{meriem}/due-date",
            new { expectedVersion = ReviewVersion(meriem), dueDate = personal, reason = "Back from sick leave on 17 Sep" }));
        Assert.Equal("SelfAssessment", single.GetProperty("stage").GetString());

        var noReason = await Failure(await world.Admin.PostAsJsonAsync($"/api/performance/review-rounds/{roundId}/due-dates",
            new { expectedVersion = round.GetProperty("version").GetUInt32(), stage = "SelfAssessment", dueDate = Today.AddDays(16), reason = "" }));
        Assert.Equal(HttpStatusCode.BadRequest, noReason.Status);
        var reviewer = await Failure(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/review-rounds/{roundId}/due-dates",
            new { expectedVersion = round.GetProperty("version").GetUInt32(), stage = "ManagerAssessment", dueDate = Today.AddDays(25), reason = "More time" }));
        Assert.Equal(HttpStatusCode.Forbidden, reviewer.Status);
        var reviewerOwn = await Failure(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{meriem}/due-date",
            new { expectedVersion = ReviewVersion(meriem), dueDate = Today.AddDays(25), reason = "More time" }));
        Assert.Equal(HttpStatusCode.Forbidden, reviewerOwn.Status);

        var moved = await Data(await world.Admin.PostAsJsonAsync($"/api/performance/review-rounds/{roundId}/due-dates",
            new { expectedVersion = round.GetProperty("version").GetUInt32(), stage = "SelfAssessment", dueDate = Today.AddDays(16),
                reason = "Engineering B lost two days to the release freeze" }));
        Assert.Equal(3, moved.GetProperty("affected").GetInt32());
        await using (var db = world.Factory.Store.NewContext())
        {
            var reviews = db.PerformanceReviews.Where(r => r.ReviewRoundId == roundId).ToList();
            Assert.Equal(personal, reviews.Single(r => r.Id == meriem).SelfAssessmentDueDate);
            Assert.All(reviews.Where(r => r.Id != meriem), r => Assert.Equal(Today.AddDays(16), r.CurrentStageDueDate));
            var notices = db.Notifications.Where(n => n.Kind == PerformanceNotificationKind.ReviewDueDateMoved).ToList();
            // Tarek and Mariam for the single move, then the three others for the round move.
            Assert.Equal(5, notices.Count);
            Assert.Contains(notices, n => n.RecipientEmployeeId == world.Mariam.EmployeeId && n.EnglishTitle().StartsWith("Tarek Ayari's self-assessment"));
            Assert.Contains(db.AuditEntries, a => a.Action == "ReviewRound.DueDateMoved" && a.Summary.Contains("release freeze"));
        }
        var active = await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{roundId}"));
        Assert.Equal(Today.AddDays(16).ToString("yyyy-MM-dd"), active.GetProperty("selfAssessmentDueDate").GetString());
        var activity = active.GetProperty("activity").EnumerateArray().Select(a => a.GetProperty("kind").GetString()).ToList();
        Assert.Equal(2, activity.Count(k => k == "DueDateMoved"));
        Assert.Contains("Launched", activity);
    }

    [Fact]
    public async Task Moves_are_refused_once_the_round_closed()
    {
        await using var world = await CreateAsync();
        var draft = await world.CreateRoundAsync(peers: false, questions: false, potential: false);
        await world.LaunchAsync(draft);
        var roundId = draft.GetProperty("id").GetGuid();
        await using (var db = world.Factory.Store.NewContext())
        {
            foreach (var review in db.PerformanceReviews.Where(r => r.ReviewRoundId == roundId).ToList()) review.CloseAdministratively("Pilot ended", DateTime.UtcNow);
            db.ReviewRounds.Single(r => r.Id == roundId).Close();
            await db.SaveChangesAsync();
        }
        var round = await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{roundId}"));
        var refused = await Failure(await world.Admin.PostAsJsonAsync($"/api/performance/review-rounds/{roundId}/due-dates",
            new { expectedVersion = round.GetProperty("version").GetUInt32(), stage = "ManagerAssessment", dueDate = Today.AddDays(30), reason = "More time" }));
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("ReviewRound.NotActive", refused.Code);
    }

    [Fact]
    public async Task The_round_page_reads_running_progress_by_team_and_the_closed_outcome()
    {
        await using var world = await CreateAsync();
        var draft = await world.CreateRoundAsync(peers: false, questions: false, potential: false);
        await world.UpdateRoundAsync(draft, self: false);
        await world.LaunchAsync(await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{draft.GetProperty("id").GetGuid()}")));
        var roundId = draft.GetProperty("id").GetGuid();

        var running = await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{roundId}"));
        Assert.Equal("Active", running.GetProperty("state").GetString());
        Assert.True(running.GetProperty("readiness").ValueKind == JsonValueKind.Null);
        var progress = running.GetProperty("progress");
        var manager = progress.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("stage").GetString() == "ManagerAssessment");
        Assert.Equal((0, 4, 4), (manager.GetProperty("done").GetInt32(), manager.GetProperty("total").GetInt32(), manager.GetProperty("readyToWrite").GetInt32()));
        var teams = progress.GetProperty("teams").EnumerateArray().ToList();
        Assert.Equal(2, teams.Count);
        Assert.Equal(3, teams.Single(t => t.GetProperty("reviewerEmployeeId").GetGuid() == world.Mariam.EmployeeId).GetProperty("people").GetInt32());
        Assert.Equal(Today.AddDays(18), DateOnly.Parse(progress.GetProperty("nextReminder").GetProperty("date").GetString()!));
        Assert.False(running.GetProperty("configuration").GetProperty("selfAssessment").GetBoolean());

        // Mariam writes Aicha's review; the rest close without a result; Aicha's is released.
        var aicha = world.ReviewOf(draft, world.Aicha);
        uint Version(Guid id) { using var db = world.Factory.Store.NewContext(); return db.PerformanceReviews.Single(r => r.Id == id).Version; }
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{aicha}/manager-assessment",
            new { expectedVersion = Version(aicha), summary = "A strong year.", overallRating = 4 }));
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{aicha}/finalize", new { expectedVersion = Version(aicha) }));
        foreach (var person in new[] { world.Fares, world.Tarek, world.Mariam })
        {
            var id = world.ReviewOf(draft, person);
            await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{id}/close",
                new { expectedVersion = Version(id), reason = $"{person.DisplayName} left on 10 Sep" }));
        }
        // Nothing left open: the round closed itself with the last review (D-34).
        var closed = await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{roundId}"));
        Assert.Equal("Closed", closed.GetProperty("state").GetString());
        var outcome = closed.GetProperty("outcome");
        Assert.Equal((1, 4, 0), (outcome.GetProperty("released").GetInt32(), outcome.GetProperty("total").GetInt32(), outcome.GetProperty("acknowledged").GetInt32()));
        Assert.Equal(3, outcome.GetProperty("closedWithoutResult").GetArrayLength());
        Assert.Contains(outcome.GetProperty("closedWithoutResult").EnumerateArray(), c => c.GetProperty("reason").GetString() == "Tarek Ayari left on 10 Sep");
        Assert.Equal(1, outcome.GetProperty("distribution").EnumerateArray().Single(b => b.GetProperty("value").GetInt32() == 4).GetProperty("count").GetInt32());
        Assert.Equal("Aicha Ben Ali", outcome.GetProperty("notAcknowledged")[0].GetProperty("displayName").GetString());
        Assert.Equal(Today.AddDays(7), DateOnly.Parse(outcome.GetProperty("nextAcknowledgementReminder").GetString()!));
        Assert.True(closed.GetProperty("progress").ValueKind == JsonValueKind.Null);
        Assert.Contains(closed.GetProperty("activity").EnumerateArray(), a => a.GetProperty("kind").GetString() == "Released");
    }
}
