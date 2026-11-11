using System.Net;
using System.Net.Http.Json;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>The released review's PDF (D8, D-21): who downloads it and what each copy carries.</summary>
public sealed class ReviewPdfTests
{
    private static uint Version(ReviewWorld world, Guid reviewId)
    {
        using var db = world.Factory.Store.NewContext();
        return db.PerformanceReviews.Single(r => r.Id == reviewId).Version;
    }

    private static string Text(byte[] pdf)
    {
        using var document = PdfDocument.Open(pdf);
        return string.Join("\n", document.GetPages().Select(page => string.Join(" ", page.GetWords().Select(word => word.Text))));
    }

    [Fact]
    public async Task Each_reader_gets_their_copy_of_the_released_record_and_nobody_else_gets_one()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync();
        await world.LaunchAsync(round);
        var reviewId = world.ReviewOf(round, world.Aicha);
        var url = $"/api/performance/reviews/{reviewId}/pdf";

        // Peers: Leila answers.
        await using (var db = world.Factory.Store.NewContext())
        {
            var review = db.PerformanceReviews.Include(r => r.PeerNominations).Single(r => r.Id == reviewId);
            var peers = new[] { (world.Leila.EmployeeId, world.Leila.DisplayName) };
            var before = review.PeerNominations.ToList();
            review.ChangePeers(world.Mariam.EmployeeId, peers, DateTime.UtcNow);
            db.PeerNominations.RemoveRange(before.Except(review.PeerNominations));
            db.PeerNominations.AddRange(review.PeerNominations.Except(before));
            var request = PeerRequest.Create(review, world.Leila.EmployeeId, world.Leila.DisplayName, Today.AddDays(14), DateTime.UtcNow);
            var questions = db.ReviewQuestionSnapshots.Where(q => q.ReviewRoundId == review.ReviewRoundId && q.Audience == ReviewQuestionAudience.Peer)
                .Select(q => q.Id).ToList();
            request.Send(world.Leila.EmployeeId, questions.ToDictionary(id => id, _ => (string?)"PEERSECRET she unblocks the whole team."), questions, DateTime.UtcNow);
            db.PeerRequests.Add(request);
            db.PeerAnswers.AddRange(request.Answers);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Failure(await world.As(world.Aicha).GetAsync(url))).Status);

        var self = await Data(await world.As(world.Aicha).GetAsync($"/api/performance/reviews/{reviewId}"));
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/self-assessment", new
        {
            expectedVersion = self.GetProperty("version").GetUInt32(), summary = "A year of steady delivery.", overallRating = 4,
            answers = self.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Person")
                .Select(q => new { questionId = q.GetProperty("questionId").GetGuid(), text = "Getting payments to run our suite nightly" }).ToArray(),
        }));
        var manager = await Data(await world.As(world.Mariam).GetAsync($"/api/performance/reviews/{reviewId}"));
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/manager-assessment", new
        {
            expectedVersion = manager.GetProperty("version").GetUInt32(), summary = "Testing became something the team relies on.",
            overallRating = 4, potential = "High",
            answers = manager.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Manager")
                .Select(q => new { questionId = q.GetProperty("questionId").GetGuid(), text = "Pairing with other teams" }).ToArray(),
        }));
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{reviewId}/finalize", new { expectedVersion = Version(world, reviewId) }));
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{reviewId}/acknowledge", new { comment = "Agreed on the dependency point." }));

        using var subjectResponse = await world.As(world.Aicha).GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, subjectResponse.StatusCode);
        Assert.Equal("application/pdf", subjectResponse.Content.Headers.ContentType?.MediaType);
        var subjectPdf = await subjectResponse.Content.ReadAsByteArrayAsync();
        var subjectText = Text(subjectPdf);
        Assert.Contains("Aicha Ben Ali", subjectText);
        Assert.Contains("Strong", subjectText);
        Assert.Contains("Testing became something the team relies on.", subjectText);
        Assert.Contains("Pairing with other teams", subjectText);
        Assert.Contains("Getting payments to run our suite nightly", subjectText);
        Assert.Contains("Agreed on the dependency point.", subjectText);
        // The person reads peers' words with their names once results are out (D-69).
        Assert.Contains("PEERSECRET", subjectText);
        Assert.DoesNotContain("Potential", subjectText);
        Assert.DoesNotContain("High", subjectText);
        // A second download of the same copy carries the same content.
        Assert.Equal(subjectText, Text(await (await world.As(world.Aicha).GetAsync(url)).Content.ReadAsByteArrayAsync()));

        var reviewerText = Text(await (await world.As(world.Mariam).GetAsync(url)).Content.ReadAsByteArrayAsync());
        Assert.Contains("PEERSECRET", reviewerText);
        Assert.Contains("High", reviewerText);
        var hrText = Text(await (await world.Admin.GetAsync(url)).Content.ReadAsByteArrayAsync());
        Assert.Contains("PEERSECRET", hrText);
        Assert.DoesNotContain("Calibrat", hrText);

        Assert.Equal(HttpStatusCode.Forbidden, (await Failure(await world.As(world.Fares).GetAsync(url))).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Failure(await world.As(world.Leila).GetAsync(url))).Status);
        using var foreign = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: world.Aicha.EmployeeId,
            permissions: [new(EY.HRPlatform.SharedKernel.Auth.PerformancePermissions.CycleView, EY.HRPlatform.SharedKernel.Auth.PermissionScopes.Self)]);
        Assert.Equal(HttpStatusCode.NotFound, (await Failure(await foreign.GetAsync(url))).Status);
        await using (var db = world.Factory.Store.NewContext())
            Assert.Equal(4, db.AuditEntries.Count(a => a.Action == "Review.PdfDownloaded"));
    }
}
