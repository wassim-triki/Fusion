using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.Membership;
using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Tests.Features.TenantAdministration;

/// <summary>
/// B-178 on the server: adding an administrator asks for the caller's password and takes only people who already sign
/// in to this company; seeing Fusion as someone is for administrators, inside their own company, and recorded.
/// </summary>
public sealed class AdministratorsAndViewAsTests : IAsyncLifetime
{
    private const string AdminPassword = "Bootstrap@123456";
    private const string MemberPassword = "Member@123456";
    private readonly RelationalTestDatabase _databases = new();
    private bool Available => _databases.Available;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync() => _databases.DisposeAsync().AsTask();

    // ── Adding an administrator ──────────────────────────

    [SkippableFact]
    public async Task Adding_an_administrator_asks_for_the_callers_own_password()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var wrong = await Administrators(world, Admin(world)).AddAdministrator(new AddAdministratorRequest(world.Member.Id, "not-it"), default);
        var none = await Administrators(world, Admin(world)).AddAdministrator(new AddAdministratorRequest(world.Member.Id, null), default);
        Assert.Equal((403, "password-incorrect"), Problem(wrong));
        Assert.Equal((403, "password-incorrect"), Problem(none));
        Assert.False(await IsAdministratorAsync(world, world.Member.Id));

        var added = await Administrators(world, Admin(world)).AddAdministrator(new AddAdministratorRequest(world.Member.Id, AdminPassword), default);
        Assert.IsType<OkObjectResult>(added);
        Assert.True(await IsAdministratorAsync(world, world.Member.Id));

