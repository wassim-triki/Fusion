using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.Invitations;
using EY.HRPlatform.Identity.Features.TenantContext;
using EY.HRPlatform.Identity.Features.TenantContext.Dtos;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Localization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// The company's brand (B-176): name, colour, default language and logo, saved together from Settings › Company ›
/// Brand, and the public face of it that sign-in shows before anyone signs in. Writes need the Company settings'
/// manage permission at tenant scope, and the company is only ever the caller's own, from their token.
/// </summary>
[ApiController]
[Route("api/identity/brand")]
[Authorize]
public class BrandController(AppIdentityDbContext dbContext, IConfiguration configuration) : ControllerBase
{
    /// <summary>Saves the whole brand at once; nobody sees a change until this succeeds.</summary>
    [HttpPut]
    [ProducesResponseType(typeof(ApiResponse<TenantSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ApiResponse<TenantSummaryDto>>> Save(
        [FromBody] SaveBrandRequest request, CancellationToken cancellationToken)
    {
        if (User.GetTenantId() is not { } tenantId || !CanManage())
            return Forbid();

        var tenant = await dbContext.Tenants.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == tenantId && !item.IsArchived, cancellationToken);
        if (tenant is null)
            return NotFound(ApiResponse.Failure("Company not found."));

        BrandLogo? newLogo = null;
        try
        {
            switch (request.Logo)
            {
                case LogoChange.Keep or LogoChange.Remove:
                    break;
                case LogoChange.Replace:
                    newLogo = BrandLogo.Read(DecodeBase64(request.LogoPng));
                    break;
                default:
                    return BadRequest(ApiResponse.Failure("Say whether to keep, replace or remove the logo."));
            }

            var name = request.Name?.Trim() ?? string.Empty;
            if (await dbContext.Tenants.IgnoreQueryFilters()
                    .AnyAsync(item => item.Id != tenantId && !item.IsArchived && item.Name == name, cancellationToken))
                return Conflict(ApiResponse.Failure("Another company on Fusion already uses this name."));

            var logoVersion = request.Logo switch
            {
                LogoChange.Replace => newLogo!.Version,
                LogoChange.Remove => null,
                _ => tenant.LogoVersion,
            };
            tenant.Rebrand(name, request.Color, request.Language ?? string.Empty, logoVersion);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(ApiResponse.Failure(exception.Message.Split(" (Parameter")[0]));
        }

        var stored = await dbContext.TenantLogos.FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        if (newLogo is not null)
        {
            if (stored is null) dbContext.TenantLogos.Add(TenantLogo.Create(tenantId, newLogo));
            else stored.Replace(newLogo);
        }
        else if (request.Logo == LogoChange.Remove && stored is not null)
        {
            dbContext.TenantLogos.Remove(stored);
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict(ApiResponse.Failure("Another company on Fusion already uses this name."));
        }

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

    /// <summary>
    /// The invitation email as the company's people would get it with the draft brand, addressed to the caller. The
    /// logo shows as <c>cid:</c>; the page puts the draft image in its place.
    /// </summary>
    [HttpPost("email-preview")]
    [ProducesResponseType(typeof(ApiResponse<BrandEmailPreviewDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ApiResponse<BrandEmailPreviewDto>>> EmailPreview(
        [FromBody] BrandEmailPreviewRequest request, CancellationToken cancellationToken)
    {
        if (User.GetTenantId() is null || !CanManage())
            return Forbid();

        string? color;
        try { color = Tenant.NormalizeBrandColor(request.Color); }
        catch (ArgumentException) { color = null; }

        var userId = User.GetUserId();
        var me = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new { user.FirstName, user.LastName, user.Email })
            .FirstOrDefaultAsync(cancellationToken);
        var name = string.IsNullOrWhiteSpace(request.Name) ? "—" : request.Name.Trim();

        var rendered = CanonicalInvitationRenderer.Render(new CanonicalInvitation(
            InvitationPurpose.WorkforceAccount,
            name,
            me?.Email ?? User.GetEmail(),
            InvitationLinkBuilder.Build(configuration, "preview"),
            DateTime.UtcNow.AddDays(7),
            RecipientName: me is null ? null : $"{me.FirstName} {me.LastName}".Trim(),
            Language: FusionLanguages.IsSupported(request.Language) ? request.Language : FusionLanguages.Default,
            Brand: new InvitationBrand(color, request.HasLogo ? [0] : null)));

        return Ok(ApiResponse<BrandEmailPreviewDto>.Success(
            new BrandEmailPreviewDto(rendered.Subject, rendered.Html, CanonicalInvitationRenderer.LogoContentId)));
    }

    /// <summary>A company's brand by its workspace address, for its sign-in page. Unknown, suspended or archived: 404.</summary>
    [HttpGet("companies/{slug}")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ApiResponse<PublicBrandDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<PublicBrandDto>>> GetPublicBrand(string slug, CancellationToken cancellationToken)
    {
        var normalized = slug.Trim().ToLowerInvariant();
        var tenant = await dbContext.Tenants.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.Slug == normalized && item.IsActive && !item.IsArchived, cancellationToken);
        if (tenant is null)
            return NotFound(ApiResponse.Failure("Company not found."));

        return Ok(ApiResponse<PublicBrandDto>.Success(new PublicBrandDto(
            tenant.Name,
            tenant.Slug,
            tenant.BrandColor,
            BrandAddresses.LogoUrl(tenant.Id, tenant.LogoVersion),
            BrandAddresses.LanguageOf(tenant))));
    }

    /// <summary>The logo at its versioned address, cached for good; another version of it is not served.</summary>
    [HttpGet("logos/{tenantId:guid}/{version}.png")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetLogo(Guid tenantId, string version, CancellationToken cancellationToken)
    {
        var logo = await dbContext.TenantLogos.AsNoTracking()
            .Where(item => item.TenantId == tenantId && item.Version == version)
            .Select(item => item.Content)
            .FirstOrDefaultAsync(cancellationToken);
        if (logo is null)
            return NotFound();

        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers.XContentTypeOptions = "nosniff";
        return File(logo, "image/png");
    }

    private bool CanManage()
        => User.HasCorePermission(CorePermissions.SettingsOrganizationManage, PermissionScopes.Tenant)
            || User.HasCorePermission(CorePermissions.SettingsManage, PermissionScopes.Tenant);

    private static byte[] DecodeBase64(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException("Choose a logo to upload.");
        var comma = value.IndexOf(',');
        var data = value.StartsWith("data:", StringComparison.Ordinal) && comma > 0 ? value[(comma + 1)..] : value;
        try { return Convert.FromBase64String(data); }
        catch (FormatException) { throw new ArgumentException("The logo isn't a PNG image."); }
    }
}
