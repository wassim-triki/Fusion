using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Reports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using EY.HRPlatform.SharedKernel.Text;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Search;

// --- Contracts ------------------------------------------------------------------------------------

/// <summary>What a person is to the viewer, said beside their name.</summary>
public static class CoreSearchRelations
{
    public const string Self = "Self";
    public const string Manager = "Manager";
    public const string Report = "Report";
    public const string Teammate = "Teammate";
}

/// <param name="EmployeeId">For Performance's links (praise, feedback, 1:1s), which key people by id.</param>
/// <param name="Relation">One of <see cref="CoreSearchRelations"/>, or null.</param>
public sealed record CoreSearchPersonDto(
    string EmployeeKey,
    Guid EmployeeId,
    string DisplayName,
    string? PhotoUrl,
    string? JobTitle,
    string? UnitName,
    string? Place,
    string? Relation);

/// <summary>A team, place or job, with how many of the people the viewer sees hold it.</summary>
public sealed record CoreSearchGroupDto(Guid Id, string Name, int People);

public sealed record CoreSearchReportDto(Guid Id, string Name);

/// <param name="People">The best matches, or before anything is typed the viewer's own people: their manager, then
/// their reports (or teammates when they lead nobody).</param>
/// <param name="PeopleTotal">Everyone who matches, for "See all".</param>
/// <param name="OrgChart">The viewer may open the org chart, so "Show on org chart" is offered.</param>
public sealed record CoreSearchDto(
    IReadOnlyList<CoreSearchPersonDto> People,
    int PeopleTotal,
    IReadOnlyList<CoreSearchGroupDto> Units,
    IReadOnlyList<CoreSearchGroupDto> Places,
    IReadOnlyList<CoreSearchGroupDto> Jobs,
    IReadOnlyList<CoreSearchReportDto> Reports,
    bool OrgChart = false);

/// <summary>
/// The top bar's Core HR read (B-211): people as the directory shows them to any colleague, the teams and places
/// they're in, jobs for HR, and saved reports the viewer may open. Word-start, accent- and case-insensitive over
/// name, job, team, place and work email, and employee number for HR.
/// </summary>
/// <param name="ViewerEmployeeId">The caller's own employee id from the token, never a request value.</param>
/// <param name="Hr">Reads the whole workforce: employee numbers match, jobs come back.</param>
/// <param name="ReportViewer">Null or unable to see reports: no saved reports.</param>
public sealed record CoreSearchQuery(string Text, Guid? ViewerEmployeeId, bool Hr, ReportViewer? ReportViewer = null)
    : IQuery<Result<CoreSearchDto>>
{
    public const int PeopleLimit = 20;
    public const int YourPeopleLimit = 7;
    public const int GroupLimit = 4;
    public const int JobLimit = 3;
    public const int ReportLimit = 3;
    public const int MaxTextLength = 100;
}

// --- Handler --------------------------------------------------------------------------------------

