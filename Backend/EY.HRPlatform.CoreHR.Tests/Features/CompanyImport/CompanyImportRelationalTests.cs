using System.Diagnostics;
using System.Text;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.CompanyImport;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace EY.HRPlatform.CoreHR.Tests.Features.CompanyImport;

/// <summary>
/// B-186 on PostgreSQL: one import of two files that resolve against each other, the person's answers and a fix said
/// in words, a fingerprinted bring-in written as dated history, nothing brought in twice, and sessions kept inside
/// their tenant. Set FUSION_COREHR_RELATIONAL_TEST_CONNECTION to run.
/// </summary>
public sealed class CompanyImportRelationalTests(ITestOutputHelper output)
{
    private static readonly ImportActor Amira = new(Guid.NewGuid(), "Amira Khelifi");

    private const string People = """
        Emp No,Full name,Email,Position,Grade,Dept,Reports to,Location,Start,Salary
        CDG-001,Sami Ben Youssef,sami@carthage.test,Chief Executive Officer,E1,CDG,,Tunis,07/05/2017,9400
        CDG-002,Amira Khelifi,amira@carthage.test,Chief Technology Officer,E2,PE,CDG-001,Sousse,14/01/2022,8100
        CDG-003,Omar Mansour,omar@carthage.test,"VP, Engineering",M2,ENG,CDG-002,Tunis,01/03/2020,7000
        CDG-004,Houssem Jaziri,houssem@carthage.test,QA Automation Engineer,L3,ENG,CDG-003,Tunis,15/12/2021,3650
        CDG-005,Mouna Kooli,mouna@carthage.test,QA Automation Eng.,L3,ENG,CDG-003,Ariana,02/02/2022,3600
        CDG-006,Hiba Messaoudi,hiba@carthage.test,Customer Success Manager,L3,PGC,CDG-001,Tunis,03/03/2023,3000
        """;

    private const string Units = """
        Code,Unit,Parent,Type,Head
        CDG,Carthage Digital Group,,Company,CDG-001
        PE,Product & Engineering,CDG,Division,CDG-002
        ENG,Engineering,PE,Department,CDG-003
        PG,People & Growth,CDG,Department,
        """;

    [RelationalDatabaseFact]
    public async Task Two_files_resolve_together_and_bring_in_once_as_dated_history()
    {
        await WithDatabaseAsync(async (cs, tenant) =>
        {
            Guid id;
            await using (var db = Db(cs, tenant))
                id = await Service(db, tenant).StartAsync([Csv("people.csv", People), Csv("units.csv", Units)], "Carthage Digital Group", Amira, default);

            CompanyImportDto read;
            await using (var db = Db(cs, tenant))
                read = await Service(db, tenant).GetAsync(id, "amira@carthage.test", default);
            // What Fusion understood: two files by what they hold; Grade only half-recognised; Salary left out.
            Assert.Equal(["People", "Units"], read.Files.SelectMany(file => file.Sheets).Select(sheet => sheet.Kind).ToArray());
            var question = Assert.Single(read.Questions);
            Assert.Equal(("Grade", CompanyImportFields.JobLevel), (question.Header, question.Lean));
            Assert.Contains(read.LeftOut, item => item.Kind == "column" && item.What == "Salary");
            Assert.True(read.Files[0].Sheets[0].Preview.Single(row => row.Me).Row == 3);
            Assert.False(read.CanBringIn);

            await using (var db = Db(cs, tenant))
                await Service(db, tenant).AnswerAsync(id, read.Version, new AnswerRequest(question.Key, CompanyImportFields.JobLevel), default);
            await using (var db = Db(cs, tenant))
                read = await Service(db, tenant).GetAsync(id, "amira@carthage.test", default);

            // The chart: Hiba's unit isn't in units.csv (PG is closest, by code); two titles look like one job.
            var unit = Assert.Single(read.Checks, check => check.Kind == "unitMissing");
            Assert.Equal(("PGC", "People & Growth"), (unit.Title, unit.Options.Single(option => option.Lean).Label));
            var job = Assert.Single(read.Checks, check => check.Kind == "sameJob");
            Assert.Contains("QA Automation Eng.", job.Title);
            Assert.Equal(5, read.Facts.Single(fact => fact.Kind == "managers").Count);
            Assert.True(read.Chart.People.Single(person => person.Name == "Amira Khelifi").You);

            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                await service.AnswerAsync(id, read.Version, new AnswerRequest(unit.Key, unit.Options.Single(option => option.Lean).Key), default);
            }
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                var version = (await service.GetAsync(id, null, default)).Version;
                await service.AnswerAsync(id, version, new AnswerRequest(job.Key, "merge"), default);
            }

            // A fix said in words, kept beside what the file said.
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                var said = await service.InterpretAsync(id, "Houssem reports to Amira", default);
                Assert.NotNull(said);
                Assert.Equal(("Omar Mansour", "Amira Khelifi"), (said!.From, said.To));
                var version = (await service.GetAsync(id, null, default)).Version;
                await service.AddFixAsync(id, version, new AddFixRequest(said.PersonKey, said.Field, said.Value, "Houssem reports to Amira"), default);
            }
            await using (var db = Db(cs, tenant))
                read = await Service(db, tenant).GetAsync(id, null, default);
            Assert.True(read.CanBringIn, string.Join(", ", read.Checks.Where(check => check.Answer is null).Select(check => check.Key)));
            Assert.Equal(("Omar Mansour", "Amira Khelifi"), (read.Fixes.Single().From, read.Fixes.Single().To));
            Assert.Equal(4, read.Chart.Jobs.Count(item => item.Title != "Chief Executive Officer"));

