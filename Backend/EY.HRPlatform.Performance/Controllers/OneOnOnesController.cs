using EY.HRPlatform.Performance.Features.OneOnOnes;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>
/// 1:1s between a manager and each direct report (D-12). Not tied to a cycle. Only the two people read or change a
/// series; the handlers enforce that, and check Core HR's reporting line on every write.
/// </summary>
[ApiController]
[Authorize]
[Route("api/performance/one-on-ones")]
public sealed class OneOnOnesController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    private OneOnOneViewer Viewer => new(User.GetEmployeeId() ?? Guid.Empty, policy.CanReviewDirectReports(User));

    /// <summary>Entering Performance with an employee record; 1:1s are between people, so an account alone has none.</summary>
    private bool Allowed => policy.CanEnterPerformance(User) && User.GetEmployeeId() is Guid id && id != Guid.Empty;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<OneOnOnesDto>>> List(CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new GetOneOnOnesQuery(Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPost]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> Start([FromBody] StartOneOnOneRequest request, CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new StartOneOnOneCommand(request, Viewer), cancellationToken)) : CapabilityForbidden();

    /// <summary>Starts 1:1s at a time both are free, booked in place from Home or the person's page (B-434).</summary>
    [HttpPost("with/{employeeId:guid}/book")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> Book(Guid employeeId, [FromBody] BookOneOnOneRequest request, CancellationToken cancellationToken)
        => Allowed
            ? MapResult(await mediator.Send(new StartOneOnOneCommand(new StartOneOnOneRequest(employeeId, null, request.At), Viewer), cancellationToken))
            : CapabilityForbidden();

    /// <summary>Starting 1:1s with someone: the default rhythm and the talking points ready for the first meeting.</summary>
    [HttpGet("start")]
    public async Task<ActionResult<ApiResponse<OneOnOneStartDto>>> StartOptions([FromQuery] Guid with, CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new GetOneOnOneStartQuery(with, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpGet("{seriesId:guid}")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> Get(Guid seriesId, CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new GetOneOnOneSeriesQuery(seriesId, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPut("{seriesId:guid}/cadence")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> Cadence(Guid seriesId, [FromBody] ChangeOneOnOneCadenceRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new ChangeOneOnOneCadenceCommand(seriesId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPost("{seriesId:guid}/actions")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> AddAction(Guid seriesId, [FromBody] AddActionRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new AddActionCommand(seriesId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPut("{seriesId:guid}/actions/{actionId:guid}")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> EditAction(Guid seriesId, Guid actionId, [FromBody] EditActionRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new EditActionCommand(seriesId, actionId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPut("{seriesId:guid}/actions/{actionId:guid}/done")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> SetActionDone(Guid seriesId, Guid actionId, [FromBody] SetActionDoneRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new SetActionDoneCommand(seriesId, actionId, request.Done, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPut("meetings/{meetingId:guid}/schedule")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> Reschedule(Guid meetingId, [FromBody] RescheduleOneOnOneRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new RescheduleOneOnOneCommand(meetingId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPost("meetings/{meetingId:guid}/agenda")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> AddAgendaItem(Guid meetingId, [FromBody] AddAgendaItemRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new AddAgendaItemCommand(meetingId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    /// <summary>The note both people see on an agenda item; a note marks it talked about.</summary>
    [HttpPut("meetings/{meetingId:guid}/agenda/{itemId:guid}/note")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> AgendaNote(Guid meetingId, Guid itemId, [FromBody] SetNotesRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new SetAgendaNoteCommand(meetingId, itemId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpDelete("meetings/{meetingId:guid}/agenda/{itemId:guid}")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> RemoveAgendaItem(Guid meetingId, Guid itemId, CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new RemoveAgendaItemCommand(meetingId, itemId, Viewer), cancellationToken)) : CapabilityForbidden();

    [HttpPut("meetings/{meetingId:guid}/notes/private")]
    public async Task<ActionResult<ApiResponse<OneOnOneSeriesDto>>> PrivateNotes(Guid meetingId, [FromBody] SetNotesRequest request,
        CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new SetPrivateNotesCommand(meetingId, request, Viewer), cancellationToken)) : CapabilityForbidden();

    /// <summary>Whether the caller has a calendar feed link; the link itself shows only when it's made.</summary>
    [HttpGet("calendar-feed")]
    public async Task<ActionResult<ApiResponse<CalendarFeedDto>>> CalendarFeed(CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new GetCalendarFeedQuery(Viewer.EmployeeId), cancellationToken)) : CapabilityForbidden();

    /// <summary>Makes a new feed link; any earlier link stops working.</summary>
    [HttpPost("calendar-feed")]
    public async Task<ActionResult<ApiResponse<CalendarFeedDto>>> CreateCalendarFeed(CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new CreateCalendarFeedCommand(Viewer.EmployeeId), cancellationToken)) : CapabilityForbidden();

    [HttpDelete("calendar-feed")]
    public async Task<ActionResult<ApiResponse<CalendarFeedDto>>> RevokeCalendarFeed(CancellationToken cancellationToken)
        => Allowed ? MapResult(await mediator.Send(new RevokeCalendarFeedCommand(Viewer.EmployeeId), cancellationToken)) : CapabilityForbidden();
}

/// <summary>
/// A person's 1:1s as a calendar feed (D-39), read by calendar apps without a session: the token in the path is the
/// credential. Anything that isn't a live feed reads as not found.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/performance/calendar")]
public sealed class CalendarFeedController(IMediator mediator) : ControllerBase
{
    [HttpGet("{token}.ics")]
    public async Task<IActionResult> Feed(string token, CancellationToken cancellationToken)
    {
        var ics = await mediator.Send(new ReadCalendarFeedQuery(token), cancellationToken);
        if (ics is null) return NotFound();
        Response.Headers.CacheControl = "private, max-age=300";
        return Content(ics, "text/calendar; charset=utf-8");
    }
}
