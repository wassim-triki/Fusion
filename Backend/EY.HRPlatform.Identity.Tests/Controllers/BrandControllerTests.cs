using System.Buffers.Binary;
using System.Security.Claims;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.TenantContext.Dtos;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Tests.Controllers;

/// <summary>B-176: the brand studio's save, the email preview, and the brand sign-in shows before anyone signs in.</summary>
public class BrandControllerTests
{
    private static readonly (string, string) Manage = (CorePermissions.SettingsOrganizationManage, PermissionScopes.Tenant);

    /// <summary>A PNG header of the given size: enough for the studio's checks, which read only the header.</summary>
    internal static byte[] Png(int width = 256, int height = 256, int extra = 0)
    {
        var bytes = new byte[33 + extra];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, (byte)'I', (byte)'H', (byte)'D', (byte)'R' }.CopyTo(bytes, 0);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16), width);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(20), height);
        return bytes;
    }

    private sealed record Arranged(string Db, Guid Own, Guid Other);

    private static async Task<Arranged> SeedAsync()
    {
        var db = Guid.NewGuid().ToString();
        var own = Tenant.Create("Carthage Digital Group");
        var other = Tenant.Create("Atlas Holding");
        await using var seed = TestDbContextFactory.CreateWithoutTenant(db);
        seed.Tenants.AddRange(own, other);
        seed.Users.Add(new ApplicationUser { Id = Guid.NewGuid(), FirstName = "Amira", LastName = "Khelifi", Email = "amira@example.test", UserName = "amira@example.test" });
        await seed.SaveChangesAsync();
        return new Arranged(db, own.Id, other.Id);
    }

    private static BrandController Controller(string db, Guid? tenantId, params (string Key, string Scope)[] grants)
    {
        var context = tenantId is { } id ? TestTenantContext.WithTenant(id) : TestTenantContext.Unresolved();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Application:PublicBaseUrl"] = "http://localhost:3000",
        }).Build();
        return new BrandController(TestDbContextFactory.Create(context, db), configuration)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
                        new Claim(ClaimTypes.Email, "amira@example.test"),
                        .. tenantId is { } own ? new[] { new Claim(CustomClaimTypes.TenantId, own.ToString()) } : [],
                        .. grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))),
                    ], "TestAuth")),
                },
            },
        };
    }

    private static SaveBrandRequest Request(string name = "Carthage", string? color = "#3e63dd", string language = "ar",
        string logo = LogoChange.Keep, string? png = null)
        => new(name, color, language, logo, png);

    private static async Task<Tenant> ReadAsync(string db, Guid id)
    {
        await using var read = TestDbContextFactory.CreateWithoutTenant(db);
        return await read.Tenants.AsNoTracking().SingleAsync(item => item.Id == id);
    }

    [Fact]
    public async Task One_save_sets_name_colour_language_and_logo_together()
    {
        var arranged = await SeedAsync();
        var controller = Controller(arranged.Db, arranged.Own, Manage);

        var result = await controller.Save(Request(png: Convert.ToBase64String(Png()), logo: LogoChange.Replace), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<TenantSummaryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal("Carthage", body.Name);
        Assert.Equal("#3e63dd", body.BrandColor);
        Assert.Equal("ar", body.Language);
        Assert.StartsWith($"/api/identity/brand/logos/{arranged.Own}/", body.LogoUrl);
        var tenant = await ReadAsync(arranged.Db, arranged.Own);
        Assert.Equal("ar", tenant.Locale);
        await using var read = TestDbContextFactory.CreateWithoutTenant(arranged.Db);
        Assert.Equal(tenant.LogoVersion, (await read.TenantLogos.SingleAsync()).Version);
    }

    [Fact]
    public async Task Keeping_the_logo_keeps_it_and_removing_it_deletes_it()
    {
        var arranged = await SeedAsync();
        await Controller(arranged.Db, arranged.Own, Manage)
            .Save(Request(png: Convert.ToBase64String(Png()), logo: LogoChange.Replace), CancellationToken.None);
        var version = (await ReadAsync(arranged.Db, arranged.Own)).LogoVersion;

        await Controller(arranged.Db, arranged.Own, Manage).Save(Request(color: null, language: "fr"), CancellationToken.None);
        var kept = await ReadAsync(arranged.Db, arranged.Own);
        Assert.Equal(version, kept.LogoVersion);
        Assert.Null(kept.BrandColor);
        Assert.Equal("fr", kept.Locale);

        await Controller(arranged.Db, arranged.Own, Manage).Save(Request(logo: LogoChange.Remove), CancellationToken.None);
        Assert.Null((await ReadAsync(arranged.Db, arranged.Own)).LogoVersion);
        await using var read = TestDbContextFactory.CreateWithoutTenant(arranged.Db);
        Assert.Empty(await read.TenantLogos.ToListAsync());
    }

    [Fact]
    public async Task A_locale_that_already_speaks_the_language_stays()
    {
        var arranged = await SeedAsync();
        await Controller(arranged.Db, arranged.Own, Manage).Save(Request(language: "en"), CancellationToken.None);
        Assert.Equal(Tenant.DefaultLocale, (await ReadAsync(arranged.Db, arranged.Own)).Locale);
    }

    [Fact]
    public async Task Without_the_company_settings_manage_permission_nothing_changes()
    {
        var arranged = await SeedAsync();
        var viewOnly = Controller(arranged.Db, arranged.Own, (CorePermissions.SettingsOrganizationView, PermissionScopes.Tenant));
        Assert.IsType<ForbidResult>((await viewOnly.Save(Request(), CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await viewOnly.EmailPreview(new BrandEmailPreviewRequest("X", null, "en", false), CancellationToken.None)).Result);

        var otherSettings = Controller(arranged.Db, arranged.Own, (CorePermissions.SettingsPeopleDataManage, PermissionScopes.Tenant));
        Assert.IsType<ForbidResult>((await otherSettings.Save(Request(), CancellationToken.None)).Result);
        Assert.Equal("Carthage Digital Group", (await ReadAsync(arranged.Db, arranged.Own)).Name);
    }

    [Fact]
    public async Task The_legacy_settings_manage_permission_still_counts()
    {
        var arranged = await SeedAsync();
        var legacy = Controller(arranged.Db, arranged.Own, (CorePermissions.SettingsManage, PermissionScopes.Tenant));
        Assert.IsType<OkObjectResult>((await legacy.Save(Request(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Without_a_company_in_the_token_nothing_changes()
    {
        var arranged = await SeedAsync();
        // A platform operator: permission claims but no membership claim, even with a resolved tenant context.
        var controller = Controller(arranged.Db, null, Manage);
        Assert.IsType<ForbidResult>((await controller.Save(Request(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task A_save_only_ever_touches_the_callers_own_company()
    {
        var arranged = await SeedAsync();
        await Controller(arranged.Db, arranged.Own, Manage).Save(Request(name: "Renamed"), CancellationToken.None);
        var other = await ReadAsync(arranged.Db, arranged.Other);
        Assert.Equal("Atlas Holding", other.Name);
        Assert.Null(other.BrandColor);
        Assert.Empty(typeof(BrandController).GetMethod(nameof(BrandController.Save))!.GetParameters()
            .Where(parameter => parameter.ParameterType == typeof(Guid)));
    }

    [Fact]
    public async Task Another_companys_name_is_refused()
    {
        var arranged = await SeedAsync();
        var result = await Controller(arranged.Db, arranged.Own, Manage).Save(Request(name: "Atlas Holding"), CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Theory]
    [InlineData("C", "#3e63dd", "en", "Name must be 2-100 characters.")]
    [InlineData("Carthage", "blue", "en", "A colour is written as #rrggbb.")]
    [InlineData("Carthage", "#3e63dd", "de", "Choose English, French or Arabic.")]
    public async Task Invalid_values_are_refused_in_words(string name, string color, string language, string message)
    {
        var arranged = await SeedAsync();
        var result = await Controller(arranged.Db, arranged.Own, Manage).Save(Request(name, color, language), CancellationToken.None);
        var body = Assert.IsType<ApiResponse>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal(message, Assert.Single(body.Errors));
        Assert.Equal("Carthage Digital Group", (await ReadAsync(arranged.Db, arranged.Own)).Name);
    }

    [Fact]
    public async Task Only_a_png_within_size_is_a_logo()
    {
        var arranged = await SeedAsync();
        var svg = Convert.ToBase64String("<svg onload=\"alert(1)\"/>"u8.ToArray());
        var tooWide = Convert.ToBase64String(Png(width: 2048));
        var tooHeavy = Convert.ToBase64String(Png(extra: BrandLogo.MaxBytes));
        foreach (var png in new[] { svg, tooWide, tooHeavy, "not base64" })
        {
            var result = await Controller(arranged.Db, arranged.Own, Manage)
                .Save(Request(logo: LogoChange.Replace, png: png), CancellationToken.None);
            Assert.IsType<BadRequestObjectResult>(result.Result);
        }
        Assert.Null((await ReadAsync(arranged.Db, arranged.Own)).LogoVersion);
    }

    [Fact]
    public async Task Sign_in_reads_a_company_brand_by_its_address_and_nothing_else()
    {
        var arranged = await SeedAsync();
        await Controller(arranged.Db, arranged.Own, Manage)
            .Save(Request(png: Convert.ToBase64String(Png()), logo: LogoChange.Replace), CancellationToken.None);
        var tenant = await ReadAsync(arranged.Db, arranged.Own);
        var anonymous = Controller(arranged.Db, null);

        var brand = Assert.IsType<ApiResponse<PublicBrandDto>>(
            Assert.IsType<OkObjectResult>((await anonymous.GetPublicBrand(tenant.Slug.ToUpperInvariant(), CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(("Carthage", "#3e63dd", "ar"), (brand.Name, brand.Color, brand.Language));
        Assert.Equal(typeof(PublicBrandDto).GetProperties().Select(p => p.Name).Order(),
            new[] { "Color", "Language", "LogoUrl", "Name", "Slug" });
        Assert.IsType<NotFoundObjectResult>((await anonymous.GetPublicBrand("nobody", CancellationToken.None)).Result);

        var logo = Assert.IsType<FileContentResult>(await anonymous.GetLogo(arranged.Own, tenant.LogoVersion!, CancellationToken.None));
        Assert.Equal("image/png", logo.ContentType);
        Assert.Equal("nosniff", anonymous.Response.Headers.XContentTypeOptions.ToString());
        Assert.IsType<NotFoundResult>(await anonymous.GetLogo(arranged.Own, "0000000000000000", CancellationToken.None));
        Assert.IsType<NotFoundResult>(await anonymous.GetLogo(arranged.Other, tenant.LogoVersion!, CancellationToken.None));
    }

    [Fact]
    public async Task A_suspended_or_archived_company_has_no_public_brand()
    {
        var arranged = await SeedAsync();
        await using (var write = TestDbContextFactory.CreateWithoutTenant(arranged.Db))
        {
            (await write.Tenants.SingleAsync(item => item.Id == arranged.Own)).Deactivate();
            (await write.Tenants.SingleAsync(item => item.Id == arranged.Other)).Archive();
            await write.SaveChangesAsync();
        }
        var anonymous = Controller(arranged.Db, null);
        foreach (var id in new[] { arranged.Own, arranged.Other })
        {
            var slug = (await ReadAsync(arranged.Db, id)).Slug;
            Assert.IsType<NotFoundObjectResult>((await anonymous.GetPublicBrand(slug, CancellationToken.None)).Result);
        }
    }

    [Fact]
    public async Task The_email_preview_is_the_real_invitation_in_the_draft_brand_and_language()
    {
        var arranged = await SeedAsync();
        var result = await Controller(arranged.Db, arranged.Own, Manage)
            .EmailPreview(new BrandEmailPreviewRequest("Carthage", "#3e63dd", "ar", true), CancellationToken.None);

        var preview = Assert.IsType<ApiResponse<BrandEmailPreviewDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Contains("dir=\"rtl\"", preview.Html);
        Assert.Contains("background:#3e63dd", preview.Html);
        Assert.Contains($"cid:{preview.LogoContentId}", preview.Html);
        Assert.Contains("Carthage", preview.Subject);
        Assert.Contains("أرسلتها Carthage عبر Fusion", preview.Html);
        Assert.Contains("amira@example.test", preview.Html);
    }
}
