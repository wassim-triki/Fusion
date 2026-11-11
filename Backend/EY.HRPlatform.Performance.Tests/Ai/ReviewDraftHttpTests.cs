using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Ai;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using static EY.HRPlatform.Performance.Tests.TestHelpers.CalibrationWorld;

namespace EY.HRPlatform.Performance.Tests.Ai;

/// <summary>
/// The review draft (W4) and self-reflection starter (W5): sources per lens, cited sentences only, no ratings,
/// a quiet abstention, the writers' authority, AI availability, and an audit without content (D-26 to D-28).
/// </summary>
public sealed class ReviewDraftHttpTests
{
    private static readonly EffectivePermissionGrant[] Reviewer = [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Employee =
        [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];

    /// <summary>Aicha's year: two objectives, Fares's shared feedback, his manager-only note to Mariam, and praise. Five sources for Mariam, four for Aicha.</summary>
    private static async Task<(World World, PerformanceReview Aicha)> ArrangeAsync(PerformanceApiFactory factory, bool selfAssessment = false,
        bool year = true)
    {
        await using var db = factory.Store.NewContext();
        var world = await SeedAsync(db, factory.Store, [new("Aicha Bouazizi", "Mariam Gharbi")], start: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-60)),
            selfAssessment: selfAssessment, managerQuestion: "What should they focus on next year?");
        var aicha = world.Reviews[0];
        if (!year)
        {
            await PlanAsync(db, world, aicha, ("Automate the regression suite", 100m, 92m));
            return (world, aicha);
        }
        await PlanAsync(db, world, aicha, ("Automate the regression suite", 60m, 92m), ("Ship the release dashboard", 40m, 50m));
        var fares = Guid.NewGuid();
        var value = Competency.Create(factory.Store.TenantId, "Ownership", "Owns outcomes", null);
        db.AddRange(value,
            Feedback.Give(Guid.NewGuid(), factory.Store.TenantId, fares, "Fares Lachheb", aicha.SubjectEmployeeId, "Aicha Bouazizi", FeedbackVisibility.Shared,
                aicha.ReviewerEmployeeId, "Mariam Gharbi", FeedbackSubject.None, "SHARED: the nightly suite caught the payments regression.", DateTime.UtcNow.AddDays(-20)),
            Feedback.Give(Guid.NewGuid(), factory.Store.TenantId, fares, "Fares Lachheb", aicha.SubjectEmployeeId, "Aicha Bouazizi", FeedbackVisibility.ManagerOnly,
                aicha.ReviewerEmployeeId, "Mariam Gharbi", FeedbackSubject.None, "MANAGER-ONLY: hand-offs ran late twice.", DateTime.UtcNow.AddDays(-10)),
            Praise.Give(Guid.NewGuid(), factory.Store.TenantId, fares, "Fares Lachheb", value.Id, "Owned the release end to end.",
                [(aicha.SubjectEmployeeId, "Aicha Bouazizi")], DateTime.UtcNow.AddDays(-5)));
        await db.SaveChangesAsync();
        return (world, aicha);
    }

    private static object Answer(params (string Text, int[] Sources)[] sentences) => new
    {
        contractVersion = "review-draft/1",
        disposition = "draft",
        sentences = sentences.Select(sentence => new { text = sentence.Text, sources = sentence.Sources }),
    };

    private static async Task<JsonElement> Data(HttpResponseMessage response) => await ReviewQuestionLibraryTests.ReadDataAsync(response);

    [Fact]
    public async Task The_reviewer_gets_cited_sentences_with_private_sources_marked_and_never_a_rating()
    {
        await using var factory = new PerformanceApiFactory();
        var (world, aicha) = await ArrangeAsync(factory);
        factory.Ai.Answer = Answer(
            ("Aicha moved regression testing to a nightly suite.", [1]),
            ("Colleagues credit the suite with catching a payments regression, though hand-offs ran late.", [3, 4, 5]),
            ("Her potential is clearly high.", [1]),
            ("She exceeded every target.", [99]));
        using var mariam = factory.CreateAuthenticatedClient(employeeId: aicha.ReviewerEmployeeId, permissions: Reviewer);
        var draft = await Data(await mariam.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft", new { kind = "summary" }));

        Assert.Equal(("Drafted", 5, 1), (draft.GetProperty("outcome").GetString(), draft.GetProperty("sourceCount").GetInt32(),
            draft.GetProperty("privateSentenceCount").GetInt32()));
        var sentences = draft.GetProperty("sentences").EnumerateArray().ToArray();
        Assert.Equal(2, sentences.Length);
        Assert.Contains(sentences[1].GetProperty("sources").EnumerateArray(), source => !source.GetProperty("subjectVisible").GetBoolean()
            && source.GetProperty("kind").GetString() == "feedback");
        var input = JsonSerializer.Serialize(factory.Ai.Requests.Single().Input);
        Assert.Contains("MANAGER-ONLY", input);
        Assert.DoesNotContain(aicha.Id.ToString(), input);

        await using var db = factory.Store.NewContext();
        var audit = await db.AuditEntries.SingleAsync(entry => entry.Action == PerformanceAuditActions.AiGenerated);
        Assert.Contains("review draft", audit.Summary);
        Assert.Contains("\"sources\":5", audit.Summary);
        Assert.DoesNotContain("nightly", audit.Summary);
        Assert.DoesNotContain("SHARED", audit.Summary);
    }

    [Fact]
    public async Task The_reviewer_drafts_one_manager_question()
    {
        await using var factory = new PerformanceApiFactory();
        var (world, aicha) = await ArrangeAsync(factory);
        factory.Ai.Answer = Answer(("Owning the vendor dependency earlier.", [2]), ("Taking the release dashboard to all four lines.", [2, 3]));
        using var mariam = factory.CreateAuthenticatedClient(employeeId: aicha.ReviewerEmployeeId, permissions: Reviewer);
        var draft = await Data(await mariam.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft",
            new { kind = "question", questionId = world.ManagerQuestion!.Id }));
        Assert.Equal(2, draft.GetProperty("sentences").GetArrayLength());
        Assert.Contains("What should they focus on next year?", JsonSerializer.Serialize(factory.Ai.Requests.Single().Input));
        using var unknown = await mariam.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft", new { kind = "question", questionId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }

    [Fact]
    public async Task The_person_starts_from_what_they_may_see_in_their_own_voice()
    {
        await using var factory = new PerformanceApiFactory();
        var (_, aicha) = await ArrangeAsync(factory, selfAssessment: true);
        factory.Ai.Answer = Answer(("I moved regression testing to a nightly suite.", [1]), ("The suite caught the payments regression.", [3]));
        using var self = factory.CreateAuthenticatedClient(employeeId: aicha.SubjectEmployeeId, permissions: Employee);
        var draft = await Data(await self.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft", new { kind = "summary" }));
        Assert.Equal((4, 0), (draft.GetProperty("sourceCount").GetInt32(), draft.GetProperty("privateSentenceCount").GetInt32()));
        var input = JsonSerializer.Serialize(factory.Ai.Requests.Single().Input);
        Assert.DoesNotContain("MANAGER-ONLY", input);
        Assert.Contains("\"lens\":\"self\"", input);
        // The person drafts only their own questions (D-68); any other question isn't there for them.
        using var question = await self.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft", new { kind = "question", questionId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.NotFound, question.StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task One_on_one_notes_reach_both_lenses_but_private_notes_and_peer_answers_only_the_reviewer(bool self)
    {
        await using var factory = new PerformanceApiFactory();
        var (_, aicha) = await ArrangeAsync(factory, selfAssessment: self);
        await using (var db = factory.Store.NewContext())
        {
            var (series, meeting) = OneOnOneSeries.Start(factory.Store.TenantId, aicha.ReviewerEmployeeId, aicha.SubjectEmployeeId,
                OneOnOneCadence.EveryTwoWeeks, aicha.ReviewerEmployeeId, DateTime.UtcNow.AddDays(-14), DateTime.UtcNow.AddDays(-30), "Mariam Gharbi", "Aicha Bouazizi");
            var talked = Guid.NewGuid();
            meeting.AddAgendaItem(talked, "Vendor delays", aicha.ReviewerEmployeeId, null, out _);
            meeting.SetItemNote(talked, "SHARED-NOTE: agreed to raise vendor delays earlier.", 0, false, DateTime.UtcNow);
            var mine = OneOnOnePrivateNote.Create(factory.Store.TenantId, meeting.Id, aicha.ReviewerEmployeeId);
            mine.Set("PRIVATE-NOTE: watch the hand-offs.", 0);
            var hers = OneOnOnePrivateNote.Create(factory.Store.TenantId, meeting.Id, aicha.SubjectEmployeeId);
            hers.Set("HER-PRIVATE-NOTE: ask about the lead role.", 0);
            var question = Guid.NewGuid();
            var peer = PeerRequest.Create(aicha, Guid.NewGuid(), "Walid Jaziri", null, DateTime.UtcNow.AddDays(-3));
            peer.Send(peer.PeerEmployeeId, new Dictionary<Guid, string?> { [question] = "PEER-ANSWER: steady under pressure." }, [question], DateTime.UtcNow);
            db.AddRange(series, meeting, mine, hers, peer);
            await db.SaveChangesAsync();
        }
        factory.Ai.Answer = Answer(("One.", [1]), ("Two.", [2]));
        using var client = self
            ? factory.CreateAuthenticatedClient(employeeId: aicha.SubjectEmployeeId, permissions: Employee)
            : factory.CreateAuthenticatedClient(employeeId: aicha.ReviewerEmployeeId, permissions: Reviewer);
        await Data(await client.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft", new { kind = "summary" }));

        var input = JsonSerializer.Serialize(factory.Ai.Requests.Single().Input);
        Assert.Contains("SHARED-NOTE", input);
        Assert.DoesNotContain("HER-PRIVATE-NOTE", input);
        Assert.Equal(!self, input.Contains("PRIVATE-NOTE: watch"));
        Assert.Equal(!self, input.Contains("PEER-ANSWER"));
    }

    [Fact]
    public async Task Too_little_to_draft_from_abstains_quietly()
    {
        await using var factory = new PerformanceApiFactory();
        var (_, aicha) = await ArrangeAsync(factory, year: false);
        using var mariam = factory.CreateAuthenticatedClient(employeeId: aicha.ReviewerEmployeeId, permissions: Reviewer);
        var draft = await Data(await mariam.PostAsJsonAsync($"/api/performance/reviews/{aicha.Id}/draft", new { kind = "summary" }));
        Assert.Equal(("Abstained", 0), (draft.GetProperty("outcome").GetString(), draft.GetProperty("sentences").GetArrayLength()));
        Assert.Empty(factory.Ai.Requests);
        await using var db = factory.Store.NewContext();
        Assert.Contains("Abstained", (await db.AuditEntries.SingleAsync(entry => entry.Action == PerformanceAuditActions.AiGenerated)).Summary);

        // Enough sources but one usable sentence is an abstention too.
        var (_, other) = await ArrangeAsync(factory);
        factory.Ai.Answer = Answer(("Aicha moved testing to a nightly suite.", [1]), ("Uncited.", []));
        using var reviewer = factory.CreateAuthenticatedClient(employeeId: other.ReviewerEmployeeId, permissions: Reviewer);
        var thin = await Data(await reviewer.PostAsJsonAsync($"/api/performance/reviews/{other.Id}/draft", new { kind = "summary" }));
        Assert.Equal("Abstained", thin.GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task Only_the_writers_may_draft_and_only_while_AI_is_available()
    {
        await using var factory = new PerformanceApiFactory();
        var (_, aicha) = await ArrangeAsync(factory);
        var path = $"/api/performance/reviews/{aicha.Id}/draft";
        using (var hr = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin))
            Assert.Equal(HttpStatusCode.NotFound, (await hr.PostAsJsonAsync(path, new { kind = "summary" })).StatusCode);
        using (var stranger = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Reviewer))
            Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync(path, new { kind = "summary" })).StatusCode);
        // The subject while the manager writes: not their turn.
        using (var subject = factory.CreateAuthenticatedClient(employeeId: aicha.SubjectEmployeeId, permissions: Employee))
            Assert.Equal(HttpStatusCode.Conflict, (await subject.PostAsJsonAsync(path, new { kind = "summary" })).StatusCode);

        using var mariam = factory.CreateAuthenticatedClient(employeeId: aicha.ReviewerEmployeeId, permissions: Reviewer);
        factory.Ai.Failure = new AiProviderException(AiFailureCategory.Timeout, "slow");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await mariam.PostAsJsonAsync(path, new { kind = "summary" })).StatusCode);
        await using (var db = factory.Store.NewContext())
            Assert.Contains("Failed", (await db.AuditEntries.SingleAsync(entry => entry.Action == PerformanceAuditActions.AiGenerated)).Summary);

        factory.Ai.Failure = null;
        await using (var db = factory.Store.NewContext())
        {
            var settings = CycleSettings.CreateDefault(factory.Store.TenantId);
            settings.Update(settings.DefaultMeasurementMethod, 3, 6, 30, settings.PlanAlignmentPolicy, aiAssistanceEnabled: false);
            db.CycleSettings.Add(settings);
            await db.SaveChangesAsync();
        }
        var calls = factory.Ai.Requests.Count;
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await mariam.PostAsJsonAsync(path, new { kind = "summary" })).StatusCode);
        Assert.Equal(calls, factory.Ai.Requests.Count);
    }
}