        // Every grant is kept, and says who made it.
        var history = await new TenantAccessProjection(world.Db).GetAdministratorHistoryAsync(world.TenantId);
        Assert.Contains(history, item => item.Kind == AdministratorOrigins.Administrator && item.PersonName == "Mo Member" && item.ActorName == "Ada Admin");
    }

    [SkippableFact]
    public async Task Only_people_who_already_sign_in_to_this_company_can_be_added()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        var users = RelationalTestDatabase.CreateUserManager(world.Db);

        // Someone in another company, someone without a password yet, someone unknown, and Fusion's own staff.
        var other = Tenant.Create("Elsewhere");
        world.Db.Tenants.Add(other);
        await world.Db.SaveChangesAsync();
        var foreign = await AddMemberAsync(world.Db, users, other.Id, "foreign@elsewhere.example", "Fay", MemberPassword);
        var noPassword = await AddMemberAsync(world.Db, users, world.TenantId, "new@atlas.example", "Neo", password: null);
        var operatorAccount = await AddMemberAsync(world.Db, users, world.TenantId, "operator@fusion.example", "Op", MemberPassword);
        if (!await world.Db.Roles.AnyAsync(role => role.Name == PlatformRole.PlatformAdmin))
        {
            world.Db.Roles.Add(new IdentityRole<Guid>
            {
                Id = Guid.NewGuid(), Name = PlatformRole.PlatformAdmin, NormalizedName = PlatformRole.PlatformAdmin.ToUpperInvariant(),
            });
            await world.Db.SaveChangesAsync();
        }
        Assert.True((await users.AddToRoleAsync(operatorAccount, PlatformRole.PlatformAdmin)).Succeeded);

        foreach (var userId in new[] { foreign.Id, noPassword.Id, Guid.NewGuid(), operatorAccount.Id })
        {
            var result = await Administrators(world, Admin(world)).AddAdministrator(new AddAdministratorRequest(userId, AdminPassword), default);
            Assert.Equal((409, "not-eligible"), Problem(result));
            Assert.False(await IsAdministratorAsync(world, userId));
        }

        var candidates = await new TenantAccessProjection(world.Db).GetAdministratorCandidatesAsync(world.TenantId, null);
        Assert.DoesNotContain(candidates, candidate => candidate.UserId == foreign.Id || candidate.UserId == operatorAccount.Id);
        Assert.Contains(candidates, candidate => candidate.UserId == noPassword.Id && !candidate.SignsIn);
        Assert.Contains(candidates, candidate => candidate.UserId == world.Member.Id && candidate.SignsIn);
        Assert.DoesNotContain(candidates, candidate => candidate.UserId == world.AdminId);
    }

    [SkippableFact]
    public async Task Someone_who_doesnt_administer_the_company_cannot_add_or_list_candidates()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        var member = Member(world, world.Member);

        var added = await Administrators(world, member).AddAdministrator(new AddAdministratorRequest(world.Member.Id, MemberPassword), default);
        var candidates = await Administrators(world, member).Candidates(null, default);

        Assert.Equal((403, "permission-denied"), Problem(added));
        Assert.Equal((403, "permission-denied"), Problem(candidates));
        Assert.False(await IsAdministratorAsync(world, world.Member.Id));
    }

    // ── Seeing Fusion as someone ─────────────────────────

    [SkippableFact]
    public async Task An_administrator_sees_Fusion_as_someone_and_the_view_is_recorded_and_ends()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var started = await ViewAs(world, Admin(world)).Start(new StartViewAsRequest(world.Member.Id), default);
        var view = Assert.IsType<Models.Responses.ApiResponse<ViewAsSessionDto>>(Assert.IsType<OkObjectResult>(started.Result).Value).Data!;

        Assert.Equal("Mo Member", view.PersonName);
        Assert.Equal(world.Member.Id, view.Session.UserId);
        Assert.Equal(string.Empty, view.Session.RefreshToken);
        Assert.Contains(await world.Db.AccessAuditEvents.IgnoreQueryFilters().ToListAsync(),
            item => item.Action == AccessAuditActions.SeenAs && item.ActorUserId == world.AdminId && item.AfterJson!.Contains("Mo Member"));

        // Ending it is the person's token's one change.
        var asThem = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, world.Member.Id.ToString()),
            new Claim(CustomClaimTypes.ViewSession, view.SessionId.ToString()),
        ], "test"));
        Assert.IsType<OkObjectResult>(await ViewAs(world, asThem).End(default));
        world.Db.ChangeTracker.Clear();
        Assert.NotNull((await world.Db.ViewAsSessions.IgnoreQueryFilters().SingleAsync(item => item.Id == view.SessionId)).EndedAt);
    }

    [SkippableFact]
    public async Task Seeing_as_someone_is_for_administrators_inside_their_own_company()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        var users = RelationalTestDatabase.CreateUserManager(world.Db);
        var other = Tenant.Create("Elsewhere");
        world.Db.Tenants.Add(other);
        await world.Db.SaveChangesAsync();
        var foreign = await AddMemberAsync(world.Db, users, other.Id, "foreign@elsewhere.example", "Fay", MemberPassword);

        var byMember = await ViewAs(world, Member(world, world.Member)).Start(new StartViewAsRequest(world.AdminId), default);
        var asSelf = await ViewAs(world, Admin(world)).Start(new StartViewAsRequest(world.AdminId), default);
        var acrossCompanies = await ViewAs(world, Admin(world)).Start(new StartViewAsRequest(foreign.Id), default);

        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(byMember.Result).StatusCode);
        Assert.IsType<BadRequestObjectResult>(asSelf.Result);
        Assert.IsType<NotFoundObjectResult>(acrossCompanies.Result);
        Assert.Empty(await world.Db.ViewAsSessions.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task A_view_token_may_read_and_end_itself_but_change_nothing()
    {
        var viewer = new ClaimsPrincipal(new ClaimsIdentity([new Claim(CustomClaimTypes.ViewSession, Guid.NewGuid().ToString())], "test"));
        async Task<int> Send(string method, string path, ClaimsPrincipal user)
        {
            var reached = false;
            var context = new DefaultHttpContext { User = user };
            context.Request.Method = method;
            context.Request.Path = path;
            context.Response.Body = new MemoryStream();
            await new ReadOnlyViewMiddleware(_ => { reached = true; return Task.CompletedTask; }).InvokeAsync(context);
            return reached ? 200 : context.Response.StatusCode;
        }

        Assert.Equal(200, await Send("GET", "/api/corehr/workforce/me", viewer));
        Assert.Equal(200, await Send("POST", ReadOnlyViewMiddleware.EndPath, viewer));
        Assert.Equal(403, await Send("POST", "/api/identity/auth/logout", viewer));
        Assert.Equal(403, await Send("PUT", "/api/identity/account/language", viewer));
        Assert.Equal(403, await Send("DELETE", "/api/identity/core-access/roles/x", viewer));
        Assert.Equal(403, await Send("POST", "/api/identity/view-as", viewer));
        // Anyone else is untouched.
        Assert.Equal(200, await Send("POST", "/api/identity/view-as", new ClaimsPrincipal(new ClaimsIdentity())));
    }

    // ── plumbing ─────────────────────────────────────────

    private sealed record World(AppIdentityDbContext Db, Guid TenantId, Guid AdminId, ApplicationUser Member);

    private ClaimsPrincipal Admin(World world) => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, world.AdminId.ToString()),
        new Claim(CustomClaimTypes.TenantId, world.TenantId.ToString()),
        new Claim(CustomClaimTypes.FullName, "Ada Admin"),
        new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant)),
    ], "test"));

    private static ClaimsPrincipal Member(World world, ApplicationUser member) => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, member.Id.ToString()),
        new Claim(CustomClaimTypes.TenantId, world.TenantId.ToString()),
        new Claim(CustomClaimTypes.FullName, member.FullName),
    ], "test"));

    private static TenantAccessController Administrators(World world, ClaimsPrincipal user)
    {
        world.Db.ChangeTracker.Clear();
        return new TenantAccessController(
            new TenantAccessProjection(world.Db),
            new TenantAdministratorLifecycleService(world.Db, new TenantContinuityCommandExecutor(world.Db)),
            world.Db,
            RelationalTestDatabase.CreateUserManager(world.Db),
            TestTenantContext.WithTenant(world.TenantId))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } },
        };
    }

    private static ViewAsController ViewAs(World world, ClaimsPrincipal user)
    {
        world.Db.ChangeTracker.Clear();
        var users = RelationalTestDatabase.CreateUserManager(world.Db);
        var accessProfiles = new AccessProfileService(world.Db, users);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Secret"] = "administrators-and-view-as-test-signing-key-long-enough",
            ["Jwt:Issuer"] = "fusion-test",
            ["Jwt:Audience"] = "fusion-test",
            ["Jwt:ExpirationInMinutes"] = "60",
            ["Jwt:RefreshTokenExpirationInDays"] = "7",
        }).Build();
        var context = new CustomerContextResolver(world.Db, users);
        var sessions = new AuthSessionFactory(users, new TokenService(configuration, users, accessProfiles, context),
            accessProfiles, world.Db, configuration, context);
        return new ViewAsController(world.Db, sessions, new NoRoles(), TestTenantContext.WithTenant(world.TenantId))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } },
        };
    }

    private static (int Status, string? Code) Problem(IActionResult result)
    {
        var problem = Assert.IsType<ObjectResult>(result);
        var json = JsonSerializer.Serialize(problem.Value);
        using var document = JsonDocument.Parse(json);
        var code = document.RootElement.TryGetProperty("Details", out var details) && details.ValueKind == JsonValueKind.Object
            && details.TryGetProperty("code", out var value) ? value.GetString() : null;
        return (problem.StatusCode ?? 0, code);
    }

    private static (int Status, string? Code) Problem<T>(ActionResult<T> result) => Problem((IActionResult)result.Result!);

    private static Task<bool> IsAdministratorAsync(World world, Guid userId)
    {
        world.Db.ChangeTracker.Clear();
        return world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .AnyAsync(item => item.TenantId == world.TenantId && item.UserId == userId && item.RevokedAt == null);
    }

    private static async Task<ApplicationUser> AddMemberAsync(
        AppIdentityDbContext db, UserManager<ApplicationUser> users, Guid tenantId, string email, string firstName, string? password)
    {
        var account = new ApplicationUser
        {
            Id = Guid.NewGuid(), UserName = email, Email = email,
            FirstName = firstName, LastName = "Member", IsActive = true, EmailConfirmed = true,
        };
        Assert.True((password is null ? await users.CreateAsync(account) : await users.CreateAsync(account, password)).Succeeded);
        db.TenantMemberships.Add(TenantMembership.Create(account.Id, tenantId));
        await db.SaveChangesAsync();
        return account;
    }

    /// <summary>A provisioned, activated company with its first administrator (Ada) and one member who signs in (Mo).</summary>
    private async Task<World> ArrangeAsync()
    {
        var db = await _databases.CreateAsync("fusion_admins");
        var bootstrap = new CapturingBootstrapDelivery();
        var provisioned = await new TenantProvisioningService(db, bootstrap).ProvisionAsync(
            new ProvisionTenantRequest
            {
                Name = "Atlas Group",
                TimeZone = "Europe/Paris",
                AdministratorEmail = "first.admin@atlas.example",
                IdempotencyKey = $"admins-{Guid.NewGuid():N}",
            },
            Guid.NewGuid());
        Assert.True(provisioned.IsSuccess);
        db.ChangeTracker.Clear();

        var users = RelationalTestDatabase.CreateUserManager(db);
        var activation = await new BootstrapActivationService(db, users, new AccessProfileService(db, users))
            .ActivateAsync(new BootstrapActivationRequest
            {
                Credential = bootstrap.Credential!.RawValue,
                Email = "first.admin@atlas.example",
                Password = AdminPassword,
                FirstName = "Ada",
                LastName = "Admin",
            });
        Assert.Equal(BootstrapActivationOutcome.Activated, activation.Outcome);
        db.ChangeTracker.Clear();

        var tenantId = provisioned.Value.TenantId;
        var member = await AddMemberAsync(db, users, tenantId, "mo@atlas.example", "Mo", MemberPassword);
        return new World(db, tenantId, activation.AccountId!.Value, member);
    }

    private sealed class CapturingBootstrapDelivery : IBootstrapInvitationDelivery
    {
        public BootstrapCredential? Credential { get; private set; }

        public Task DeliverAsync(Guid invitationId, string email, BootstrapCredential credential,
            Guid initiatedByAccountId, CancellationToken cancellationToken = default)
        {
            Credential = credential;
            return Task.CompletedTask;
        }
    }

    private sealed class NoRoles : IRoleService
    {
        public Task<RolesOverviewDto> GetOverviewAsync(Guid tenantId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<RoleDetailDto> GetRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<RoleDetailDto> CreateRoleAsync(Guid tenantId, CreateRoleRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<RoleDetailDto> SaveRoleAsync(Guid tenantId, Guid roleId, uint expectedVersion, SaveRoleRequest request, CancellationToken cancellationToken)
            => throw new NotSupportedException();
        public Task DeleteRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<IReadOnlyList<PersonRoleDto>?> GetPersonRolesAsync(Guid tenantId, Guid employeeId, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<PersonRoleDto>?>([]);
        public Task<IReadOnlyList<RoleCandidateDto>> FindCandidatesAsync(Guid tenantId, string? search, CancellationToken cancellationToken)
            => throw new NotSupportedException();
    }
}
