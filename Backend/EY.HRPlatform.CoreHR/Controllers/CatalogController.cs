using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Catalog;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

/// <summary>
/// The company's jobs, places and lists. Reading is open to whoever picks from them (people and organization
/// work); jobs and places are managed by the structure's owners, lists by people-data settings. Everything is the
/// caller's tenant only: the query filter hides other companies' rows, so their ids read as not found.
/// </summary>
[ApiController]
[Route("api/corehr/catalog")]
[Authorize]
public sealed class CatalogController(
    JobCatalogService catalog,
    CompanyListService lists,
    ICoreAccessPolicyService accessPolicy) : ControllerBase
{
    // --- Jobs -------------------------------------------------------------------------------------

    [HttpGet("jobs")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<JobDto>>>> GetJobs(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewCatalog(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<JobDto>>.Success(await catalog.GetJobsAsync(cancellationToken)));
    }

    [HttpPost("jobs")]
    public async Task<ActionResult<ApiResponse<JobDto>>> CreateJob([FromBody] JobRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<JobDto>.Success(await catalog.CreateJobAsync(request, User, cancellationToken)));
    }

    [HttpPut("jobs/{id:guid}")]
    public async Task<ActionResult<ApiResponse<JobDto>>> UpdateJob(Guid id, [FromBody] JobRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<JobDto>.Success(await catalog.UpdateJobAsync(id, request, User, cancellationToken)));
    }

    [HttpPost("jobs/{id:guid}/retire")]
    public Task<ActionResult<ApiResponse<JobDto>>> RetireJob(Guid id, CancellationToken cancellationToken)
        => SetJobRetired(id, true, cancellationToken);

    [HttpPost("jobs/{id:guid}/restore")]
    public Task<ActionResult<ApiResponse<JobDto>>> RestoreJob(Guid id, CancellationToken cancellationToken)
        => SetJobRetired(id, false, cancellationToken);

    [HttpPost("jobs/{id:guid}/merge")]
    public async Task<ActionResult<ApiResponse<JobDto>>> MergeJob(Guid id, [FromBody] MergeRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<JobDto>.Success(await catalog.MergeJobAsync(id, request, User, cancellationToken)));
    }

    [HttpDelete("jobs/{id:guid}")]
    public async Task<IActionResult> DeleteJob(Guid id, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        await catalog.DeleteJobAsync(id, User, cancellationToken);
        return NoContent();
    }

    private async Task<ActionResult<ApiResponse<JobDto>>> SetJobRetired(Guid id, bool retired, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<JobDto>.Success(await catalog.SetJobRetiredAsync(id, retired, User, cancellationToken)));
    }

    // --- Places -----------------------------------------------------------------------------------

    [HttpGet("places")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<PlaceDto>>>> GetPlaces(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewCatalog(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<PlaceDto>>.Success(await catalog.GetPlacesAsync(cancellationToken)));
    }

    [HttpPost("places")]
    public async Task<ActionResult<ApiResponse<PlaceDto>>> CreatePlace([FromBody] PlaceRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<PlaceDto>.Success(await catalog.CreatePlaceAsync(request, User, cancellationToken)));
    }

    [HttpPut("places/{id:guid}")]
    public async Task<ActionResult<ApiResponse<PlaceDto>>> UpdatePlace(Guid id, [FromBody] PlaceRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<PlaceDto>.Success(await catalog.UpdatePlaceAsync(id, request, User, cancellationToken)));
    }

    [HttpPost("places/{id:guid}/retire")]
    public Task<ActionResult<ApiResponse<PlaceDto>>> RetirePlace(Guid id, CancellationToken cancellationToken)
        => SetPlaceRetired(id, true, cancellationToken);

    [HttpPost("places/{id:guid}/restore")]
    public Task<ActionResult<ApiResponse<PlaceDto>>> RestorePlace(Guid id, CancellationToken cancellationToken)
        => SetPlaceRetired(id, false, cancellationToken);

    [HttpPost("places/{id:guid}/merge")]
    public async Task<ActionResult<ApiResponse<PlaceDto>>> MergePlace(Guid id, [FromBody] MergeRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<PlaceDto>.Success(await catalog.MergePlaceAsync(id, request, User, cancellationToken)));
    }

    [HttpDelete("places/{id:guid}")]
    public async Task<IActionResult> DeletePlace(Guid id, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        await catalog.DeletePlaceAsync(id, User, cancellationToken);
        return NoContent();
    }

    private async Task<ActionResult<ApiResponse<PlaceDto>>> SetPlaceRetired(Guid id, bool retired, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageJobsAndPlaces(User)) return Forbid();
        return Ok(ApiResponse<PlaceDto>.Success(await catalog.SetPlaceRetiredAsync(id, retired, User, cancellationToken)));
    }

    // --- Lists ------------------------------------------------------------------------------------

    [HttpGet("lists")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<CompanyListDto>>>> GetLists(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewCatalog(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<CompanyListDto>>.Success(await lists.GetAllAsync(cancellationToken)));
    }

    [HttpPost("lists/{list}/values")]
    public async Task<ActionResult<ApiResponse<CompanyListValueDto>>> AddValue(
        string list, [FromBody] ListValueRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageLists(User)) return Forbid();
        if (!TryList(list, out var kind)) return NotFound(ApiResponse.Failure("No such list."));
        return Ok(ApiResponse<CompanyListValueDto>.Success(await lists.AddAsync(kind, request, User, cancellationToken)));
    }

    [HttpPut("lists/{list}/values/{id:guid}")]
    public async Task<ActionResult<ApiResponse<CompanyListValueDto>>> RenameValue(
        string list, Guid id, [FromBody] ListValueRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageLists(User)) return Forbid();
        if (!TryList(list, out var kind)) return NotFound(ApiResponse.Failure("No such list."));
        return Ok(ApiResponse<CompanyListValueDto>.Success(await lists.RenameAsync(kind, id, request, User, cancellationToken)));
    }

    [HttpPut("lists/{list}/order")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<CompanyListDto>>>> Reorder(
        string list, [FromBody] ListOrderRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageLists(User)) return Forbid();
        if (!TryList(list, out var kind)) return NotFound(ApiResponse.Failure("No such list."));
        return Ok(ApiResponse<IReadOnlyList<CompanyListDto>>.Success(await lists.ReorderAsync(kind, request, User, cancellationToken)));
    }

    [HttpPost("lists/{list}/values/{id:guid}/retire")]
    public Task<ActionResult<ApiResponse<CompanyListValueDto>>> RetireValue(string list, Guid id, CancellationToken cancellationToken)
        => SetValueRetired(list, id, true, cancellationToken);

    [HttpPost("lists/{list}/values/{id:guid}/restore")]
    public Task<ActionResult<ApiResponse<CompanyListValueDto>>> RestoreValue(string list, Guid id, CancellationToken cancellationToken)
        => SetValueRetired(list, id, false, cancellationToken);

    [HttpDelete("lists/{list}/values/{id:guid}")]
    public async Task<IActionResult> DeleteValue(string list, Guid id, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageLists(User)) return Forbid();
        if (!TryList(list, out var kind)) return NotFound(ApiResponse.Failure("No such list."));
        await lists.DeleteAsync(kind, id, User, cancellationToken);
        return NoContent();
    }

    private async Task<ActionResult<ApiResponse<CompanyListValueDto>>> SetValueRetired(
        string list, Guid id, bool retired, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageLists(User)) return Forbid();
        if (!TryList(list, out var kind)) return NotFound(ApiResponse.Failure("No such list."));
        return Ok(ApiResponse<CompanyListValueDto>.Success(await lists.SetRetiredAsync(kind, id, retired, User, cancellationToken)));
    }

    private static bool TryList(string id, out CompanyList list) => CompanyLists.ById.TryGetValue(id, out list);
}