public sealed class CoreSearchQueryHandler(ISender sender, CoreHRDbContext dbContext, ReportService? reports = null)
    : IQueryHandler<CoreSearchQuery, Result<CoreSearchDto>>
{
    public async Task<Result<CoreSearchDto>> Handle(CoreSearchQuery request, CancellationToken cancellationToken)
    {
        // The directory decides who and what any colleague may read; search never shows more.
        var directory = await sender.Send(new PeopleDirectoryQuery(request.ViewerEmployeeId), cancellationToken);
        if (directory.IsFailure) return Result.Failure<CoreSearchDto>(directory.Error);

        var people = directory.Value.People;
        var viewerKey = directory.Value.ViewerEmployeeKey;
        var managerKey = people.FirstOrDefault(person => person.EmployeeKey == viewerKey)?.Manager?.EmployeeKey;
        string? Relation(PeopleDirectoryPersonDto person)
            => viewerKey is null ? null
                : person.EmployeeKey == viewerKey ? CoreSearchRelations.Self
                : person.EmployeeKey == managerKey ? CoreSearchRelations.Manager
                : person.Manager?.EmployeeKey == viewerKey ? CoreSearchRelations.Report
                : managerKey is not null && person.Manager?.EmployeeKey == managerKey ? CoreSearchRelations.Teammate
                : null;

        var text = request.Text.Trim();
        if (text.Length > CoreSearchQuery.MaxTextLength) text = text[..CoreSearchQuery.MaxTextLength];
        if (text.Length == 0)
        {
            var mine = people.Where(person => Relation(person) == CoreSearchRelations.Manager).ToList();
            var reportsToViewer = people.Where(person => Relation(person) == CoreSearchRelations.Report).ToList();
            mine.AddRange(reportsToViewer.Count > 0 ? reportsToViewer : people.Where(person => Relation(person) == CoreSearchRelations.Teammate));
            var yours = mine.Take(CoreSearchQuery.YourPeopleLimit).ToList();
            return Result.Success(new CoreSearchDto(await CardsAsync(yours, Relation, cancellationToken), yours.Count, [], [], [], []));
        }

        var words = SearchText.Words(text);
        var numbers = request.Hr
            ? await dbContext.Employees.AsNoTracking().Select(e => new { e.StableEmployeeKey, e.EmployeeNumber })
                .ToDictionaryAsync(e => e.StableEmployeeKey, e => e.EmployeeNumber, StringComparer.Ordinal, cancellationToken)
            : [];

        var matches = people
            .Select(person =>
            {
                var number = numbers.GetValueOrDefault(person.EmployeeKey);
                if (!SearchText.MatchesAll(words, person.DisplayName, person.JobTitle, person.UnitName, person.Place, person.WorkEmail, number))
                    return (Person: person, Score: -1);
                var score = new[]
                {
                    SearchText.Score(person.DisplayName, text) * 2,
                    SearchText.Score(number, text) * 2,
                    SearchText.Score(person.WorkEmail, text),
                    SearchText.Score(person.JobTitle, text),
                    SearchText.Score(person.UnitName, text),
                    SearchText.Score(person.Place, text),
                    10,
                }.Max();
                var relation = Relation(person);
                return (Person: person, Score: score + (relation is not null and not CoreSearchRelations.Self ? 15 : 0));
            })
            .Where(match => match.Score >= 0)
            .OrderByDescending(match => match.Score)
            .ThenBy(match => match.Person.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .Select(match => match.Person)
            .ToList();

        List<CoreSearchGroupDto> Groups(Func<PeopleDirectoryPersonDto, Guid?> id, Func<PeopleDirectoryPersonDto, string?> name, int limit)
            => people.Where(person => id(person) is not null && !string.IsNullOrWhiteSpace(name(person)))
                .GroupBy(person => id(person)!.Value)
                .Select(group => (Group: new CoreSearchGroupDto(group.Key, name(group.First())!, group.Count()), Score: SearchText.Score(name(group.First()), text)))
                .Where(item => item.Score > 0)
                .OrderByDescending(item => item.Score)
                .ThenByDescending(item => item.Group.People)
                .ThenBy(item => item.Group.Name, StringComparer.CurrentCultureIgnoreCase)
                .Take(limit)
                .Select(item => item.Group)
                .ToList();

        return Result.Success(new CoreSearchDto(
            await CardsAsync(matches.Take(CoreSearchQuery.PeopleLimit).ToList(), Relation, cancellationToken),
            matches.Count,
            Groups(person => person.UnitId, person => person.UnitName, CoreSearchQuery.GroupLimit),
            Groups(person => person.PlaceId, person => person.Place, CoreSearchQuery.GroupLimit),
            request.Hr ? Groups(person => person.JobId, person => person.JobTitle, CoreSearchQuery.JobLimit) : [],
            await ReportsAsync(request.ReportViewer, text, cancellationToken)));
    }

    private async Task<IReadOnlyList<CoreSearchPersonDto>> CardsAsync(
        IReadOnlyList<PeopleDirectoryPersonDto> people, Func<PeopleDirectoryPersonDto, string?> relation, CancellationToken cancellationToken)
    {
        if (people.Count == 0) return [];
        var keys = people.Select(person => person.EmployeeKey).ToList();
        var ids = await dbContext.Employees.AsNoTracking()
            .Where(e => keys.Contains(e.StableEmployeeKey))
            .Select(e => new { e.StableEmployeeKey, e.Id })
            .ToDictionaryAsync(e => e.StableEmployeeKey, e => e.Id, StringComparer.Ordinal, cancellationToken);
        return people.Where(person => ids.ContainsKey(person.EmployeeKey))
            .Select(person => new CoreSearchPersonDto(person.EmployeeKey, ids[person.EmployeeKey], person.DisplayName, person.PhotoUrl,
                person.JobTitle, person.UnitName, person.Place, relation(person)))
            .ToList();
    }

    private async Task<IReadOnlyList<CoreSearchReportDto>> ReportsAsync(ReportViewer? viewer, string text, CancellationToken cancellationToken)
    {
        if (reports is null || viewer is not { CanSee: true }) return [];
        try
        {
            return (await reports.ListAsync(viewer, cancellationToken))
                .Where(report => SearchText.Score(report.Name, text) > 0)
                .Take(CoreSearchQuery.ReportLimit)
                .Select(report => new CoreSearchReportDto(report.Id, report.Name))
                .ToList();
        }
        catch (HttpRequestException)
        {
            // Identity is down: the reports group goes missing, people still come back.
            return [];
        }
    }
}
