using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantContext;
using EY.HRPlatform.Identity.Features.TenantContext.Dtos;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

[ApiController]
[Route("api/identity/tenant-context")]
[Authorize]
public class TenantContextController(
    ITenantContext tenantContext,
    AppIdentityDbContext dbContext) : ControllerBase
{
    /// <summary>
    /// Resolve a tenant slug to its full summary. Used by frontend when navigating via slug in URL.
    /// </summary>
    [HttpGet("by-slug/{slug}")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ApiResponse<TenantSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<TenantSummaryDto>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<TenantSummaryDto>>> GetBySlug(
        string slug,
        CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Slug == slug.ToLowerInvariant(), cancellationToken);

        if (tenant is null)
            return NotFound(ApiResponse<TenantSummaryDto>.Failure("Tenant not found."));

        return Ok(ApiResponse<TenantSummaryDto>.Success(new TenantSummaryDto(
            tenant.Id,
            tenant.Name,
            tenant.Slug,
            TenantOperationalStatus.For(tenant),
            tenant.IsActive,
            tenant.IsArchived)));
    }

    /// <summary>
    /// The caller's own company's operational status, for the people who run it: read from the roles model (the
    /// company-wide overview) now that token roles have retired (B-178).
    /// </summary>
    [HttpGet("organization-status")]
    [ProducesResponseType(typeof(ApiResponse<TenantOperationalStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<TenantOperationalStatusDto>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<TenantOperationalStatusDto>>> GetOrganizationStatus(
        CancellationToken cancellationToken)
    {
        if (!User.HasCorePermission(CorePermissions.OverviewView, PermissionScopes.Tenant))
            return StatusCode(StatusCodes.Status403Forbidden,
                ApiResponse<TenantOperationalStatusDto>.Failure("You do not have permission to read the organization's status."));

        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == tenantContext.TenantId, cancellationToken);

        if (tenant is null)
            return NotFound(ApiResponse<TenantOperationalStatusDto>.Failure("Organization not found."));

        return Ok(ApiResponse<TenantOperationalStatusDto>.Success(new TenantOperationalStatusDto(
            tenant.Id,
            TenantOperationalStatus.For(tenant),
            tenant.IsActive,
            tenant.IsArchived)));
    }

    /// <summary>
    /// Who a refused person can ask: up to three of the caller's own company's usable administrators, longest-serving
    /// first. Any signed-in member may read it, as the directory already shows these people. The tenant comes only from
    /// the token's membership claim; a Platform Administrator has none and is refused.
    /// </summary>
    [HttpGet("administrators")]
    [ProducesResponseType(typeof(ApiResponse<CompanyAdministratorsDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ApiResponse<CompanyAdministratorsDto>>> GetAdministrators(
        CancellationToken cancellationToken)
    {
        if (tenantContext.TenantIdOrDefault is not { } tenantId || tenantId == Guid.Empty)
            return StatusCode(StatusCodes.Status403Forbidden,
                ApiResponse.Failure("A customer tenant context is required."));

        var callerId = User.GetUserId();
        var usable = UsableTenantAdministrator.ForTenant(dbContext, tenantId).AsNoTracking();

        if (await usable.AnyAsync(assignment => assignment.UserId == callerId, cancellationToken))
            return Ok(ApiResponse<CompanyAdministratorsDto>.Success(new CompanyAdministratorsDto(true, [])));

        var administrators = await usable
            .Where(assignment => assignment.User!.Email != null)
            .OrderBy(assignment => assignment.GrantedAt)
            .Take(3)
            .Select(assignment => new CompanyAdministratorContactDto(
                (assignment.User!.FirstName + " " + assignment.User!.LastName).Trim(),
                assignment.User!.FirstName,
                assignment.User!.Email!))
            .ToListAsync(cancellationToken);

        return Ok(ApiResponse<CompanyAdministratorsDto>.Success(new CompanyAdministratorsDto(false, administrators)));
    }

    /// <summary>
    /// Lightweight summary of the caller's own tenant (name, status, industry, locale and time zone): the Fusion
    /// sidebar's brand line and Settings › Company. Any signed-in member may read it; the tenant comes only from
    /// their token's membership claim, never from the request, so it can't name another tenant.
    /// </summary>
    [HttpGet("tenant-summary")]
    [ProducesResponseType(typeof(ApiResponse<TenantSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<TenantSummaryDto>>> GetTenantSummary(
        CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == tenantContext.TenantId, cancellationToken);

        if (tenant is null)
            return NotFound(ApiResponse.Failure("Tenant not found."));

        return Ok(ApiResponse<TenantSummaryDto>.Success(new TenantSummaryDto(
            tenant.Id,
            tenant.Name,
            tenant.Slug,
            TenantOperationalStatus.For(tenant),
            tenant.IsActive,
            tenant.IsArchived,
            tenant.Industry,
            tenant.Locale,
            tenant.TimeZone,
            tenant.BrandColor,
            BrandAddresses.LogoUrl(tenant.Id, tenant.LogoVersion),
            BrandAddresses.LanguageOf(tenant))));
    }
}
