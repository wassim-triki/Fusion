using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Notifications;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.CoreHR.Tests.Features.Notifications;

/// <summary>Core HR's wording: every moment reads in English, French and Arabic, and its email says no more than the bell.</summary>
public sealed class CoreNotificationWordingTests
{
    private static readonly ChangePersonRef Nour = new(Guid.NewGuid(), "E1", "Nour Ben Salah");
    private static readonly ChangePersonRef Hana = new(Guid.NewGuid(), "E2", "Hana Trabelsi");
    private static readonly DateOnly Today = new(2026, 10, 29);

    public static IEnumerable<object[]> Moments()
    {
        yield return [new CoreChangeMoment(Nour.EmployeeId, CoreNotificationKind.ManagerChanged, Today.AddDays(33), [], Hana)];
        yield return [new CoreChangeMoment(Nour.EmployeeId, CoreNotificationKind.ManagerChanged, Today, [])];
        yield return [new CoreChangeMoment(Nour.EmployeeId, CoreNotificationKind.JobChanged, Today.AddDays(3), [], Hana, Summary: "Lead · Tunis")];
        yield return [new CoreChangeMoment(Hana.EmployeeId, CoreNotificationKind.TeamJoining, Today.AddDays(3), [Nour], HireTitle: "Analyst")];
        yield return [new CoreChangeMoment(Hana.EmployeeId, CoreNotificationKind.TeamJoining, Today, [Nour, Nour with { EmployeeId = Guid.NewGuid() }])];
        yield return [new CoreChangeMoment(Hana.EmployeeId, CoreNotificationKind.TeamLeaving, Today.AddDays(3), [Nour], LastDay: true)];
        yield return [new CoreChangeMoment(Hana.EmployeeId, CoreNotificationKind.TeamLeaving, Today.AddDays(3), [Nour])];
    }

    [Fact]
    public void Every_language_has_every_entry_with_the_same_placeholders()
    {
        var english = CoreNotificationRenderer.Catalog.Entries[FusionLanguages.Default];
        foreach (var language in FusionLanguages.Supported)
        {
            var entries = CoreNotificationRenderer.Catalog.Entries[language];
            Assert.Equal(english.Keys.Order(), entries.Keys.Order());
            foreach (var (key, text) in english)
                Assert.True(NotificationCatalog.PlaceholdersOf(text).SetEquals(NotificationCatalog.PlaceholdersOf(entries[key])), $"{language} {key}");
        }
    }

    [Theory]
    [MemberData(nameof(Moments))]
    public void Every_moment_reads_in_every_language_when_recorded_and_under_upcoming(CoreChangeMoment moment)
    {
        foreach (var tense in Enum.GetValues<CoreMomentTense>())
        {
            var words = CoreChangeMoments.Words(moment, tense, Today, "Amira Haddad");
            foreach (var language in FusionLanguages.Supported)
            {
                var title = CoreNotificationRenderer.Catalog.Text(language, words.TitleKey, words.Values);
                Assert.False(string.IsNullOrWhiteSpace(title), $"{language} {words.TitleKey}");
                Assert.DoesNotContain("{", title);
                if (words.ContextKey is not null)
                    Assert.DoesNotContain("{", CoreNotificationRenderer.Catalog.Text(language, words.ContextKey, words.Values));
            }
        }
    }

    [Fact]
    public void The_email_is_worded_in_the_recipients_language_with_a_link_that_turns_only_this_group_off()
    {
        var moment = new CoreChangeMoment(Nour.EmployeeId, CoreNotificationKind.ManagerChanged, Today.AddDays(33), [], Hana);
        var notification = CoreNotification.For(Guid.NewGuid(), Nour.EmployeeId, moment.Kind, Guid.NewGuid(),
            CoreChangeMoments.Words(moment, CoreMomentTense.Recorded, Today, "Amira Haddad"), DateTime.UtcNow);

        var email = CoreNotificationRenderer.Email(notification, FusionLanguages.French, "http://localhost:3000",
            new NotificationCompany("Asteria", "#2F5FD0", [0x89, 0x50, 0x4E, 0x47]));
        Assert.StartsWith("Hana Trabelsi sera votre responsable", email.Subject);
        // The company's brand, as on its invitations (B-204): logo and name on top, its colour on the button, its sign-off.
        Assert.Contains("cid:" + FusionNotificationEmail.LogoContentId, email.Html);
        Assert.Contains("#2f5fd0", email.Html);
        Assert.Contains("Envoyé par Asteria avec Fusion", email.Text);
        Assert.Equal(FusionNotificationEmail.LogoContentId, Assert.Single(email.Images).ContentId);
        Assert.Contains("http://localhost:3000/core/profile", email.Html);
        Assert.Contains("Équipe et changements de poste", email.Text);

        var link = CoreNotificationRenderer.UnsubscribeUrl(notification, "http://localhost:3000", "test-unsubscribe-key-of-at-least-32-characters");
        Assert.StartsWith("http://localhost:3000/api/corehr/notifications/unsubscribe?token=", link);
        var claim = UnsubscribeToken.Read(Uri.UnescapeDataString(link![(link.IndexOf('=') + 1)..]), "test-unsubscribe-key-of-at-least-32-characters");
        Assert.Equal((notification.TenantId, Nour.EmployeeId, CoreNotificationPreference.TeamAndJobChanges),
            (claim!.TenantId, claim.RecipientEmployeeId, claim.Group));
        Assert.Null(CoreNotificationRenderer.UnsubscribeUrl(notification, "http://localhost:3000", null));
    }

    [Fact]
    public void A_notification_only_opens_inside_Core_HR()
        => Assert.Throws<ArgumentException>(() => CoreNotification.For(Guid.NewGuid(), Guid.NewGuid(), CoreNotificationKind.JobChanged,
            Guid.NewGuid(), new CoreNotificationMessage("JobChanged", null, new Dictionary<string, string>(), null, "https://evil.test"), DateTime.UtcNow));
}
