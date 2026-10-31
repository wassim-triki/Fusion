using System.Text.Json;
using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>Who an invitation send reaches (D-11).</summary>
public enum InvitationAudience
{
    /// <summary>Everyone who doesn't sign in yet, resolved when it sends.</summary>
    NotSignedIn = 1,
    /// <summary>Of those, the people with someone reporting to them.</summary>
    Managers = 2,
    Chosen = 3,
}

/// <summary>
/// Invitations planned for a moment, so a company can go live on a Monday. The audience resolves when it sends,
/// so people added in between are included. Sent at most once: it is marked sent before anything goes out.
/// </summary>
public sealed class InvitationSchedule : BaseEntity, ITenantEntity
{
    public const int MaxChosen = 5000;

    private InvitationSchedule() { }

    public Guid TenantId { get; private set; }
    public InvitationAudience Audience { get; private set; }
    /// <summary>The chosen people's employee ids (JSON array); empty for the other audiences.</summary>
    public string EmployeeIdsJson { get; private set; } = "[]";
    public DateTime SendAt { get; private set; }
    public DateTime? SentAt { get; private set; }
    public DateTime? CanceledAt { get; private set; }
    public int? Invited { get; private set; }
    public int? NotSent { get; private set; }

    public IReadOnlyList<Guid> EmployeeIds => JsonSerializer.Deserialize<List<Guid>>(EmployeeIdsJson) ?? [];
    public bool IsPending => SentAt is null && CanceledAt is null;

    public static InvitationSchedule Plan(
        Guid tenantId, InvitationAudience audience, IReadOnlyCollection<Guid> employeeIds, DateTime sendAt, DateTime now, string? actor)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("A tenant is required.");
        if (!Enum.IsDefined(audience)) throw new ArgumentException("Choose who the invitations go to.");
        var at = DateTime.SpecifyKind(sendAt, DateTimeKind.Utc);
        if (at <= now) throw new ArgumentException("Choose a moment in the future, or send now.");
        if (at > now.AddYears(1)) throw new ArgumentException("Invitations can be planned up to a year ahead.");
        var ids = audience == InvitationAudience.Chosen ? employeeIds.Where(id => id != Guid.Empty).Distinct().ToList() : [];
        if (audience == InvitationAudience.Chosen && ids.Count == 0) throw new ArgumentException("Choose at least one person.");
        if (ids.Count > MaxChosen) throw new ArgumentException($"Choose at most {MaxChosen} people at once.");
        return new InvitationSchedule
        {
            TenantId = tenantId,
            Audience = audience,
            EmployeeIdsJson = JsonSerializer.Serialize(ids),
            SendAt = at,
            CreatedBy = actor,
        };
    }

    public void MarkSending(DateTime now)
    {
        if (!IsPending) throw new InvalidOperationException("These invitations were already sent or canceled.");
        SentAt = now;
        UpdatedAt = now;
    }

    public void Record(int invited, int notSent)
    {
        Invited = invited;
        NotSent = notSent;
    }

    public void Cancel(DateTime now, string? actor)
    {
        if (!IsPending) throw new InvalidOperationException("These invitations were already sent or canceled.");
        CanceledAt = now;
        UpdatedAt = now;
        UpdatedBy = actor;
    }
}

public enum InvitationAutoSendKind
{
    /// <summary>A joiner's invitation on their first day; keyed by the employment.</summary>
    FirstDay = 1,
    /// <summary>The one reminder an invitation gets; keyed by Identity's invitation id.</summary>
    Reminder = 2,
}

/// <summary>What Fusion sent on its own, so a first-day invitation or a reminder goes out once.</summary>
public sealed class InvitationAutoSend : ITenantEntity
{
    private InvitationAutoSend() { }

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public InvitationAutoSendKind Kind { get; private set; }
    public Guid Reference { get; private set; }
    public DateTime SentAt { get; private set; }

    public static InvitationAutoSend Record(Guid tenantId, Guid employeeId, InvitationAutoSendKind kind, Guid reference, DateTime now)
        => new() { TenantId = tenantId, EmployeeId = employeeId, Kind = kind, Reference = reference, SentAt = now };
}
