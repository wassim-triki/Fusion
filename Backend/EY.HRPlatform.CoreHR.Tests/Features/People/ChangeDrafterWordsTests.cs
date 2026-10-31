using EY.HRPlatform.CoreHR.Features.People.Changes;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>The drafter without AI (B-224): the cases the scored sentence set found it missing.</summary>
public sealed class ChangeDrafterWordsTests
{
    private static readonly DateOnly Today = new(2026, 10, 31);

    [Theory]
    [InlineData("Aicha is retiring at the end of the year")]
    [InlineData("Aicha's contract ends on 31 December")]
    [InlineData("Fin de contrat le 31 decembre")]
    [InlineData("She's resigning, her last day is 30 November")]
    public void A_retirement_a_contract_that_ends_or_a_last_day_reads_as_leaving(string sentence)
        => Assert.True(ChangeDrafter.ReadsAsLeaving(ChangeDrafter.Fold(sentence)));

    [Theory]
    [InlineData("Promote Aicha to Senior Consultant from 1 January")]
    [InlineData("Aicha moves to Engineering A Core")]
    public void A_job_or_unit_change_does_not_read_as_leaving(string sentence)
        => Assert.False(ChangeDrafter.ReadsAsLeaving(ChangeDrafter.Fold(sentence)));

    [Fact]
    public void The_end_of_the_year_is_its_last_day()
        => Assert.Equal(new DateOnly(2026, 12, 31), ChangeDrafter.ReadDate(ChangeDrafter.Fold("Aicha is retiring at the end of the year"), Today));

    [Fact]
    public void A_word_sharing_the_stem_of_a_name_finds_it()
    {
        var remote = Guid.NewGuid();
        var places = new[] { (Guid.NewGuid(), "Tunis"), (remote, "Remote - Tunisia") };
        Assert.Equal(remote, ChangeDrafter.ByStem(places, ChangeDrafter.Fold("Aicha will work remotely from 1 December")));
        Assert.Null(ChangeDrafter.ByStem(places, ChangeDrafter.Fold("Promote Aicha")));
    }
}
