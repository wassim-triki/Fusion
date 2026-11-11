using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

/// <summary>One reason a colleague was asked, as the colleague reads it ("Why you").</summary>
public sealed record PeerReasonDto(string Kind, string? Title, DateTime? At, string? Excerpt);

/// <summary>
/// Who worked with whom over the review period (D-40): goals supporting the same goal above, shared feedback and praise
/// between the two, the same manager. Fusion asks the three closest colleagues when a round opens and tells each why.
/// Only shared feedback counts: manager-only words never decide or explain who is asked.
/// </summary>
internal sealed class PeerAffinity
{
    public const int Picks = 3;
    public const int ReasonExcerpt = 60;

    private sealed record Exchange(Guid Author, Guid To, DateTime At, string Message);

    private readonly List<Exchange> _feedback;
    private readonly List<Exchange> _praise;
    private readonly Dictionary<Guid, List<(Guid Id, string Title)>> _parents;
    private readonly Dictionary<Guid, Guid?> _managers;

    private PeerAffinity(List<Exchange> feedback, List<Exchange> praise, Dictionary<Guid, List<(Guid, string)>> parents, Dictionary<Guid, Guid?> managers)
        => (_feedback, _praise, _parents, _managers) = (feedback, praise, parents, managers);

    /// <summary>The year's signals between everyone in it, or only between <paramref name="only"/> when given.</summary>
    public static async Task<PeerAffinity> LoadAsync(PerformanceDbContext db, Guid cycleId, DateOnly from, DateOnly to,
        IReadOnlyCollection<Guid>? only, CancellationToken token)
    {
        var start = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var feedback = db.Feedback.AsNoTracking()
            .Where(f => f.Visibility == FeedbackVisibility.Shared && f.SentAt >= start && f.SentAt < end);
        if (only is not null) feedback = feedback.Where(f => only.Contains(f.AuthorEmployeeId) && only.Contains(f.ReceiverEmployeeId));
        var praise = from recipient in db.PraiseRecipients.AsNoTracking()
                     join item in db.Praise.AsNoTracking() on recipient.PraiseId equals item.Id
                     where item.DeletedAt == null && item.GivenAt >= start && item.GivenAt < end
                     select new { item.AuthorEmployeeId, recipient.EmployeeId, item.GivenAt, item.Message };
        if (only is not null) praise = praise.Where(p => only.Contains(p.AuthorEmployeeId) && only.Contains(p.EmployeeId));
        var aligned = from objective in db.Objectives.AsNoTracking()
                      join plan in db.EmployeePlans.AsNoTracking() on objective.EmployeePlanId equals plan.Id
                      join parent in db.Objectives.AsNoTracking() on objective.ParentObjectiveId equals parent.Id
                      where plan.CycleId == cycleId && plan.State == PlanLifecycleState.Approved
                            && objective.State != ObjectiveLifecycleState.Archived
                      select new { plan.EmployeeId, ParentId = parent.Id, parent.Title };
        if (only is not null) aligned = aligned.Where(a => only.Contains(a.EmployeeId));
        var participants = db.Participants.AsNoTracking().Where(p => p.CycleId == cycleId);
        if (only is not null) participants = participants.Where(p => only.Contains(p.EmployeeId));

        return new PeerAffinity(
            (await feedback.Select(f => new { f.AuthorEmployeeId, f.ReceiverEmployeeId, f.SentAt, f.Message }).ToListAsync(token))
                .Select(f => new Exchange(f.AuthorEmployeeId, f.ReceiverEmployeeId, f.SentAt, f.Message)).ToList(),
            (await praise.ToListAsync(token)).Select(p => new Exchange(p.AuthorEmployeeId, p.EmployeeId, p.GivenAt, p.Message)).ToList(),
            (await aligned.ToListAsync(token)).GroupBy(a => a.EmployeeId)
                .ToDictionary(g => g.Key, g => g.Select(a => (a.ParentId, a.Title)).Distinct().ToList()),
            await participants.ToDictionaryAsync(p => p.EmployeeId, p => p.ManagerEmployeeId, token));
    }

    /// <summary>How closely two people worked: a shared goal above counts most, then feedback, praise and a shared manager.</summary>
    public int Score(Guid a, Guid b)
    {
        var score = SharedGoal(a, b) is null ? 0 : 3;
        score += 2 * _feedback.Count(f => f.Author == a && f.To == b || f.Author == b && f.To == a);
        score += _praise.Count(p => p.Author == a && p.To == b || p.Author == b && p.To == a);
        if (_managers.GetValueOrDefault(a) is Guid manager && _managers.GetValueOrDefault(b) == manager) score += 1;
        return score;
    }

    /// <summary>
    /// The colleagues to ask about <paramref name="subject"/>: the closest <see cref="Picks"/> people in the year, never the
    /// person or their reviewer, and only someone they worked with.
    /// </summary>
    public IReadOnlyList<Guid> Pick(Guid subject, Guid reviewer, IEnumerable<Guid> candidates)
        => candidates.Where(id => id != subject && id != reviewer)
            .Select(id => (Id: id, Score: Score(subject, id)))
            .Where(c => c.Score > 0)
            .OrderByDescending(c => c.Score).ThenBy(c => c.Id)
            .Take(Picks).Select(c => c.Id).ToArray();

    /// <summary>Why <paramref name="peer"/> was asked about <paramref name="subject"/>, newest first, as the peer reads it.</summary>
    public IReadOnlyList<PeerReasonDto> Reasons(Guid subject, Guid peer)
    {
        var reasons = new List<PeerReasonDto>();
        if (SharedGoal(subject, peer) is { } goal) reasons.Add(new("goal", goal, null, null));
        reasons.AddRange(_feedback.Where(f => f.Author == peer && f.To == subject).OrderByDescending(f => f.At).Take(1)
            .Select(f => new PeerReasonDto("feedbackGiven", null, f.At, Excerpt(f.Message))));
        reasons.AddRange(_feedback.Where(f => f.Author == subject && f.To == peer).OrderByDescending(f => f.At).Take(1)
            .Select(f => new PeerReasonDto("feedbackReceived", null, f.At, Excerpt(f.Message))));
        reasons.AddRange(_praise.Where(p => p.Author == peer && p.To == subject).OrderByDescending(p => p.At).Take(1)
            .Select(p => new PeerReasonDto("praiseGiven", null, p.At, Excerpt(p.Message))));
        reasons.AddRange(_praise.Where(p => p.Author == subject && p.To == peer).OrderByDescending(p => p.At).Take(1)
            .Select(p => new PeerReasonDto("praiseReceived", null, p.At, Excerpt(p.Message))));
        if (reasons.Count == 0 && _managers.GetValueOrDefault(subject) is Guid manager && _managers.GetValueOrDefault(peer) == manager)
            reasons.Add(new("teammate", null, null, null));
        return reasons;
    }

    private string? SharedGoal(Guid a, Guid b)
    {
        if (!_parents.TryGetValue(a, out var mine) || !_parents.TryGetValue(b, out var theirs)) return null;
        return mine.FirstOrDefault(goal => theirs.Any(other => other.Id == goal.Id)).Title;
    }

    private static string Excerpt(string message)
    {
        var text = message.Trim();
        return text.Length <= ReasonExcerpt ? text : text[..ReasonExcerpt].TrimEnd() + "…";
    }
}