            // A stale fingerprint is refused; the reviewed one is brought in.
            await using (var db = Db(cs, tenant))
            {
                var refused = await Assert.ThrowsAsync<CompanyImportException>(() => Service(db, tenant).BringInAsync(id, read.Version, "0000", Amira, default));
                Assert.Equal("Changed", refused.Code);
            }
            await using (var db = Db(cs, tenant))
                await Service(db, tenant).BringInAsync(id, read.Version, read.Fingerprint, Amira, default);
            await using (var db = Db(cs, tenant))
                await BringIn(db, tenant).ExecuteAsync(id, default);

            await using (var db = Db(cs, tenant))
            {
                var session = await db.CompanyImportSessions.Include(item => item.Sources).SingleAsync(item => item.Id == id);
                Assert.Equal(CompanyImportStatus.BroughtIn, session.Status);
                Assert.All(session.Sources, source => Assert.Null(source.CellsJson));
                Assert.Equal(4, await db.OrgUnits.CountAsync());
                Assert.Equal("CDG", (await db.OrgUnits.SingleAsync(item => item.IsRoot)).Code);
                Assert.Equal(new DateOnly(2017, 5, 7), await db.OrgUnitEffectiveStates.MinAsync(state => state.EffectiveFrom));
                Assert.Equal(5, await db.Jobs.CountAsync());
                var levels = await db.CompanyListValues.Where(value => value.List == CompanyList.Levels).Select(value => value.Label).ToListAsync();
                Assert.Contains("L3", levels);
                var qa = await db.Jobs.SingleAsync(item => item.Title == "QA Automation Engineer");
                Assert.Equal("L3", levels.Single(label => label == "L3"));
                Assert.NotNull(qa.LevelId);
                Assert.Equal(3, await db.Places.CountAsync());
                Assert.Equal(6, await db.Employees.CountAsync());
                var houssem = await db.Employees.SingleAsync(item => item.EmployeeNumber == "CDG-004");
                var amira = await db.Employees.SingleAsync(item => item.EmployeeNumber == "CDG-002");
                var line = await db.ManagerRelationships.SingleAsync(item => item.SubjectEmployeeId == houssem.Id && item.EffectiveTo == null);
                Assert.Equal(amira.Id, line.ManagerEmployeeId);
                Assert.Equal(new DateTime(2022, 1, 14), line.EffectiveFrom.Date);
                Assert.Equal(5, await db.ManagerRelationships.CountAsync(item => item.ImportBatchId == id));
                var hiba = await db.Employees.SingleAsync(item => item.EmployeeNumber == "CDG-006");
                var hibaWork = await db.WorkAssignments.SingleAsync(item => item.EmployeeId == hiba.Id);
                Assert.Equal((await db.OrgUnits.SingleAsync(item => item.Code == "PG")).Id, hibaWork.OrgUnitId);
                Assert.Equal(new DateTime(2023, 3, 3), hibaWork.EffectiveFrom.Date);

                // Running the worker again on a finished import writes nothing more.
                await BringIn(db, tenant).ExecuteAsync(id, default);
                Assert.Equal(6, await db.Employees.CountAsync());
            }

