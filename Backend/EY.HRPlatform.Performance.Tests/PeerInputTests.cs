using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Peer input (D-40, D-69, D-74): Fusion asks at launch, the manager changes who, the peer's own request, closure and suggestions.</summary>
public sealed class PeerInputTests
{
    private static uint Version(ReviewWorld world, Guid reviewId)
    {
        using var db = world.Factory.Store.NewContext();
        return db.PerformanceReviews.Single(r => r.Id == reviewId).Version;
    }

    private static Task<HttpResponseMessage> Change(ReviewWorld world, HttpClient client, Guid reviewId, params Guid[] ids)
        => client.PutAsJsonAsync($"/api/performance/reviews/{reviewId}/peers", new { expectedVersion = Version(world, reviewId), employeeIds = ids });

    private static async Task<(ReviewWorld World, Guid Review)> LaunchedAsync(bool peers = true)
    {
        var world = await CreateAsync();
        var round = await world.CreateRoundAsync(peers: peers);
        await world.LaunchAsync(round);
        return (world, world.ReviewOf(round, world.Aicha));
    }

    [Fact]
    public async Task Fusion_asks_the_closest_colleagues_in_the_year_when_the_round_opens_and_tells_each_why()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var tenant = world.Factory.Store.TenantId;
        var earlier = DateTime.UtcNow.AddDays(-20);
        await using (var db = world.Factory.Store.NewContext())
        {
            // Leila and Khaled are in the year too: Leila gave Aicha shared feedback twice, Khaled only manager-only words.
            foreach (var person in new[] { world.Leila, world.Khaled })
                db.Participants.Add(Domain.Population.Participant.Create(tenant, world.Cycle.Id, person.EmployeeId, person.DisplayName, null, null, null,
                    world.Amira.EmployeeId, world.Amira.DisplayName, false, world.Cycle.StartDate));
            for (var i = 0; i < 2; i++)
                db.Add(Feedback.Give(Guid.NewGuid(), tenant, world.Leila.EmployeeId, world.Leila.DisplayName, world.Aicha.EmployeeId,
                    world.Aicha.DisplayName, FeedbackVisibility.Shared, null, null, FeedbackSubject.None,
                    "Share plans earlier; we heard about the vendor delay from the release notes.", earlier.AddDays(i)));
            db.Add(Feedback.Give(Guid.NewGuid(), tenant, world.Khaled.EmployeeId, world.Khaled.DisplayName, world.Aicha.EmployeeId,
                world.Aicha.DisplayName, FeedbackVisibility.ManagerOnly, world.Mariam.EmployeeId, world.Mariam.DisplayName, FeedbackSubject.None,
                "KHALEDPRIVATE for Mariam only", earlier));
            await db.SaveChangesAsync();
        }
        var round = await world.CreateRoundAsync();
        await world.LaunchAsync(round);
        var reviewId = world.ReviewOf(round, world.Aicha);

        await using (var db = world.Factory.Store.NewContext())
        {
            var asked = db.PeerRequests.Where(r => r.ReviewId == reviewId).ToList();
            // Leila (feedback) and her teammates Fares and Tarek; never Mariam (the reviewer) or Khaled (manager-only words don't count).
            Assert.Equal(new[] { world.Fares.EmployeeId, world.Leila.EmployeeId, world.Tarek.EmployeeId }.ToHashSet(),
                asked.Select(r => r.PeerEmployeeId).ToHashSet());
            Assert.All(asked, r => Assert.Equal(PeerRequestState.Open, r.State));
            Assert.All(db.PeerNominations.Where(n => n.ReviewId == reviewId).ToList(), n => Assert.Equal(PeerNominationSource.Fusion, n.Source));
            var told = db.Notifications.First(n => n.Kind == PerformanceNotificationKind.PeerInputRequested && n.RecipientEmployeeId == world.Leila.EmployeeId);
            Assert.StartsWith("/performance/reviews/peer-requests/", told.Href);
        }

