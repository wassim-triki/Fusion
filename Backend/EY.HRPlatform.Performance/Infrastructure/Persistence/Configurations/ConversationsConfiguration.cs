using EY.HRPlatform.Performance.Domain.Conversations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class OneOnOneSeriesConfiguration : IEntityTypeConfiguration<OneOnOneSeries>
{
    public void Configure(EntityTypeBuilder<OneOnOneSeries> builder)
    {
        builder.ToTable("OneOnOneSeries");
        builder.HasKey(series => series.Id);
        builder.Property(series => series.Version).IsRowVersion();
        builder.Property(series => series.Cadence).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(series => series.ManagerName).IsRequired().HasMaxLength(200);
        builder.Property(series => series.ReportName).IsRequired().HasMaxLength(200);
        builder.Property(series => series.EndReason).HasConversion<string>().HasMaxLength(30);

        builder.HasIndex(series => new { series.TenantId, series.ManagerEmployeeId });
        builder.HasIndex(series => new { series.TenantId, series.ReportEmployeeId });
        // One active series per manager and report (D-12); an ended one never blocks a new start.
        builder.HasIndex(series => new { series.TenantId, series.ManagerEmployeeId, series.ReportEmployeeId })
            .IsUnique()
            .HasFilter("\"EndedAt\" IS NULL")
            .HasDatabaseName("IX_OneOnOneSeries_ActivePair");

        builder.HasMany(series => series.Actions)
            .WithOne()
            .HasForeignKey(action => action.SeriesId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(series => series.Actions).AutoInclude();
    }
}

public sealed class OneOnOneActionItemConfiguration : IEntityTypeConfiguration<OneOnOneActionItem>
{
    public void Configure(EntityTypeBuilder<OneOnOneActionItem> builder)
    {
        builder.ToTable("OneOnOneActionItems");
        builder.HasKey(action => action.Id);
        builder.Property(action => action.Id).ValueGeneratedNever();
        builder.Property(action => action.Text).IsRequired().HasMaxLength(OneOnOneActionItem.MaxTextLength);
        builder.HasIndex(action => action.SeriesId);
        builder.HasIndex(action => new { action.TenantId, action.OwnerEmployeeId });
    }
}

public sealed class OneOnOneMeetingConfiguration : IEntityTypeConfiguration<OneOnOneMeeting>
{
    public void Configure(EntityTypeBuilder<OneOnOneMeeting> builder)
    {
        builder.ToTable("OneOnOneMeetings");
        builder.HasKey(meeting => meeting.Id);
        builder.Property(meeting => meeting.Version).IsRowVersion();
        builder.Property(meeting => meeting.State).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.HasIndex(meeting => new { meeting.SeriesId, meeting.ScheduledAt });
        builder.HasIndex(meeting => meeting.TenantId);
        builder.HasOne<OneOnOneSeries>().WithMany().HasForeignKey(meeting => meeting.SeriesId).OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(meeting => meeting.Agenda)
            .WithOne()
            .HasForeignKey(item => item.MeetingId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(meeting => meeting.Agenda).AutoInclude();
    }
}

public sealed class OneOnOneAgendaItemConfiguration : IEntityTypeConfiguration<OneOnOneAgendaItem>
{
    public void Configure(EntityTypeBuilder<OneOnOneAgendaItem> builder)
    {
        builder.ToTable("OneOnOneAgendaItems");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Id).ValueGeneratedNever();
        builder.Property(item => item.Text).IsRequired().HasMaxLength(OneOnOneAgendaItem.MaxTextLength);
        builder.Property(item => item.SourceKind).HasConversion<string>().HasMaxLength(20);
        builder.Property(item => item.Note).IsRequired().HasMaxLength(OneOnOneMeeting.MaxNotesLength);
        builder.HasIndex(item => item.MeetingId);
    }
}

/// <summary>One feed per person; the token's hash finds it, within the tenant the token names.</summary>
public sealed class CalendarFeedConfiguration : IEntityTypeConfiguration<CalendarFeed>
{
    public void Configure(EntityTypeBuilder<CalendarFeed> builder)
    {
        builder.ToTable("CalendarFeeds");
        builder.HasKey(feed => feed.Id);
        builder.Property(feed => feed.TokenHash).IsRequired().HasMaxLength(64);
        builder.HasIndex(feed => new { feed.TenantId, feed.EmployeeId }).IsUnique();
        builder.HasIndex(feed => feed.TokenHash).IsUnique();
    }
}

/// <summary>No navigation from the meeting: private notes are only ever loaded by a query filtered to their author.</summary>
public sealed class OneOnOnePrivateNoteConfiguration : IEntityTypeConfiguration<OneOnOnePrivateNote>
{
    public void Configure(EntityTypeBuilder<OneOnOnePrivateNote> builder)
    {
        builder.ToTable("OneOnOnePrivateNotes");
        builder.HasKey(note => note.Id);
        builder.Property(note => note.Text).IsRequired().HasMaxLength(OneOnOneMeeting.MaxNotesLength);
        builder.HasIndex(note => new { note.MeetingId, note.AuthorEmployeeId }).IsUnique();
        builder.HasOne<OneOnOneMeeting>().WithMany().HasForeignKey(note => note.MeetingId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class FeedbackConfiguration : IEntityTypeConfiguration<Feedback>
{
    public void Configure(EntityTypeBuilder<Feedback> builder)
    {
        builder.ToTable("Feedback");
        builder.HasKey(feedback => feedback.Id);
        builder.Property(feedback => feedback.Id).ValueGeneratedNever();
        builder.Property(feedback => feedback.Version).IsRowVersion();
        builder.Property(feedback => feedback.AuthorName).IsRequired().HasMaxLength(200);
        builder.Property(feedback => feedback.ReceiverName).IsRequired().HasMaxLength(200);
        builder.Property(feedback => feedback.AddressedManagerName).HasMaxLength(200);
        builder.Property(feedback => feedback.Visibility).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(feedback => feedback.SubjectKind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(feedback => feedback.ObjectiveTitle).HasMaxLength(300);
        builder.Property(feedback => feedback.Message).IsRequired().HasMaxLength(Feedback.MaxMessageLength);
        builder.Ignore(feedback => feedback.Subject);

        builder.HasIndex(feedback => new { feedback.TenantId, feedback.ReceiverEmployeeId, feedback.SentAt });
        builder.HasIndex(feedback => new { feedback.TenantId, feedback.AuthorEmployeeId, feedback.SentAt });
        builder.HasIndex(feedback => new { feedback.TenantId, feedback.AddressedManagerEmployeeId });
        builder.HasIndex(feedback => new { feedback.TenantId, feedback.ObjectiveId });
        builder.HasIndex(feedback => feedback.RequestId);
    }
}

public sealed class FeedbackRequestConfiguration : IEntityTypeConfiguration<FeedbackRequest>
{
    public void Configure(EntityTypeBuilder<FeedbackRequest> builder)
    {
        builder.ToTable("FeedbackRequests");
        builder.HasKey(request => request.Id);
        builder.Property(request => request.Id).ValueGeneratedNever();
        builder.Property(request => request.Version).IsRowVersion();
        builder.Property(request => request.RequesterName).IsRequired().HasMaxLength(200);
        builder.Property(request => request.Question).IsRequired().HasMaxLength(FeedbackRequest.MaxQuestionLength);
        builder.Property(request => request.SubjectKind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(request => request.ObjectiveTitle).HasMaxLength(300);
        builder.Property(request => request.State).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(request => request.CloseReason).HasConversion<string>().HasMaxLength(30);
        builder.Ignore(request => request.Subject);
        builder.HasIndex(request => new { request.TenantId, request.RequesterEmployeeId, request.RequestedAt });

        builder.HasMany(request => request.Invitees)
            .WithOne()
            .HasForeignKey(invitee => invitee.RequestId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(request => request.Invitees).AutoInclude();
    }
}

public sealed class FeedbackRequestInviteeConfiguration : IEntityTypeConfiguration<FeedbackRequestInvitee>
{
    public void Configure(EntityTypeBuilder<FeedbackRequestInvitee> builder)
    {
        builder.ToTable("FeedbackRequestInvitees");
        builder.HasKey(invitee => invitee.Id);
        builder.Property(invitee => invitee.Name).IsRequired().HasMaxLength(200);
        builder.Property(invitee => invitee.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(invitee => invitee.DeclineReason).HasMaxLength(FeedbackRequest.MaxDeclineReasonLength);
        builder.HasIndex(invitee => new { invitee.RequestId, invitee.EmployeeId }).IsUnique();
        builder.HasIndex(invitee => new { invitee.TenantId, invitee.EmployeeId, invitee.Status });
    }
}

public sealed class PraiseConfiguration : IEntityTypeConfiguration<Praise>
{
    public void Configure(EntityTypeBuilder<Praise> builder)
    {
        builder.ToTable("Praise");
        builder.HasKey(praise => praise.Id);
        builder.Property(praise => praise.Id).ValueGeneratedNever();
        builder.Property(praise => praise.Version).IsRowVersion();
        builder.Property(praise => praise.AuthorName).IsRequired().HasMaxLength(200);
        builder.Property(praise => praise.Message).IsRequired().HasMaxLength(Praise.MaxMessageLength);
        builder.Property(praise => praise.DeletedByRole).HasConversion<string>().HasMaxLength(20);
        builder.HasIndex(praise => new { praise.TenantId, praise.GivenAt });
        builder.HasIndex(praise => new { praise.TenantId, praise.AuthorEmployeeId });

        builder.HasMany(praise => praise.Recipients)
            .WithOne()
            .HasForeignKey(recipient => recipient.PraiseId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(praise => praise.Recipients).AutoInclude();
    }
}

public sealed class PraiseRecipientConfiguration : IEntityTypeConfiguration<PraiseRecipient>
{
    public void Configure(EntityTypeBuilder<PraiseRecipient> builder)
    {
        builder.ToTable("PraiseRecipients");
        builder.HasKey(recipient => recipient.Id);
        builder.Property(recipient => recipient.Name).IsRequired().HasMaxLength(200);
        builder.HasIndex(recipient => new { recipient.PraiseId, recipient.EmployeeId }).IsUnique();
        builder.HasIndex(recipient => new { recipient.TenantId, recipient.EmployeeId });
    }
}

public sealed class PraiseReactionConfiguration : IEntityTypeConfiguration<PraiseReaction>
{
    public void Configure(EntityTypeBuilder<PraiseReaction> builder)
    {
        builder.ToTable("PraiseReactions");
        builder.HasKey(reaction => reaction.Id);
        builder.Property(reaction => reaction.Kind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.HasIndex(reaction => new { reaction.PraiseId, reaction.ReactorEmployeeId, reaction.Kind }).IsUnique();
        builder.HasOne<Praise>().WithMany().HasForeignKey(reaction => reaction.PraiseId).OnDelete(DeleteBehavior.Cascade);
    }
}