            // The same files again: everyone is already in Fusion, so there's nothing to bring in (updates are B-187).
            await using (var db = Db(cs, tenant))
            {
                var again = await Service(db, tenant).StartAsync([Csv("people.csv", People)], "Carthage Digital Group", Amira, default);
                var second = await Service(db, tenant).GetAsync(again, null, default);
                Assert.Equal(6, second.LeftOut.Single(item => item.Kind == "already").Count);
                Assert.Empty(second.Chart.People);
                Assert.False(second.CanBringIn);
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task A_company_change_after_review_stops_the_bring_in_and_another_tenant_never_sees_the_import()
    {
        await WithDatabaseAsync(async (cs, tenant) =>
        {
            var other = Guid.NewGuid();
            Guid id;
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                id = await service.StartAsync([Csv("people.csv", "Name,Email,Title,Department,Manager,Start\nNour Ben Ali,nour@x.test,Designer,Design,,2024-01-02\nRim Saidi,rim@x.test,Designer,Design,Nour Ben Ali,2024-02-03\n")], "Acme", Amira, default);
                var read = await service.GetAsync(id, null, default);
                Assert.True(read.CanBringIn);
                Assert.Equal(1, read.Facts.Single(fact => fact.Kind == "managers").Count);
                await service.BringInAsync(id, read.Version, read.Fingerprint, Amira, default);
            }

            await using (var db = Db(cs, other))
            {
                var hidden = await Assert.ThrowsAsync<CompanyImportException>(() => Service(db, other).GetAsync(id, null, default));
                Assert.Equal(404, hidden.Status);
                Assert.Null(await Service(db, other).ActiveAsync(default));
                Assert.Empty(await db.CompanyImportSessions.ToListAsync());
            }

            // Someone adds the job the files name before the worker runs: the reviewed proposal no longer holds.
            await using (var db = Db(cs, tenant))
            {
                db.Jobs.Add(Job.Create(tenant, "Designer", null, null, "test"));
                await db.SaveChangesAsync();
                await Assert.ThrowsAsync<CompanyImportChangedException>(() => BringIn(db, tenant).ExecuteAsync(id, default));
            }
            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(0, await db.Employees.CountAsync());
                Assert.Equal(0, await db.OrgUnits.CountAsync());
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task Scale_two_thousand_people_in_eighty_units()
    {
        await WithDatabaseAsync(async (cs, tenant) =>
        {
            const int peopleCount = 2000, unitCount = 80;
            var units = new StringBuilder("Code,Name,Parent\nROOT,Scale Co,\n");
            for (var u = 1; u < unitCount; u++) units.Append($"U{u},Unit {u},{(u <= 8 ? "ROOT" : $"U{(u % 8) + 1}")}\n");
            var people = new StringBuilder("Employee number,First name,Last name,Work email,Job title,Unit,Manager,Location,Start date\n");
            for (var p = 1; p <= peopleCount; p++)
            {
                var manager = p == 1 ? "" : $"E{(p - 1) / 8 + 1}";
                people.Append($"E{p},First{p},Last{p},p{p}@scale.test,Title {p % 60},{(p == 1 ? "ROOT" : $"U{p % (unitCount - 1) + 1}")},{manager},City {p % 7},2020-01-{p % 28 + 1:00}\n");
            }

            var clock = Stopwatch.StartNew();
            Guid id;
            CompanyImportDto read;
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                id = await service.StartAsync([Csv("people.csv", people.ToString()), Csv("units.csv", units.ToString())], "Scale Co", Amira, default);
                read = await service.GetAsync(id, null, default);
            }
            var understood = clock.Elapsed;
            Assert.True(read.CanBringIn, string.Join(", ", read.Checks.Select(check => check.Key).Take(5)));
            Assert.Equal(peopleCount, read.Counts.People);

            clock.Restart();
            await using (var db = Db(cs, tenant))
                await Service(db, tenant).BringInAsync(id, read.Version, read.Fingerprint, Amira, default);
            await using (var db = Db(cs, tenant))
                await BringIn(db, tenant).ExecuteAsync(id, default);
            var broughtIn = clock.Elapsed;
            output.WriteLine($"Scale: {peopleCount} people, {unitCount} units. Read and derived in {understood.TotalSeconds:0.0}s, brought in in {broughtIn.TotalSeconds:0.0}s.");

            await using (var check = Db(cs, tenant))
            {
                Assert.Equal(peopleCount, await check.Employees.CountAsync());
                Assert.Equal(unitCount, await check.OrgUnits.CountAsync());
                Assert.Equal(peopleCount - 1, await check.ManagerRelationships.CountAsync(item => item.EffectiveTo == null));
            }
            Assert.True(understood < TimeSpan.FromSeconds(20), $"Reading took {understood}.");
            Assert.True(broughtIn < TimeSpan.FromMinutes(3), $"Bringing in took {broughtIn}.");
        });
    }

    private static CompanyImportUpload Csv(string name, string text)
        => new(new MemoryStream(Encoding.UTF8.GetBytes(text.Replace("\r\n", "\n"))), name, "text/csv");

    private static CompanyImportService Service(CoreHRDbContext db, Guid tenant)
        => new(db, TestTenantContext.WithTenant(tenant), new CompanyImportReader(new SafeTabularSourceReader(), new NoAi()), new CompanyImportProgress());

    private static CompanyImportBringIn BringIn(CoreHRDbContext db, Guid tenant)
    {
        var context = TestTenantContext.WithTenant(tenant);
        return new CompanyImportBringIn(db, context, new OrganizationService(db, context),
            new WorkforceMutationService(db, context, new WorkforceCanonicalResolver(db)), new EmployeeNumberAllocatorService(db, context), new CompanyImportProgress());
    }

    private sealed class NoAi : ICompanyImportAi
    {
        public Task<IReadOnlyDictionary<int, string>> ReadColumnsAsync(CompanyImportKind kind, IReadOnlyList<CompanyImportAiColumn> columns, IReadOnlyCollection<string> taken, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string>());
    }

    private static CoreHRDbContext Db(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task WithDatabaseAsync(Func<string, Guid, Task> body)
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_company_import_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var admin = new NpgsqlConnectionStringBuilder(baseConnection) { Database = "postgres", Pooling = false }.ConnectionString;
        await Execute(admin, $"CREATE DATABASE \"{name}\"");
        try
        {
            var tenantId = Guid.NewGuid();
            await using (var db = Db(connectionString, tenantId)) await db.Database.MigrateAsync();
            await body(connectionString, tenantId);
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