        Guid leilaRequest;
        await using (var db = world.Factory.Store.NewContext())
            leilaRequest = db.PeerRequests.Single(r => r.ReviewId == reviewId && r.PeerEmployeeId == world.Leila.EmployeeId).Id;
        var page = await Data(await world.As(world.Leila).GetAsync($"/api/performance/peer-requests/{leilaRequest}"));
        Assert.Equal("Mariam Gharbi", page.GetProperty("reviewerDisplayName").GetString());
        var reason = Assert.Single(page.GetProperty("reasons").EnumerateArray().ToList());
        Assert.Equal("feedbackGiven", reason.GetProperty("kind").GetString());
        Assert.StartsWith("Share plans earlier", reason.GetProperty("excerpt").GetString());
        Assert.DoesNotContain("KHALEDPRIVATE", page.GetRawText());
    }

    [Fact]
    public async Task Only_the_reviewer_changes_who_is_asked_until_their_review_is_in()
    {
        var (world, reviewId) = await LaunchedAsync();
        await using var _ = world;
        // The person, a colleague and another tenant can't change the list.
        Assert.Equal(HttpStatusCode.Forbidden, (await Failure(await Change(world, world.As(world.Aicha), reviewId, world.Leila.EmployeeId))).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Failure(await Change(world, world.As(world.Fares), reviewId, world.Leila.EmployeeId))).Status);
        using (var foreign = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: world.Mariam.EmployeeId,
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)]))
            Assert.Equal(HttpStatusCode.NotFound, (await Failure(await Change(world, foreign, reviewId, world.Leila.EmployeeId))).Status);
        var mariam = world.As(world.Mariam);
        Assert.Equal(HttpStatusCode.BadRequest, (await Failure(await Change(world, mariam, reviewId, world.Aicha.EmployeeId))).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await Failure(await Change(world, mariam, reviewId, world.Mariam.EmployeeId))).Status);
        var gone = world.Factory.Core.Add("Gone Colleague", isActive: false);
        Assert.Equal(HttpStatusCode.BadRequest, (await Failure(await Change(world, mariam, reviewId, gone.EmployeeId))).Status);

        // Fusion asked Fares and Tarek; Mariam keeps Fares, drops Tarek and adds Khaled.
        var peers = await Data(await Change(world, mariam, reviewId, world.Fares.EmployeeId, world.Khaled.EmployeeId));
        Assert.Equal(2, peers.GetProperty("people").GetArrayLength());
        Guid tarekRequest;
        await using (var db = world.Factory.Store.NewContext())
        {
            var requests = db.PeerRequests.Where(r => r.ReviewId == reviewId).ToList();
            tarekRequest = requests.Single(r => r.PeerEmployeeId == world.Tarek.EmployeeId).Id;
            Assert.Equal(PeerRequestState.Closed, requests.Single(r => r.Id == tarekRequest).State);
            Assert.Equal(PeerRequestState.Open, requests.Single(r => r.PeerEmployeeId == world.Khaled.EmployeeId).State);
            Assert.Single(db.Notifications.Where(n => n.Kind == PerformanceNotificationKind.PeerInputRequested && n.RecipientEmployeeId == world.Khaled.EmployeeId));
            Assert.Contains(db.AuditEntries, a => a.Action == "Review.PeersChanged" && a.Summary.Contains(world.Tarek.EmployeeId.ToString()));
        }

        // Fares answers: he stays. Asked again, Tarek's request opens again.
        var questions = (await Data(await world.As(world.Fares).GetAsync($"/api/performance/peer-requests/{RequestOf(world, reviewId, world.Fares)}")))
            .GetProperty("questions").EnumerateArray().Select(q => q.GetProperty("questionId").GetGuid()).ToArray();
        await Data(await world.As(world.Fares).PostAsJsonAsync($"/api/performance/peer-requests/{RequestOf(world, reviewId, world.Fares)}/send",
            new { answers = questions.Select(id => new { questionId = id, text = "Steady under pressure." }).ToArray() }));
        Assert.Equal(HttpStatusCode.BadRequest, (await Failure(await Change(world, mariam, reviewId, world.Khaled.EmployeeId))).Status);
        await Data(await Change(world, mariam, reviewId, world.Fares.EmployeeId, world.Khaled.EmployeeId, world.Tarek.EmployeeId));
        await using (var db = world.Factory.Store.NewContext())
            Assert.Equal(PeerRequestState.Open, db.PeerRequests.Single(r => r.Id == tarekRequest).State);
    }

    [Fact]
    public async Task Changing_who_is_asked_is_refused_when_the_round_does_not_ask_for_peer_input()
    {
        var (world, reviewId) = await LaunchedAsync(peers: false);
        await using var _ = world;
        var refused = await Failure(await Change(world, world.As(world.Mariam), reviewId, world.Leila.EmployeeId));
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
    }

    private static Guid RequestOf(ReviewWorld world, Guid reviewId, WorkforceSnapshot peer)
    {
        using var db = world.Factory.Store.NewContext();
        return db.PeerRequests.Single(r => r.ReviewId == reviewId && r.PeerEmployeeId == peer.EmployeeId).Id;
    }

    [Fact]
    public async Task A_peer_answers_or_declines_on_their_own_page_and_never_sees_the_review()
    {
        var (world, reviewId) = await LaunchedAsync();
        await using var _ = world;
        await Data(await Change(world, world.As(world.Mariam), reviewId, world.Fares.EmployeeId, world.Khaled.EmployeeId, world.Leila.EmployeeId));
        Guid RequestOf(WorkforceSnapshot peer) => PeerInputTests.RequestOf(world, reviewId, peer);
        var faresRequest = RequestOf(world.Fares);
        var fares = world.As(world.Fares);

        var page = await Data(await fares.GetAsync($"/api/performance/peer-requests/{faresRequest}"));
        Assert.Equal("Aicha Ben Ali", page.GetProperty("subjectDisplayName").GetString());
        var questions = page.GetProperty("questions").EnumerateArray().Select(q => q.GetProperty("questionId").GetGuid()).ToArray();
        Assert.Equal(2, questions.Length);
        Assert.DoesNotContain("Khaled", page.GetRawText());
        Assert.DoesNotContain("Assessment", page.GetRawText());
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await world.As(world.Khaled).GetAsync($"/api/performance/peer-requests/{faresRequest}"))).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await world.Admin.GetAsync($"/api/performance/peer-requests/{faresRequest}"))).Status);
        using var foreign = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: world.Fares.EmployeeId,
            permissions: [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.Self)]);
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await foreign.GetAsync($"/api/performance/peer-requests/{faresRequest}"))).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Failure(await fares.GetAsync($"/api/performance/reviews/{reviewId}"))).Status);

        var draft = await Data(await fares.PutAsJsonAsync($"/api/performance/peer-requests/{faresRequest}",
            new { answers = new[] { new { questionId = questions[0], text = "She makes hard calls kindly." } } }));
        Assert.Equal("She makes hard calls kindly.", draft.GetProperty("questions")[0].GetProperty("answer").GetString());
        var empty = await Failure(await fares.PostAsJsonAsync($"/api/performance/peer-requests/{faresRequest}/send",
            new { answers = new[] { new { questionId = questions[1], text = "" } } }));
        Assert.Equal(HttpStatusCode.BadRequest, empty.Status);
        Assert.Equal(questions[1], empty.Body.GetProperty("details").GetProperty("extra").GetProperty("questions")[0].GetGuid());
        var tooLong = await Failure(await fares.PutAsJsonAsync($"/api/performance/peer-requests/{faresRequest}",
            new { answers = new[] { new { questionId = questions[1], text = new string('a', 2001) } } }));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.Status);
        // A day late is still accepted: due dates are advisory.
        await using (var db = world.Factory.Store.NewContext())
        {
            var request = db.PeerRequests.Single(r => r.Id == faresRequest);
            db.Entry(request).Property(r => r.DueDate).CurrentValue = Today.AddDays(-1);
            await db.SaveChangesAsync();
        }
        var sent = await Data(await fares.PostAsJsonAsync($"/api/performance/peer-requests/{faresRequest}/send",
            new { answers = new[] { new { questionId = questions[1], text = "Share drafts earlier." } } }));
        Assert.Equal("Answered", sent.GetProperty("state").GetString());
        Assert.False(sent.GetProperty("canAnswer").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await Failure(await fares.PostAsJsonAsync($"/api/performance/peer-requests/{faresRequest}/send",
            new { answers = new[] { new { questionId = questions[1], text = "Changed" } } }))).Status);

        var declined = await Data(await world.As(world.Khaled).PostAsJsonAsync($"/api/performance/peer-requests/{RequestOf(world.Khaled)}/decline",
            new { note = "Haven't worked with Aicha since March" }));
        Assert.Equal("Declined", declined.GetProperty("state").GetString());

        var subject = await Data(await world.As(world.Aicha).GetAsync($"/api/performance/reviews/{reviewId}"));
        var asked = subject.GetProperty("peers").GetProperty("people").EnumerateArray().ToList();
        Assert.Equal(3, asked.Count);
        Assert.DoesNotContain("since March", subject.GetRawText());
        Assert.DoesNotContain("hard calls", subject.GetRawText());
        Assert.All(asked, p => Assert.Equal(JsonValueKind.Null, p.GetProperty("state").ValueKind));
        var reviewer = await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}"));
        var people = reviewer.GetProperty("peers").GetProperty("people").EnumerateArray().ToList();
        Assert.Equal("Haven't worked with Aicha since March", people.Single(p => p.GetProperty("employeeId").GetGuid() == world.Khaled.EmployeeId)
            .GetProperty("declineNote").GetString());
        Assert.Equal("Fares Jaziri", people.Single(p => p.GetProperty("state").GetString() == "Answered").GetProperty("displayName").GetString());
        await using (var db = world.Factory.Store.NewContext())
        {
            Assert.Single(db.Notifications.Where(n => n.Kind == PerformanceNotificationKind.PeerDeclined && n.RecipientEmployeeId == world.Mariam.EmployeeId));
            Assert.DoesNotContain(db.AuditEntries.ToList(), a => a.Summary.Contains("since March") || a.Summary.Contains("hard calls"));
        }

        // Once the reviewer submits, Leila's unanswered request closes and late answers are refused.
        var review = await Data(await world.As(world.Aicha).GetAsync($"/api/performance/reviews/{reviewId}"));
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = review.GetProperty("version").GetUInt32(), summary = "Done", overallRating = 4,
            answers = review.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Person")
                .Select(q => new { questionId = q.GetProperty("questionId").GetGuid(), text = "An answer" }).ToArray(),
        }));
        var manager = await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}"));
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment", new
        {
            expectedVersion = manager.GetProperty("version").GetUInt32(), summary = "Strong", overallRating = 4, potential = "Growing",
            answers = manager.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Manager")
                .Select(q => new { questionId = q.GetProperty("questionId").GetGuid(), text = "An answer" }).ToArray(),
        }));
        var late = await Failure(await world.As(world.Leila).PostAsJsonAsync($"/api/performance/peer-requests/{RequestOf(world.Leila)}/send",
            new { answers = questions.Select(id => new { questionId = id, text = "Too late" }).ToArray() }));
        Assert.Equal(HttpStatusCode.Conflict, late.Status);
        Assert.Equal("PeerRequest.Closed", late.Code);
    }

    [Fact]
    public async Task Suggestions_rank_colleagues_by_the_persons_year_and_leave_out_the_reviewer_and_inactive_people()
    {
        var (world, reviewId) = await LaunchedAsync();
        await using var _ = world;
        var gone = world.Factory.Core.Add("Gone Colleague", isActive: false);
        await using (var db = world.Factory.Store.NewContext())
        {
            var tenant = world.Factory.Store.TenantId;
            var now = DateTime.UtcNow.AddDays(-10);
            Feedback Give(WorkforceSnapshot from, WorkforceSnapshot to)
                => Feedback.Give(Guid.NewGuid(), tenant, from.EmployeeId, from.DisplayName, to.EmployeeId, to.DisplayName,
                    FeedbackVisibility.Shared, null, null, FeedbackSubject.None, "Thanks for the help on the launch.", now);
            for (var i = 0; i < 3; i++) db.Add(Give(world.Leila, world.Aicha));
            for (var i = 0; i < 3; i++) db.Add(Give(world.Aicha, world.Leila));
            db.Add(Give(world.Khaled, world.Aicha));
            db.Add(Give(world.Mariam, world.Aicha));
            db.Add(Give(gone, world.Aicha));
            db.Add(Praise.Give(Guid.NewGuid(), tenant, world.Tarek.EmployeeId, world.Tarek.DisplayName, Guid.NewGuid(), "Great demo",
                [(world.Aicha.EmployeeId, world.Aicha.DisplayName)], now));
            // Manager-only feedback addressed to someone other than the reviewer: not hers to see, so it doesn't count.
            db.Add(Feedback.Give(Guid.NewGuid(), tenant, world.Fares.EmployeeId, world.Fares.DisplayName, world.Aicha.EmployeeId,
                world.Aicha.DisplayName, FeedbackVisibility.ManagerOnly, world.Amira.EmployeeId, world.Amira.DisplayName, FeedbackSubject.None,
                "For Amira only", now));
            // Outside the review period: doesn't count.
            db.Add(Feedback.Give(Guid.NewGuid(), tenant, world.Fares.EmployeeId, world.Fares.DisplayName, world.Aicha.EmployeeId,
                world.Aicha.DisplayName, FeedbackVisibility.Shared, null, null, FeedbackSubject.None, "Old note", DateTime.UtcNow.AddDays(-400)));
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await Failure(await world.As(world.Fares).GetAsync($"/api/performance/reviews/{reviewId}/peer-suggestions"))).Status);
        var suggestions = (await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}/peer-suggestions"))).EnumerateArray().ToList();
        // Fares and Tarek are already asked (Fusion's picks at launch), so they don't come up again.
        Assert.Equal(new[] { "Leila Ben Salah", "Khaled Sassi" }, suggestions.Select(s => s.GetProperty("displayName").GetString()));
        Assert.Equal(6, suggestions[0].GetProperty("feedbackExchanged").GetInt32());
        Assert.DoesNotContain(suggestions, s => s.GetProperty("employeeId").GetGuid() == world.Fares.EmployeeId);

        await Data(await Change(world, world.As(world.Mariam), reviewId, world.Fares.EmployeeId, world.Tarek.EmployeeId, world.Leila.EmployeeId));
        var after = (await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}/peer-suggestions"))).EnumerateArray();
        Assert.DoesNotContain(after, s => s.GetProperty("employeeId").GetGuid() == world.Leila.EmployeeId);
    }
}
