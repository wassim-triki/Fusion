using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Conversations;

public enum PraiseReactionKind { Applause = 0, Celebrate = 1, Insightful = 2, ThankYou = 3 }
public enum PraiseDeletedBy { Author = 0, Administrator = 1 }

/// <summary>
/// Public recognition for one or more colleagues, tagged with one of the company's values (D-36). Everyone with Performance
/// access reads it. Its text never changes; the author or an administrator can delete it, which hides it everywhere
/// while the row stays for the audit and the notifications that point at it.
/// </summary>
public sealed class Praise : PerformanceAggregate
{
    public const int MaxRecipients = 10;
    public const int MaxMessageLength = 500;

    private readonly List<PraiseRecipient> _recipients = [];

    private Praise() { }

    public Guid AuthorEmployeeId { get; private set; }
    public string AuthorName { get; private set; } = string.Empty;
    public Guid ValueId { get; private set; }
    public string Message { get; private set; } = string.Empty;
    public DateTime GivenAt { get; private set; }
    public DateTime? DeletedAt { get; private set; }
    public Guid? DeletedByEmployeeId { get; private set; }
    public PraiseDeletedBy? DeletedByRole { get; private set; }

    public IReadOnlyList<PraiseRecipient> Recipients => _recipients;
    public bool IsDeleted => DeletedAt is not null;

    public static Praise Give(Guid id, Guid tenantId, Guid authorEmployeeId, string authorName, Guid valueId, string message,
        IReadOnlyList<(Guid EmployeeId, string Name)> recipients, DateTime now)
    {
        if (id == Guid.Empty) throw new ArgumentException("Praise needs an id.", nameof(id));
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (authorEmployeeId == Guid.Empty) throw new ArgumentException("Praise has an author.", nameof(authorEmployeeId));
        if (valueId == Guid.Empty) throw new ArgumentException("Choose a value.", nameof(valueId));
        var text = message?.Trim() ?? string.Empty;
        if (text.Length == 0) throw new ArgumentException("Write what they did.", nameof(message));
        if (text.Length > MaxMessageLength) throw new ArgumentException($"Keep praise to {MaxMessageLength} characters.", nameof(message));
        var people = (recipients ?? []).Where(r => r.EmployeeId != Guid.Empty).DistinctBy(r => r.EmployeeId).ToList();
        if (people.Count == 0 || people.Count > MaxRecipients) throw new ArgumentException($"Praise 1 to {MaxRecipients} people.", nameof(recipients));
        if (people.Any(p => p.EmployeeId == authorEmployeeId)) throw new ArgumentException("Praise someone other than yourself.", nameof(recipients));

        var praise = new Praise
        {
            Id = id, TenantId = tenantId, AuthorEmployeeId = authorEmployeeId, AuthorName = authorName,
            ValueId = valueId, Message = text, GivenAt = now,
        };
        foreach (var person in people) praise._recipients.Add(PraiseRecipient.Create(tenantId, praise.Id, person.EmployeeId, person.Name));
        return praise;
    }

    /// <summary>Deletes for moderation. False when it was already deleted.</summary>
    public bool Delete(Guid actorEmployeeId, PraiseDeletedBy role, DateTime now)
    {
        if (DeletedAt is not null) return false;
        DeletedAt = now;
        DeletedByEmployeeId = actorEmployeeId == Guid.Empty ? null : actorEmployeeId;
        DeletedByRole = role;
        MarkUpdated();
        return true;
    }
}

public sealed class PraiseRecipient : PerformanceChildEntity
{
    private PraiseRecipient() { }

    public Guid PraiseId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public string Name { get; private set; } = string.Empty;

    internal static PraiseRecipient Create(Guid tenantId, Guid praiseId, Guid employeeId, string name)
        => new() { TenantId = tenantId, PraiseId = praiseId, EmployeeId = employeeId, Name = name };
}

/// <summary>One person's reaction of one kind; at most one per person, kind and praise.</summary>
public sealed class PraiseReaction : PerformanceChildEntity
{
    private PraiseReaction() { }

    public Guid PraiseId { get; private set; }
    public Guid ReactorEmployeeId { get; private set; }
    public PraiseReactionKind Kind { get; private set; }

    public static PraiseReaction Create(Guid tenantId, Guid praiseId, Guid reactorEmployeeId, PraiseReactionKind kind)
    {
        if (!Enum.IsDefined(kind)) throw new ArgumentException("Choose one of the four reactions.", nameof(kind));
        return new() { TenantId = tenantId, PraiseId = praiseId, ReactorEmployeeId = reactorEmployeeId, Kind = kind };
    }
}
