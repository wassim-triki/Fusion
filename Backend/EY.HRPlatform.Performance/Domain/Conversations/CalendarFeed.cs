using System.Security.Cryptography;
using System.Text;
using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Conversations;

/// <summary>
/// A person's calendar feed link for their 1:1s (D-39): one per person, revocable, replaced by a new link. Only the
/// token's hash is stored, so the link is shown once, when it's made.
/// </summary>
public sealed class CalendarFeed : PerformanceChildEntity
{
    private CalendarFeed() { }

    public Guid EmployeeId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;

    /// <summary>A new feed and its token: the tenant in clear (to scope the lookup), then 32 random bytes.</summary>
    public static (CalendarFeed Feed, string Token) Create(Guid tenantId, Guid employeeId)
    {
        if (tenantId == Guid.Empty || employeeId == Guid.Empty) throw new ArgumentException("A feed belongs to one person.");
        var token = $"{tenantId:N}.{Base64Url(RandomNumberGenerator.GetBytes(32))}";
        return (new CalendarFeed { TenantId = tenantId, EmployeeId = employeeId, TokenHash = Hash(token) }, token);
    }

    /// <summary>The tenant a token names, when it's shaped like one; the lookup by hash decides if it's real.</summary>
    public static Guid? TenantOf(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 100) return null;
        var dot = token.IndexOf('.');
        return dot == 32 && Guid.TryParseExact(token[..dot], "N", out var tenant) && tenant != Guid.Empty && token.Length > 33 ? tenant : null;
    }

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>One 1:1 meeting as a calendar event: what a feed lists and an invite carries. No notes or agenda.</summary>
public sealed record CalendarEvent(Guid MeetingId, DateTime StartsAt, DateTime EndsAt, string Title, string Url, int Sequence, bool Cancelled);

/// <summary>Writes iCalendar (RFC 5545): a feed of events, or an invite (REQUEST) or cancellation (CANCEL) of one.</summary>
public static class ICalendar
{
    public static string Feed(string name, IEnumerable<CalendarEvent> events)
    {
        var lines = Head("PUBLISH");
        lines.Add($"X-WR-CALNAME:{Escape(name)}");
        foreach (var e in events.Where(e => !e.Cancelled)) lines.AddRange(Event(e, organizer: null));
        lines.Add("END:VCALENDAR");
        return Fold(lines);
    }

    public static string Invite(CalendarEvent e, string organizer)
    {
        var lines = Head(e.Cancelled ? "CANCEL" : "REQUEST");
        lines.AddRange(Event(e, organizer));
        lines.Add("END:VCALENDAR");
        return Fold(lines);
    }

    private static List<string> Head(string method) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fusion//Performance//EN", "CALSCALE:GREGORIAN", $"METHOD:{method}"];

    private static IEnumerable<string> Event(CalendarEvent e, string? organizer)
    {
        yield return "BEGIN:VEVENT";
        yield return $"UID:{e.MeetingId:N}@fusion-performance";
        yield return $"DTSTAMP:{Stamp(DateTime.UtcNow)}";
        yield return $"DTSTART:{Stamp(e.StartsAt)}";
        yield return $"DTEND:{Stamp(e.EndsAt)}";
        yield return $"SEQUENCE:{e.Sequence}";
        yield return $"SUMMARY:{Escape(e.Title)}";
        yield return $"URL:{e.Url}";
        yield return $"DESCRIPTION:{Escape(e.Url)}";
        if (organizer is not null) yield return $"ORGANIZER;CN=Fusion:mailto:{organizer}";
        yield return $"STATUS:{(e.Cancelled ? "CANCELLED" : "CONFIRMED")}";
        yield return "END:VEVENT";
    }

    private static string Stamp(DateTime at) => DateTime.SpecifyKind(at, DateTimeKind.Utc).ToString("yyyyMMdd'T'HHmmss'Z'");

    private static string Escape(string value)
        => value.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r", "").Replace("\n", "\\n");

    /// <summary>Lines longer than 75 octets fold onto continuation lines; every line ends in CRLF.</summary>
    private static string Fold(IEnumerable<string> lines)
    {
        var sb = new StringBuilder();
        foreach (var line in lines)
        {
            var rest = line;
            var first = true;
            while (Encoding.UTF8.GetByteCount(rest) > (first ? 75 : 74))
            {
                var take = first ? 75 : 74;
                var cut = 0;
                while (cut < rest.Length && Encoding.UTF8.GetByteCount(rest[..(cut + 1)]) <= take) cut++;
                if (cut > 0 && char.IsHighSurrogate(rest[cut - 1])) cut--;
                sb.Append(first ? "" : " ").Append(rest[..cut]).Append("\r\n");
                rest = rest[cut..];
                first = false;
            }
            sb.Append(first ? "" : " ").Append(rest).Append("\r\n");
        }
        return sb.ToString();
    }
}
