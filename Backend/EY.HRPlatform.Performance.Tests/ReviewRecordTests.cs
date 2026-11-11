using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Slice 4 review record: questions, self overall rating, potential, peer closure, the frozen result, acknowledgement and lenses.</summary>
public sealed class ReviewRecordTests
{
    private static async Task<(ReviewWorld World, JsonElement Round, Guid Review)> LaunchedAsync(bool calibration = false)
    {
        var world = await CreateAsync();
        var round = await world.CreateRoundAsync(calibration: calibration);
        await world.LaunchAsync(round);
        return (world, round, world.ReviewOf(round, world.Aicha));
    }

    private static async Task<JsonElement> ReadAsync(HttpClient client, Guid reviewId)
        => await Data(await client.GetAsync($"/api/performance/reviews/{reviewId}"));

    private static object[] Answers(JsonElement review, string audience, string text = "A considered answer")
        => review.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == audience)
            .Select(q => (object)new { questionId = q.GetProperty("questionId").GetGuid(), text }).ToArray();

    /// <summary>Mariam asks Leila and Khaled instead of Fusion's picks for Aicha's review; Leila answers, Khaled stays open.</summary>
    private static async Task<(Guid Answered, Guid Open)> PeersAsync(ReviewWorld world, Guid reviewId)
    {
        await using var db = world.Factory.Store.NewContext();
        var review = db.PerformanceReviews.Include(r => r.PeerNominations).Single(r => r.Id == reviewId);
        var peers = new[] { (world.Leila.EmployeeId, world.Leila.DisplayName), (world.Khaled.EmployeeId, world.Khaled.DisplayName) };
        var before = review.PeerNominations.ToList();
        review.ChangePeers(world.Mariam.EmployeeId, peers, DateTime.UtcNow);
        db.PeerNominations.RemoveRange(before.Except(review.PeerNominations));
        db.PeerNominations.AddRange(review.PeerNominations.Except(before));
        foreach (var picked in db.PeerRequests.Where(r => r.ReviewId == reviewId)) picked.Close(DateTime.UtcNow);
        var leila = PeerRequest.Create(review, world.Leila.EmployeeId, world.Leila.DisplayName, Today.AddDays(14), DateTime.UtcNow);
        var khaled = PeerRequest.Create(review, world.Khaled.EmployeeId, world.Khaled.DisplayName, Today.AddDays(14), DateTime.UtcNow);
        var questions = db.ReviewQuestionSnapshots.Where(q => q.ReviewRoundId == review.ReviewRoundId && q.Audience == Domain.Settings.ReviewQuestionAudience.Peer)
            .Select(q => q.Id).ToList();
        leila.Send(world.Leila.EmployeeId, questions.ToDictionary(id => id, _ => (string?)"She unblocks everyone around her."), questions, DateTime.UtcNow);
        db.PeerRequests.AddRange(leila, khaled);
        db.PeerAnswers.AddRange(leila.Answers);
        await db.SaveChangesAsync();
        return (leila.Id, khaled.Id);
    }

    private static async Task SubmitSelfAsync(ReviewWorld world, Guid reviewId)
    {
        var review = await ReadAsync(world.As(world.Aicha), reviewId);
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = review.GetProperty("version").GetUInt32(), summary = "A year of steady delivery.", overallRating = 4,
            answers = Answers(review, "Person", "Shipping the onboarding revamp"),
        }));
    }

    private static async Task SubmitManagerAsync(ReviewWorld world, Guid reviewId, string? potential = "High")
    {
        var review = await ReadAsync(world.As(world.Mariam), reviewId);
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment", new
        {
            expectedVersion = review.GetProperty("version").GetUInt32(), summary = "Aicha raised the bar this year.", overallRating = 4,
            potential, answers = Answers(review, "Manager", "Keep mentoring the new joiners"),
        }));
    }

    [Fact]
    public async Task Self_submit_requires_every_answer_and_the_overall_rating_and_names_what_is_missing()
    {
        var (world, _, reviewId) = await LaunchedAsync();
        await using var _ = world;
        var aicha = world.As(world.Aicha);
        var review = await ReadAsync(aicha, reviewId);
        Assert.Equal("Subject", review.GetProperty("lens").GetString());
        var person = review.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Person").ToList();
        Assert.Equal(2, person.Count);
        // The person never sees the manager's answers before release, and never potential.
        Assert.False(review.GetProperty("potentialEnabled").GetBoolean());

        var draft = await Data(await aicha.PutAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = review.GetProperty("version").GetUInt32(), summary = "Draft",
            answers = new[] { new { questionId = person[0].GetProperty("questionId").GetGuid(), text = "Shipping the onboarding revamp" } },
        }));
        var missing = await Failure(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = draft.GetProperty("version").GetUInt32(), summary = "A year of steady delivery.",
        }));
        Assert.Equal(HttpStatusCode.BadRequest, missing.Status);
        var extra = missing.Body.GetProperty("details").GetProperty("extra");
        Assert.Equal(person[1].GetProperty("questionId").GetGuid(), Assert.Single(extra.GetProperty("questions").EnumerateArray()).GetGuid());
        Assert.True(extra.GetProperty("overallRating").GetBoolean());

        var notMine = await Failure(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = draft.GetProperty("version").GetUInt32(), summary = "x", overallRating = 4,
            answers = Answers(review, "Manager"),
        }));
        Assert.Equal(HttpStatusCode.BadRequest, notMine.Status);

        await SubmitSelfAsync(world, reviewId);
        var submitted = await ReadAsync(aicha, reviewId);
        Assert.Equal(4, submitted.GetProperty("selfAssessment").GetProperty("overallRating").GetInt32());
        Assert.All(submitted.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Person"),
            q => Assert.False(string.IsNullOrEmpty(q.GetProperty("selfAnswer").GetString())));
        var locked = await Failure(await aicha.PutAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = submitted.GetProperty("version").GetUInt32(), summary = "Changed my mind", overallRating = 2,
        }));
        Assert.Equal(HttpStatusCode.Forbidden, locked.Status);
    }

    [Fact]
    public async Task Manager_submit_requires_potential_closes_open_peer_requests_and_potential_never_reaches_the_person()
    {
        var (world, _, reviewId) = await LaunchedAsync();
        await using var _ = world;
        var (answered, open) = await PeersAsync(world, reviewId);
        await SubmitSelfAsync(world, reviewId);
        var mariam = world.As(world.Mariam);
        var reviewer = await ReadAsync(mariam, reviewId);
        Assert.Equal("Reviewer", reviewer.GetProperty("lens").GetString());
        var noPotential = await Failure(await mariam.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment", new
        {
            expectedVersion = reviewer.GetProperty("version").GetUInt32(), summary = "Aicha raised the bar.", overallRating = 4,
            answers = Answers(reviewer, "Manager"),
        }));
        Assert.Equal(HttpStatusCode.BadRequest, noPotential.Status);
        Assert.True(noPotential.Body.GetProperty("details").GetProperty("extra").GetProperty("potential").GetBoolean());

        await SubmitManagerAsync(world, reviewId);
        await using (var db = world.Factory.Store.NewContext())
        {
            Assert.Equal(PeerRequestState.Closed, db.PeerRequests.Single(r => r.Id == open).State);
            Assert.Equal(PeerRequestState.Answered, db.PeerRequests.Single(r => r.Id == answered).State);
        }
        var subjectView = await ReadAsync(world.As(world.Aicha), reviewId);
        Assert.Equal(JsonValueKind.Null, subjectView.GetProperty("potential").ValueKind);
        Assert.DoesNotContain("High", subjectView.GetRawText());
        Assert.DoesNotContain("unblocks everyone", subjectView.GetRawText());
        Assert.Equal(JsonValueKind.Null, subjectView.GetProperty("managerAssessment").ValueKind);
        var reviewerView = await ReadAsync(mariam, reviewId);
        Assert.Equal("High", reviewerView.GetProperty("potential").GetString());
    }

    [Fact]
    public async Task The_released_result_is_frozen_and_the_person_reads_answers_and_peers_words_with_names_but_never_potential()
    {
        var (world, round, reviewId) = await LaunchedAsync();
        await using var _ = world;
        await PeersAsync(world, reviewId);
        await SubmitSelfAsync(world, reviewId);
        await SubmitManagerAsync(world, reviewId);
        uint Version() { using var db = world.Factory.Store.NewContext(); return db.PerformanceReviews.Single(r => r.Id == reviewId).Version; }
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/finalize", new { expectedVersion = Version() }));
        var before = await ReadAsync(world.As(world.Aicha), reviewId);
        var original = before.GetProperty("questions")[0].GetProperty("text").GetString();

        // Library and settings change after release.
        var library = await Data(await world.Admin.GetAsync("/api/performance/settings/review-questions"));
        var first = library.EnumerateArray().Single(q => q.GetProperty("text").GetString() == original);
        await Data(await world.Admin.PutAsJsonAsync($"/api/performance/settings/review-questions/{first.GetProperty("id").GetGuid()}",
            new { expectedVersion = first.GetProperty("version").GetUInt32(), text = "Something else entirely now" }));

        var subject = await ReadAsync(world.As(world.Aicha), reviewId);
        Assert.Equal(original, subject.GetProperty("questions")[0].GetProperty("text").GetString());
        Assert.Contains(subject.GetProperty("questions").EnumerateArray(), q => q.GetProperty("managerAnswer").GetString() == "Keep mentoring the new joiners");
        Assert.Equal(JsonValueKind.Null, subject.GetProperty("potential").ValueKind);
        // Once results are out the person reads what each peer who answered said, with their name (D-69).
        var answered = Assert.Single(subject.GetProperty("peers").GetProperty("people").EnumerateArray().ToList());
        Assert.Equal("Leila Ben Salah", answered.GetProperty("displayName").GetString());
        Assert.Contains("unblocks everyone", answered.GetProperty("answers").GetRawText());
        Assert.Equal(JsonValueKind.Null, answered.GetProperty("state").ValueKind);
        Assert.DoesNotContain("Khaled", subject.GetProperty("peers").GetRawText());
        Assert.True(subject.GetProperty("canAcknowledge").GetBoolean());
        Assert.True(subject.GetProperty("canDownloadPdf").GetBoolean());

        var reviewer = await ReadAsync(world.As(world.Mariam), reviewId);
        Assert.Equal("High", reviewer.GetProperty("potential").GetString());
        Assert.Contains("unblocks everyone", reviewer.GetProperty("peers").GetRawText());
        await using (var db = world.Factory.Store.NewContext())
            Assert.Contains("Keep mentoring", db.PerformanceReviews.Single(r => r.Id == reviewId).FinalizedSnapshotJson);
    }

    [Fact]
    public async Task Acknowledgement_is_the_persons_once_after_release_and_tells_the_reviewer_without_the_comment()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false, questions: false, potential: false);
        await world.UpdateRoundAsync(round, self: false);
        await world.LaunchAsync(await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{round.GetProperty("id").GetGuid()}")));
        var reviewId = world.ReviewOf(round, world.Aicha);
        uint Version() { using var db = world.Factory.Store.NewContext(); return db.PerformanceReviews.Single(r => r.Id == reviewId).Version; }
        var aicha = world.As(world.Aicha);

        var early = await Failure(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/acknowledge", new { comment = (string?)null }));
        Assert.Equal(HttpStatusCode.Conflict, early.Status);
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment",
            new { expectedVersion = Version(), summary = "A strong year.", overallRating = 4 }));
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/finalize", new { expectedVersion = Version() }));

        var someoneElse = await Failure(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/acknowledge", new { comment = "x" }));
        Assert.Equal(HttpStatusCode.Forbidden, someoneElse.Status);
        var tooLong = await Failure(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/acknowledge", new { comment = new string('a', 1001) }));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.Status);
        const string comment = "Thanks. I'd like more stretch work next year.";
        var first = await Data(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/acknowledge", new { comment }));
        var again = await Data(await aicha.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/acknowledge", new { comment = "Different" }));
        Assert.Equal(comment, again.GetProperty("comment").GetString());
        Assert.Equal(first.GetProperty("at").GetString(), again.GetProperty("at").GetString());

        var reviewer = await ReadAsync(world.As(world.Mariam), reviewId);
        Assert.Equal(comment, reviewer.GetProperty("acknowledgement").GetProperty("comment").GetString());
        await using var db = world.Factory.Store.NewContext();
        var message = Assert.Single(db.OutboxMessages.Where(m => m.Kind == PerformanceNotificationKind.ReviewAcknowledged).ToList());
        Assert.Equal(world.Mariam.EmployeeId, message.RecipientEmployeeId);
        var email = db.Notifications.Single(n => n.DedupeKey == message.DedupeKey).EnglishEmail();
        Assert.DoesNotContain("stretch", email.Text + email.Html);
        Assert.Contains($"/performance/reviews/{reviewId}", email.Text);
        var audit = Assert.Single(db.AuditEntries.Where(a => a.Action == "Review.Acknowledged").ToList());
        Assert.DoesNotContain("stretch", audit.Summary);
    }

    [Fact]
    public async Task Each_lens_gets_its_own_parts()
    {
        var (world, round, reviewId) = await LaunchedAsync();
        await using var _ = world;
        await PeersAsync(world, reviewId);

        var subject = await ReadAsync(world.As(world.Aicha), reviewId);
        Assert.Equal("Subject", subject.GetProperty("lens").GetString());
        Assert.Empty(subject.GetProperty("activity").EnumerateArray());
        Assert.Equal(Today.AddDays(14).ToString("yyyy-MM-dd"), subject.GetProperty("schedule").GetProperty("selfAssessmentDue").GetString());
        Assert.False(subject.GetProperty("canMoveDueDate").GetBoolean());

        var reviewer = await ReadAsync(world.As(world.Mariam), reviewId);
        Assert.Equal("Reviewer", reviewer.GetProperty("lens").GetString());
        Assert.Equal(world.Aicha.EmployeeId, reviewer.GetProperty("year").GetProperty("subjectEmployeeId").GetGuid());
        // The draft self-assessment stays hidden from the reviewer.
        Assert.Equal(JsonValueKind.Null, reviewer.GetProperty("selfAssessment").ValueKind);
        Assert.Equal("Answered", reviewer.GetProperty("peers").GetProperty("people").EnumerateArray()
            .Single(p => p.GetProperty("employeeId").GetGuid() == world.Leila.EmployeeId).GetProperty("state").GetString());

        var admin = await ReadAsync(world.Admin, reviewId);
        Assert.Equal("Administrator", admin.GetProperty("lens").GetString());
        Assert.True(admin.GetProperty("canMoveDueDate").GetBoolean());
        Assert.True(admin.GetProperty("canClose").GetBoolean());
        Assert.Contains(admin.GetProperty("activity").EnumerateArray(), a => a.GetProperty("kind").GetString() == "PeersAsked");
        Assert.Contains("unblocks everyone", admin.GetProperty("peers").GetRawText());

        // A peer holding a request is not a reader of the review.
        var leila = await Failure(await world.As(world.Leila).GetAsync($"/api/performance/reviews/{reviewId}"));
        Assert.Equal(HttpStatusCode.Forbidden, leila.Status);
    }
}
