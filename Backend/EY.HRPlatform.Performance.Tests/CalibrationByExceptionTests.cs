using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Calibration;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using static EY.HRPlatform.Performance.Tests.TestHelpers.CalibrationWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Calibration by exception (D-35, D-70): only flagged reviews wait on a look; release sends out what is ready.</summary>
public sealed class CalibrationByExceptionTests
{
    private static readonly NineBoxBands Bands = new(2, 3); // 1–2 · 3 · 4–5

    [Fact]
    public void A_review_is_flagged_for_its_goals_a_move_since_last_year_or_a_manager_rating_far_from_everyone()
    {
        Guid omar = Guid.NewGuid(), mariam = Guid.NewGuid();
        var top = new FlagInput(Guid.NewGuid(), mariam, "Mariam", 5, 0.46m, null);
        var bottom = new FlagInput(Guid.NewGuid(), mariam, "Mariam", 1, 0.9m, null);
        var moved = new FlagInput(Guid.NewGuid(), mariam, "Mariam", 1, null, new InsightLastResult(3, 5, "FY26"));
        var steady = new FlagInput(Guid.NewGuid(), mariam, "Mariam", 3, 0.7m, new InsightLastResult(3, 5, "FY26"));
        // Omar rates far above everyone: only his top-band reviews are flagged.
        var generous = new[] { 5, 5, 4, 3 }.Select(r => new FlagInput(Guid.NewGuid(), omar, "Omar", r, null, null)).ToArray();
        var others = Enumerable.Range(0, 6).Select(_ => new FlagInput(Guid.NewGuid(), mariam, "Mariam", 2, null, null)).ToArray();

        var flags = CalibrationFlags.Compute([top, bottom, moved, steady, .. generous, .. others], Bands, 5);

        Assert.Equal(CalibrationFlagKind.Goals, flags[top.ReviewId].Kind);
        Assert.Equal(0.46m, flags[top.ReviewId].Grade);
        Assert.Equal(CalibrationFlagKind.Goals, flags[bottom.ReviewId].Kind);
        Assert.Equal((CalibrationFlagKind.Moved, 3), (flags[moved.ReviewId].Kind, flags[moved.ReviewId].LastRating!.Value));
        Assert.False(flags.ContainsKey(steady.ReviewId));
        Assert.All(generous.Take(3), g => Assert.Equal(CalibrationFlagKind.RatesHigh, flags[g.ReviewId].Kind));
        Assert.False(flags.ContainsKey(generous[3].ReviewId));
        Assert.All(others, o => Assert.False(flags.ContainsKey(o.ReviewId)));
    }

    [Fact]
    public async Task Release_sends_out_what_is_ready_and_the_rest_follows_as_each_becomes_ready()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var world = await SeedAsync(db, store, [new("Rim", "Omar"), new("Khaled", "Omar"), new("Elyes", "Mariam")], potential: false);
        var rim = world.Of("Rim");
        await PlanAsync(db, world, rim, ("Data platform move", 100m, 46m));
        await SubmitManagerAsync(db, rim, 5);
        await SubmitManagerAsync(db, world.Of("Khaled"), 3);

        // Rim is flagged against his goals; Khaled is ready as rated; Elyes is still being written.
        var read = (await ReadAsync(db, world)).Value;
        Assert.Equal((1, 1, 1), (read.ToLookAt.Count, read.Ready.Count, read.Writing.Count));
        var card = Assert.Single(read.Flagged);
        Assert.Equal(("Rim", "goals", 0.46m, 5), (card.Name, card.Flag.Kind, card.Flag.Grade!.Value, card.Rating));

        var released = (await ReleaseAsync(db, world)).Value;
        Assert.Equal(world.Of("Khaled").Id, Assert.Single(released.Finalized).ReviewId);
        Assert.Contains(released.Skipped, s => s.ReviewId == rim.Id && s.Reason.Contains("Flagged"));

        // Changing a rating needs a reason; once results are out, the decision goes out with it.
        Assert.True((await DecideAsync(db, world, rim, 4)).IsFailure);
        var decided = await DecideAsync(db, world, rim, 4, "Carried the move alone after two people left");
        Assert.True(decided.IsSuccess, decided.IsSuccess ? null : decided.Error.Message);
        Assert.True(decided.Value.Released);
        var rimNow = await db.PerformanceReviews.AsNoTracking().SingleAsync(r => r.Id == rim.Id);
        Assert.Equal((PerformanceReviewState.Finalized, 4, "Calibration"), (rimNow.State, rimNow.FinalRating!.Value, rimNow.FinalRatingSource));
        Assert.True(await db.OutboxMessages.AnyAsync(m => m.Kind == PerformanceNotificationKind.CalibrationDecided
            && m.RecipientEmployeeId == rim.ReviewerEmployeeId));

        // A manager review that arrives after release, with nothing to look at, goes out by itself.
        await SubmitManagerAsync(db, world.Of("Elyes"), 3);
        Assert.Equal(PerformanceReviewState.Finalized,
            (await db.PerformanceReviews.AsNoTracking().SingleAsync(r => r.Id == world.Of("Elyes").Id)).State);
    }

    [Fact]
    public async Task Kept_in_one_click_then_undone_the_review_waits_again()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var world = await SeedAsync(db, store, [new("Rim", "Omar"), new("Khaled", "Omar")], potential: false);
        var rim = world.Of("Rim");
        await PlanAsync(db, world, rim, ("Data platform move", 100m, 30m));
        await SubmitManagerAsync(db, rim, 5);

        var kept = await DecideAsync(db, world, rim, 5);
        Assert.True(kept.IsSuccess);
        Assert.Equal((true, false), (kept.Value.Decision!.Kept, kept.Value.Released));
        Assert.Equal(0, (await ReadAsync(db, world)).Value.ToLookAt.Count);

        var undone = await new UndoCalibrationDecisionHandler(db, new TestPerformanceAudit(db))
            .Handle(new(world.Round.Id, rim.Id, Hr, kept.Value.Version, true), default);
        Assert.True(undone.IsSuccess);
        Assert.Equal(1, (await ReadAsync(db, world)).Value.ToLookAt.Count);
    }
}
