using System.Diagnostics;
using System.Text;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.CompanyImport;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.SharedKernel.Imports;
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

            // The same file again: everyone is matched by number and nothing changes, so there's nothing to bring in.
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                var same = await service.StartAsync([Csv("people.csv", People)], "Carthage Digital Group", Amira, default);
                var read2 = await service.GetAsync(same, null, default);
                Assert.NotNull(read2.Again);
                Assert.Equal(("number", 6, 0), (read2.Again!.MatchedBy, read2.Again.Unchanged + read2.Again.Changed.Count, read2.Again.New.Count));
                await service.DiscardAsync(same, read2.Version, default);
            }

            // A changed file a week later: Mouna moves and takes a new job, Malek joins, Hiba isn't in the file.
            var applyFrom = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5);
            var changed = People.Replace("CDG-005,Mouna Kooli,mouna@carthage.test,QA Automation Eng.,L3,ENG,CDG-003,Ariana", "CDG-005,Mouna Kooli,mouna@carthage.test,QA Lead,L4,PE,CDG-002,Tunis")
                .Replace("CDG-006,Hiba Messaoudi,hiba@carthage.test,Customer Success Manager,L3,PGC,CDG-001,Tunis,03/03/2023,3000", "CDG-007,Malek Ferjani,malek@carthage.test,Data Engineer,L2,ENG,CDG-003,Tunis,01/12/2026,3000");
            Guid secondId;
            await using (var db = Db(cs, tenant))
                secondId = await Service(db, tenant).StartAsync([Csv("people-december.csv", changed)], "Carthage Digital Group", Amira, default);
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                var again = (await service.GetAsync(secondId, null, default)).Again!;
                Assert.Equal("Malek Ferjani", Assert.Single(again.New).Name);
                // Houssem's earlier fix said Amira; the file still says Omar, so that's a change too.
                Assert.Equal(["Houssem Jaziri", "Mouna Kooli"], again.Changed.Select(item => item.Name).Order().ToArray());
                Assert.Equal(("Amira Khelifi", "Omar Mansour"), again.Changed.Single(item => item.Name == "Houssem Jaziri").Changes.Select(change => (change.From, change.To)).Single());
                var mouna = again.Changed.Single(item => item.Name == "Mouna Kooli");
                Assert.Contains(mouna.Changes, change => change.Field == CompanyImportFields.JobTitle && change.To == "QA Lead");
                Assert.Contains(mouna.Changes, change => change.Field == CompanyImportFields.Unit && change.From == "Engineering" && change.To == "Product & Engineering");
                Assert.Contains(mouna.Changes, change => change.Field == CompanyImportFields.Manager && change.To == "Amira Khelifi");
                var hiba = Assert.Single(again.NotInFile);
                Assert.Equal(("Hiba Messaoudi", (string?)null), (hiba.Name, hiba.Answer));
                var version = (await service.GetAsync(secondId, null, default)).Version;
                await service.AnswerAsync(secondId, version, new AnswerRequest(hiba.Key, "end"), default);
            }
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                var version = (await service.GetAsync(secondId, null, default)).Version;
                await service.AnswerAsync(secondId, version, new AnswerRequest(CompanyImportDerivation.ApplyFromKey, applyFrom.ToString("yyyy-MM-dd")), default);
                version = (await service.GetAsync(secondId, null, default)).Version;
                await service.TakeLeansAsync(secondId, version, default);
                var ready = await service.GetAsync(secondId, null, default);
                Assert.True(ready.CanBringIn, string.Join(", ", ready.Checks.Where(check => check.Answer is null).Select(check => check.Key)));
                Assert.Equal((1, 2, 1), (ready.Counts.NewPeople, ready.Counts.Changed, ready.Counts.Ending));
                await service.BringInAsync(secondId, ready.Version, ready.Fingerprint, Amira, default);
            }
            await using (var db = Db(cs, tenant))
                await BringIn(db, tenant).ExecuteAsync(secondId, default);
            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(CompanyImportStatus.BroughtIn, (await db.CompanyImportSessions.SingleAsync(item => item.Id == secondId)).Status);
                Assert.Equal(7, await db.Employees.CountAsync());
                var mouna = await db.Employees.SingleAsync(item => item.EmployeeNumber == "CDG-005");
                var work = await db.WorkAssignments.Where(item => item.EmployeeId == mouna.Id).OrderBy(item => item.EffectiveFrom).ToListAsync();
                Assert.Equal(2, work.Count);
                var on = applyFrom.ToDateTime(TimeOnly.MinValue);
                Assert.Equal(on, work[0].EffectiveTo);
                Assert.Equal((on, (await db.OrgUnits.SingleAsync(item => item.Code == "PE")).Id), (work[1].EffectiveFrom, work[1].OrgUnitId));
                Assert.Equal("QA Lead", (await db.Jobs.SingleAsync(item => item.Id == work[1].JobId)).Title);
                var amira = await db.Employees.SingleAsync(item => item.EmployeeNumber == "CDG-002");
                var line = await db.ManagerRelationships.SingleAsync(item => item.SubjectEmployeeId == mouna.Id && item.EffectiveTo == null);
                Assert.Equal((amira.Id, on), (line.ManagerEmployeeId, line.EffectiveFrom));
                var hiba = await db.Employees.SingleAsync(item => item.EmployeeNumber == "CDG-006");
                Assert.Equal(on, (await db.Employments.SingleAsync(item => item.EmployeeId == hiba.Id)).EffectiveTo);
                Assert.Equal(1, await db.Employees.CountAsync(item => item.EmployeeNumber == "CDG-007"));
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task A_bring_in_cut_off_or_stopped_partway_resumes_without_doubling_anyone()
    {
        await WithDatabaseAsync(async (cs, tenant) =>
        {
            const int count = 60;
            var people = new StringBuilder("Employee number,First name,Last name,Work email,Job title,Unit,Manager,Start date\n");
            for (var p = 1; p <= count; p++) people.Append($"E{p},First{p},Last{p},p{p}@resume.test,Engineer,Lab,{(p == 1 ? "" : "E1")},2024-01-02\n");
            Guid id;
            await using (var db = Db(cs, tenant))
            {
                var service = Service(db, tenant);
                id = await service.StartAsync([Csv("people.csv", people.ToString())], "Resume Co", Amira, default);
                var read = await service.GetAsync(id, null, default);
                await service.BringInAsync(id, read.Version, read.Fingerprint, Amira, default);
            }
            // The plan and one batch of people, then the run is cut off; a worker picks it up and does one more.
            await using (var db = Db(cs, tenant))
                Assert.False(await BringIn(db, tenant).ExecuteAsync(id, default, batches: 2));
            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(CompanyImportBringIn.PeoplePerBatch, await db.Employees.CountAsync());
                Assert.False(await BringIn(db, tenant).ExecuteAsync(id, default, batches: 1));
                Assert.Equal(2 * CompanyImportBringIn.PeoplePerBatch, await db.Employees.CountAsync());
                // Then a batch fails: the import stops partway, with what's in kept.
                var session = await db.CompanyImportSessions.SingleAsync(item => item.Id == id);
                session.StopBringIn("failed");
                await db.SaveChangesAsync();
            }
            CompanyImportDto stopped;
            await using (var db = Db(cs, tenant))
                stopped = await Service(db, tenant).GetAsync(id, null, default);
            Assert.Equal("Stopped", stopped.Status);
            Assert.Equal((50, 10, true, 52), (stopped.Stopped!.People, stopped.Stopped.PeopleLeft, stopped.Stopped.LinesLeft, stopped.Stopped.Row!.Value));

            // Another tenant can't try it again.
            await using (var db = Db(cs, Guid.NewGuid()))
                Assert.Equal(404, (await Assert.ThrowsAsync<CompanyImportException>(() => Service(db, Guid.NewGuid()).ResumeAsync(id, stopped.Version, Amira, default))).Status);

            await using (var db = Db(cs, tenant))
                await Service(db, tenant).ResumeAsync(id, stopped.Version, Amira, default);
            await using (var db = Db(cs, tenant))
            {
                Assert.True(await BringIn(db, tenant).ExecuteAsync(id, default));
                Assert.True(await BringIn(db, tenant).ExecuteAsync(id, default));
            }
            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(CompanyImportStatus.BroughtIn, (await db.CompanyImportSessions.SingleAsync(item => item.Id == id)).Status);
                Assert.Equal(count, await db.Employees.CountAsync());
                Assert.Equal(count, await db.Employees.Select(item => item.EmployeeNumber).Distinct().CountAsync());
                Assert.Equal(count, await db.WorkAssignments.CountAsync());
                Assert.Equal(count - 1, await db.ManagerRelationships.CountAsync());
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task Files_that_cant_be_used_say_why_and_a_missing_manager_column_is_one_question()
    {
        await WithDatabaseAsync(async (cs, tenant) =>
        {
            await using var db = Db(cs, tenant);
            var service = Service(db, tenant);
            var id = await service.StartAsync([
                Csv("payroll.pdf", "%PDF-1.4"), Csv("units.csv", "Code,Unit,Parent\n"), Csv("notes.csv", "Topic,Owner\nBudget,Sami\n"),
                Csv("people.csv", "Name,Email,Title,Department,Start\nNour Ben Ali,nour@x.test,Designer,Design,2024-01-02\nRim Saidi,rim@x.test,Designer,Design,2024-02-03\n"),
            ], "Acme", Amira, default);
            var read = await service.GetAsync(id, null, default);
            Assert.Equal(new string?[] { "format", "empty", "nothing", null }, read.Files.Select(file => file.Problem).ToArray());
            var question = Assert.Single(read.Questions, item => item.Kind == "noManagers");
            Assert.False(read.CanBringIn);
            await service.AnswerAsync(id, read.Version, new AnswerRequest(question.Key, "without"), default);
            Assert.True((await service.GetAsync(id, null, default)).CanBringIn);
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
