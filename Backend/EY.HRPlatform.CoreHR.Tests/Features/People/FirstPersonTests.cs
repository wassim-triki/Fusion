using System.Security.Claims;
using System.Text;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.CompanyImport;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Xunit;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>
/// B-188 (D-10): "Do you work at …? Yes" makes the activating administrator the company's first person, once, inside
/// their tenant; the company's history brought in afterwards opens the day-one root from when it started.
/// </summary>
public sealed class FirstPersonTests
{
    [RelationalDatabaseFact]
    public async Task The_administrator_becomes_the_first_person_once_and_the_import_opens_the_root_from_its_history()
    {
        await WithDatabaseAsync(async (cs, tenant, other) =>
        {
            var identity = new LinkingIdentity();
            await using (var db = Db(cs, tenant))
            {
                var made = await Service(db, tenant, identity).CreateAsync(
                    new FirstPersonRequest("Amira", "Khelifi", "Chief Technology Officer", "Carthage Digital Group"), "Amira@Carthage.test", "Amira Khelifi", default);
                Assert.True(made.IsSuccess, made.IsFailure ? made.Error.Message : null);
                Assert.True(made.Value.Linked);
                Assert.Equal("Chief Technology Officer", made.Value.JobTitle);
            }

            await using (var db = Db(cs, tenant))
            {
                var amira = await db.Employees.SingleAsync();
                Assert.Equal((amira.Id, "amira@carthage.test", "Link"), identity.Linked.Single());
                var root = await db.OrgUnits.SingleAsync(unit => unit.IsRoot);
                var work = await db.WorkAssignments.SingleAsync(item => item.EmployeeId == amira.Id);
                Assert.Equal(root.Id, work.OrgUnitId);
                Assert.Equal("Carthage Digital Group", (await db.OrgUnitEffectiveStates.SingleAsync(state => state.OrgUnitId == root.Id)).Name);

                // Once: the company has someone now.
                var again = await Service(db, tenant, identity).CreateAsync(
                    new FirstPersonRequest("Sami", "Ben Youssef", "CEO", "Carthage Digital Group"), "sami@carthage.test", "Sami", default);
                Assert.Equal("FirstPerson.CompanyHasPeople", again.Error.Code);
            }

            // Another tenant sees none of it and still makes its own first person.
            await using (var db = Db(cs, other))
            {
                Assert.Equal(0, await db.Employees.CountAsync());
                Assert.Equal(0, await db.OrgUnits.CountAsync());
                var theirs = await Service(db, other, identity).CreateAsync(
                    new FirstPersonRequest("Nour", "Trabelsi", "HR Director", "Solara"), "nour@solara.test", "Nour Trabelsi", default);
                Assert.True(theirs.IsSuccess);
            }

            // The company's files arrive: Amira is matched by email, and the root opens when the company's history starts.
            const string people = """
                Emp No,Full name,Email,Position,Dept,Reports to,Start
                CDG-001,Sami Ben Youssef,sami@carthage.test,Chief Executive Officer,Carthage Digital Group,,07/05/2017
                CDG-002,Amira Khelifi,amira@carthage.test,Chief Technology Officer,Engineering,CDG-001,14/01/2022
                CDG-003,Omar Mansour,omar@carthage.test,"VP, Engineering",Engineering,CDG-002,01/03/2020
                """;
            Guid id;
            var actor = new ImportActor(Guid.NewGuid(), "Amira Khelifi");
            await using (var db = Db(cs, tenant))
                id = await Imports(db, tenant).StartAsync([new(new MemoryStream(Encoding.UTF8.GetBytes(people.Replace("\r\n", "\n"))), "people.csv", "text/csv")],
                    "Carthage Digital Group", actor, default);
            CompanyImportDto read;
            await using (var db = Db(cs, tenant))
                read = await Imports(db, tenant).GetAsync(id, "amira@carthage.test", default);
            foreach (var check in read.Checks.Where(check => check.Answer is null))
            {
                await using var db = Db(cs, tenant);
                var version = (await Imports(db, tenant).GetAsync(id, null, default)).Version;
                await Imports(db, tenant).AnswerAsync(id, version, new AnswerRequest(check.Key, check.Options.FirstOrDefault(option => option.Lean)?.Key ?? check.Options[0].Key), default);
            }
            foreach (var question in read.Questions)
            {
                await using var db = Db(cs, tenant);
                var version = (await Imports(db, tenant).GetAsync(id, null, default)).Version;
                await Imports(db, tenant).AnswerAsync(id, version, new AnswerRequest(question.Key, question.Lean), default);
            }
            await using (var db = Db(cs, tenant))
                read = await Imports(db, tenant).GetAsync(id, null, default);
            Assert.True(read.CanBringIn, string.Join(", ", read.Checks.Where(check => check.Answer is null).Select(check => check.Key)));
            await using (var db = Db(cs, tenant))
                await Imports(db, tenant).BringInAsync(id, read.Version, read.Fingerprint, actor, default);
            await using (var db = Db(cs, tenant))
                await BringIn(db, tenant).ExecuteAsync(id, default);

            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(3, await db.Employees.CountAsync());
                var root = await db.OrgUnits.SingleAsync(unit => unit.IsRoot);
                Assert.Equal(new DateOnly(2017, 5, 7), await db.OrgUnitEffectiveStates.Where(state => state.OrgUnitId == root.Id).MinAsync(state => state.EffectiveFrom));
                var sami = await db.Employees.SingleAsync(item => item.Email == "sami@carthage.test");
                var samiWork = await db.WorkAssignments.SingleAsync(item => item.EmployeeId == sami.Id);
                Assert.Equal(new DateTime(2017, 5, 7), samiWork.EffectiveFrom.Date);
            }
        });
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task Without_organization_and_people_rights_it_is_forbidden(bool organization, bool people)
    {
        var controller = Controller(organization, people, employeeId: null);
        var result = await controller.CreateFirstPerson(new("A", "B", "C", "D"), null!, default);
        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Someone_who_already_has_a_record_here_is_refused()
    {
        var controller = Controller(true, true, employeeId: Guid.NewGuid());
        var result = await controller.CreateFirstPerson(new("A", "B", "C", "D"), null!, default);
        Assert.IsType<ConflictObjectResult>(result);
    }

    private static MeController Controller(bool organization, bool people, Guid? employeeId)
    {
        var access = new Mock<ICoreAccessPolicyService>();
        access.Setup(policy => policy.CanManageOrganization(It.IsAny<ClaimsPrincipal>())).Returns(organization);
        access.Setup(policy => policy.CanManageEmployees(It.IsAny<ClaimsPrincipal>())).Returns(people);
        var claims = new List<Claim> { new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()), new(ClaimTypes.Email, "a@b.test") };
        if (employeeId is { } id) claims.Add(new(CustomClaimTypes.EmployeeId, id.ToString()));
        return new MeController(null!, access.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    private static FirstPersonService Service(CoreHRDbContext db, Guid tenant, IWorkforceAccessIdentityClient identity)
    {
        var context = TestTenantContext.WithTenant(tenant);
        return new FirstPersonService(db, context, new OrganizationService(db, context), new EmployeeNumberAllocatorService(db, context),
            new WorkforceMutationService(db, context, new WorkforceCanonicalResolver(db)), identity);
    }

    private static CompanyImportService Imports(CoreHRDbContext db, Guid tenant)
        => new(db, TestTenantContext.WithTenant(tenant), new CompanyImportReader(new SafeTabularSourceReader(), new NoAi()));

    private static CompanyImportBringIn BringIn(CoreHRDbContext db, Guid tenant)
    {
        var context = TestTenantContext.WithTenant(tenant);
        return new CompanyImportBringIn(db, context, new OrganizationService(db, context),
            new WorkforceMutationService(db, context, new WorkforceCanonicalResolver(db)), new EmployeeNumberAllocatorService(db, context));
    }

    private sealed class NoAi : ICompanyImportAi
    {
        public Task<IReadOnlyDictionary<int, string>> ReadColumnsAsync(CompanyImportKind kind, IReadOnlyList<CompanyImportAiColumn> columns, IReadOnlyCollection<string> taken, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string>());
    }

    /// <summary>Identity's side: records the link and says it's done.</summary>
    private sealed class LinkingIdentity : IWorkforceAccessIdentityClient
    {
        public List<(Guid EmployeeId, string? Email, string Action)> Linked { get; } = [];

        public Task<WorkforceAccessMutationOutcomeResult> MutateAsync(Guid employeeId, string? normalizedWorkEmail, string action, string baseline, CancellationToken cancellationToken)
        {
            Linked.Add((employeeId, normalizedWorkEmail, action));
            return Task.FromResult(new WorkforceAccessMutationOutcomeResult("Ok", "Active", Guid.NewGuid(), 2, "Linked an existing account."));
        }

        public Task<IReadOnlyDictionary<Guid, WorkforceAccessCandidateResult>> ResolveCandidatesAsync(IReadOnlyCollection<WorkforceAccessCandidateSubject> subjects, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<WorkforceAccessCandidateResult> ResolveCandidateAsync(Guid employeeId, string? normalizedWorkEmail, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<WorkforceAccessMutationOutcomeResult> CorrectAsync(Guid sourceEmployeeId, Guid targetEmployeeId, string baseline, string reason, int expectedRevision, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<bool> ResendInviteAsync(Guid employeeId, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<bool> WithdrawInviteAsync(Guid employeeId, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceAccessAuditLine>> GetAuditAsync(Guid employeeId, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IdentityRoleChange?> GetLatestRoleChangeAsync(CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<(bool Ok, string Message)> SuspendAccountAsync(Guid employeeId, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<(bool Ok, string Message)> RestoreAccountAsync(Guid employeeId, CancellationToken cancellationToken) => throw new NotImplementedException();
    }

    private static CoreHRDbContext Db(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task WithDatabaseAsync(Func<string, Guid, Guid, Task> body)
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_first_person_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var admin = new NpgsqlConnectionStringBuilder(baseConnection) { Database = "postgres", Pooling = false }.ConnectionString;
        await Execute(admin, $"CREATE DATABASE \"{name}\"");
        try
        {
            var tenantId = Guid.NewGuid();
            await using (var db = Db(connectionString, tenantId)) await db.Database.MigrateAsync();
            await body(connectionString, tenantId, Guid.NewGuid());
        }
        finally
        {
            await Execute(admin, $"DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)");
        }
    }

    private static async Task Execute(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
