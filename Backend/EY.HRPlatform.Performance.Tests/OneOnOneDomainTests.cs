using EY.HRPlatform.Performance.Domain.Conversations;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>D-12: Karim and Nour's 1:1 series, its meetings, agenda, notes and carried action items.</summary>
public sealed class OneOnOneDomainTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid Karim = Guid.NewGuid();
    private static readonly Guid Nour = Guid.NewGuid();
    // Tuesday 20 October 2026, 10:00 UTC.
    private static readonly DateTime Tuesday = new(2026, 10, 20, 10, 0, 0, DateTimeKind.Utc);

    private static (OneOnOneSeries Series, OneOnOneMeeting Meeting) Start(OneOnOneCadence cadence = OneOnOneCadence.Weekly, DateTime? at = null)
        => OneOnOneSeries.Start(Tenant, Karim, Nour, cadence, Nour, at ?? Tuesday, Tuesday.AddHours(-2));

    [Fact]
    public void Starting_creates_one_upcoming_meeting_at_the_chosen_time()
    {
        var (series, meeting) = Start();
        Assert.True(series.IsActive);
        Assert.Equal(Nour, series.StartedByEmployeeId);
        Assert.Equal(OneOnOneMeetingState.Upcoming, meeting.State);
        Assert.Equal(Tuesday, meeting.ScheduledAt);
        Assert.Equal(series.Id, meeting.SeriesId);
    }

    [Theory]
    [InlineData(-25)]
    [InlineData(24 * 366)]
    public void Meeting_times_stay_within_a_day_back_and_a_year_ahead(int hoursFromNow)
    {
        var now = Tuesday;
        Assert.Throws<ArgumentException>(() => OneOnOneSeries.Start(Tenant, Karim, Nour, OneOnOneCadence.Weekly, Karim, now.AddHours(hoursFromNow), now));
        var (_, meeting) = OneOnOneSeries.Start(Tenant, Karim, Nour, OneOnOneCadence.Weekly, Karim, now.AddHours(-23), now);
        Assert.Throws<ArgumentException>(() => meeting.Reschedule(now.AddHours(hoursFromNow), now));
    }

    [Fact]
    public void Only_the_pair_starts_and_a_person_cant_meet_themselves()
    {
        Assert.Throws<ArgumentException>(() => OneOnOneSeries.Start(Tenant, Karim, Nour, OneOnOneCadence.Weekly, Guid.NewGuid(), Tuesday, Tuesday));
        Assert.Throws<ArgumentException>(() => OneOnOneSeries.Start(Tenant, Karim, Karim, OneOnOneCadence.Weekly, Karim, Tuesday, Tuesday));
        Assert.Throws<ArgumentException>(() => OneOnOneSeries.Start(Tenant, Karim, Nour, (OneOnOneCadence)9, Karim, Tuesday, Tuesday));
    }

    [Theory]
    [InlineData(OneOnOneCadence.Weekly, 7)]
    [InlineData(OneOnOneCadence.EveryTwoWeeks, 14)]
    public void Completing_on_time_schedules_one_cadence_later(OneOnOneCadence cadence, int days)
    {
        var (series, meeting) = Start(cadence);
        var next = meeting.Complete(series, Karim, Tuesday.AddHours(1))!;
        Assert.Equal(OneOnOneMeetingState.Completed, meeting.State);
        Assert.Equal(Tuesday.AddDays(days), next.ScheduledAt);
        Assert.Equal(next.Id, meeting.NextMeetingId);
    }

    [Fact]
    public void Monthly_keeps_the_day_of_month()
    {
        var (series, meeting) = Start(OneOnOneCadence.Monthly);
        var next = meeting.Complete(series, Karim, Tuesday.AddHours(1))!;
        Assert.Equal(new DateTime(2026, 11, 20, 10, 0, 0, DateTimeKind.Utc), next.ScheduledAt);
    }

    [Fact]
    public void Late_completion_lands_on_the_next_future_step_keeping_weekday_and_time()
    {
        var (series, meeting) = Start();
        var lateWednesday = Tuesday.AddDays(8);
        var next = meeting.Complete(series, Karim, lateWednesday)!;
        Assert.Equal(Tuesday.AddDays(14), next.ScheduledAt);
        Assert.Equal(DayOfWeek.Tuesday, next.ScheduledAt.DayOfWeek);
        Assert.True(next.ScheduledAt > lateWednesday);
    }

    [Fact]
    public void Completing_again_returns_nothing_new()
    {
        var (series, meeting) = Start();
        Assert.NotNull(meeting.Complete(series, Karim, Tuesday));
        Assert.Null(meeting.Complete(series, Nour, Tuesday.AddMinutes(5)));
    }

    [Fact]
    public void Cadence_changes_apply_to_the_next_meeting_created()
    {
        var (series, meeting) = Start();
        Assert.True(series.ChangeCadence(OneOnOneCadence.Monthly));
        Assert.False(series.ChangeCadence(OneOnOneCadence.Monthly));
        Assert.Equal(Tuesday, meeting.ScheduledAt);
        Assert.Equal(Tuesday.AddMonths(1), meeting.Complete(series, Karim, Tuesday)!.ScheduledAt);
    }

    [Fact]
    public void Agenda_items_are_removed_only_by_their_author_and_only_while_upcoming()
    {
        var (series, meeting) = Start();
        var nours = meeting.AddAgendaItem(Guid.NewGuid(), "Vendor API timeline", Nour, null, out var added);
        Assert.True(added);
        Assert.Same(nours, meeting.AddAgendaItem(nours.Id, "Vendor API timeline", Nour, null, out var retried));
        Assert.False(retried);
        Assert.Throws<UnauthorizedAccessException>(() => meeting.RemoveAgendaItem(nours.Id, Karim));

        meeting.Complete(series, Karim, Tuesday);
        Assert.Throws<InvalidOperationException>(() => meeting.RemoveAgendaItem(nours.Id, Nour));
        Assert.Throws<InvalidOperationException>(() => meeting.AddAgendaItem(Guid.NewGuid(), "Late item", Nour, null, out _));
        Assert.Throws<ArgumentException>(() => Start().Meeting.AddAgendaItem(Guid.NewGuid(), new string('x', 201), Nour, null, out _));
    }

    [Fact]
    public void A_source_goes_on_the_agenda_once()
    {
        var (_, meeting) = Start();
        var source = new AgendaSource(AgendaSourceKind.Objective, Guid.NewGuid(), Guid.NewGuid());
        meeting.AddAgendaItem(Guid.NewGuid(), "Vendor API integration · At risk", Karim, source, out _);
        Assert.Throws<InvalidOperationException>(() => meeting.AddAgendaItem(Guid.NewGuid(), "Again", Nour, source, out _));
    }

    [Fact]
    public void A_note_marks_an_item_talked_about_guards_its_revision_and_locks_after_the_successor_completes()
    {
        var (series, meeting) = Start();
        var item = meeting.AddAgendaItem(Guid.NewGuid(), "Vendor timeline", Nour, null, out _);
        Assert.True(meeting.SetItemNote(item.Id, "Agreed the timeline.", 0, successorCompleted: false, Tuesday));
        Assert.True(item.HasNote);
        Assert.Throws<OneOnOneNotesConflictException>(() => meeting.SetItemNote(item.Id, "Other text", 0, successorCompleted: false, Tuesday));
        // Clearing the note un-marks it.
        meeting.SetItemNote(item.Id, "  ", 1, successorCompleted: false, Tuesday);
        Assert.False(item.HasNote);

        var next = meeting.Complete(series, null, Tuesday)!;
        Assert.Null(meeting.CompletedByEmployeeId);
        Assert.True(meeting.SetItemNote(item.Id, "Agreed after all.", 2, successorCompleted: false, Tuesday));
        Assert.Throws<InvalidOperationException>(() => meeting.SetItemNote(item.Id, "Too late", 3, successorCompleted: true, Tuesday));
        Assert.Throws<ArgumentException>(() => meeting.SetItemNote(item.Id, new string('x', 10_001), 3, successorCompleted: false, Tuesday));
    }

    [Fact]
    public void Completing_carries_what_has_no_note_and_a_late_note_drops_the_copy()
    {
        var (series, meeting) = Start();
        var talked = meeting.AddAgendaItem(Guid.NewGuid(), "Vendor timeline", Nour, null, out _);
        var open = meeting.AddAgendaItem(Guid.NewGuid(), "Training budget", Karim, new AgendaSource(AgendaSourceKind.Objective, Guid.NewGuid(), null), out _);
        meeting.SetItemNote(talked.Id, "Agreed.", 0, successorCompleted: false, Tuesday);

        var next = meeting.Complete(series, null, Tuesday)!;
        var copy = Assert.Single(next.Agenda);
        Assert.Equal("Training budget", copy.Text);
        Assert.Equal(open.Id, copy.CarriedFromItemId);
        Assert.Equal(Karim, copy.AuthorEmployeeId);
        Assert.Equal(open.SourceId, copy.SourceId);
        Assert.Equal(open.FirstAddedAt, copy.FirstAddedAt);

        Assert.True(next.DropCarriedCopy(open.Id));
        Assert.Empty(next.Agenda);
        Assert.False(next.DropCarriedCopy(open.Id));
    }

    [Fact]
    public void Private_notes_guard_their_own_revision()
    {
        var (_, meeting) = Start();
        var note = OneOnOnePrivateNote.Create(Tenant, meeting.Id, Karim);
        Assert.True(note.Set("Ask about workload", 0));
        Assert.Throws<OneOnOneNotesConflictException>(() => note.Set("Other", 0));
        Assert.Equal(1u, note.Revision);
    }

    [Fact]
    public void Actions_belong_to_the_pair_carry_over_and_record_where_they_were_done()
    {
        var (series, first) = Start();
        var action = series.AddAction(Guid.NewGuid(), "Send the vendor draft", Nour, new DateOnly(2026, 10, 23), first.Id, Karim, out _);
        Assert.Throws<ArgumentException>(() => series.AddAction(Guid.NewGuid(), "Someone else", Guid.NewGuid(), null, first.Id, Karim, out _));

        var second = first.Complete(series, Karim, Tuesday)!;
        Assert.Contains(action, series.OpenActionItems());
        Assert.Equal(first.Id, action.CreatedInMeetingId);

        Assert.True(series.SetActionDone(action.Id, true, second.Id, Tuesday.AddDays(7)));
        Assert.False(series.SetActionDone(action.Id, true, second.Id, Tuesday.AddDays(7)));
        Assert.Empty(series.OpenActionItems());
        Assert.Equal(second.Id, action.DoneInMeetingId);

        Assert.True(series.SetActionDone(action.Id, false, second.Id, Tuesday.AddDays(7)));
        Assert.Null(action.DoneInMeetingId);
    }

    [Fact]
    public void An_agenda_holds_a_bounded_number_of_items()
    {
        var (_, meeting) = Start();
        var first = meeting.AddAgendaItem(Guid.NewGuid(), "Item 1", Nour, null, out _);
        for (var i = 2; i <= OneOnOneMeeting.MaxAgendaItems; i++) meeting.AddAgendaItem(Guid.NewGuid(), $"Item {i}", Nour, null, out _);

        Assert.Throws<ArgumentException>(() => meeting.AddAgendaItem(Guid.NewGuid(), "One more", Karim, null, out _));
        Assert.Same(first, meeting.AddAgendaItem(first.Id, "Item 1", Nour, null, out var added));
        Assert.False(added);

        Assert.True(meeting.RemoveAgendaItem(first.Id, Nour));
        meeting.AddAgendaItem(Guid.NewGuid(), "One more", Karim, null, out added);
        Assert.True(added);
    }

    [Fact]
    public void A_series_holds_a_bounded_number_of_open_actions_and_a_reopen_counts()
    {
        var (series, meeting) = Start();
        var first = series.AddAction(Guid.NewGuid(), "Action 1", Nour, null, meeting.Id, Karim, out _);
        for (var i = 2; i <= OneOnOneSeries.MaxOpenActions; i++) series.AddAction(Guid.NewGuid(), $"Action {i}", Nour, null, meeting.Id, Karim, out _);

        Assert.Throws<ArgumentException>(() => series.AddAction(Guid.NewGuid(), "One more", Karim, null, meeting.Id, Nour, out _));
        Assert.Same(first, series.AddAction(first.Id, "Action 1", Nour, null, meeting.Id, Karim, out var added));
        Assert.False(added);

        series.SetActionDone(first.Id, true, meeting.Id, Tuesday);
        series.AddAction(Guid.NewGuid(), "One more", Karim, null, meeting.Id, Nour, out added);
        Assert.True(added);
        Assert.Throws<ArgumentException>(() => series.SetActionDone(first.Id, false, meeting.Id, Tuesday));
        Assert.False(series.SetActionDone(first.Id, true, meeting.Id, Tuesday));
    }

    [Fact]
    public void An_ended_series_rejects_writes_and_its_upcoming_meeting_is_not_held()
    {
        var (series, meeting) = Start();
        Assert.True(series.End(OneOnOneEndReason.ReportingLineEnded, Tuesday));
        Assert.False(series.End(OneOnOneEndReason.PersonInactive, Tuesday));
        meeting.MarkNotHeld();
        Assert.Equal(OneOnOneMeetingState.NotHeld, meeting.State);
        Assert.Throws<InvalidOperationException>(() => series.ChangeCadence(OneOnOneCadence.Monthly));
        Assert.Throws<InvalidOperationException>(() => series.AddAction(Guid.NewGuid(), "Late", Nour, null, meeting.Id, Karim, out _));
        Assert.Throws<InvalidOperationException>(() => meeting.Complete(series, Karim, Tuesday));
    }
}
