using System.Text;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.CompanyImport;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

public sealed partial class FirstPersonTests
{
    private static readonly ImportActor Importer = new(Guid.NewGuid(), "Test administrator");
    private const string HistoricalStart = "2020-01-02";

    private static async Task<CompanyImportDto> FirstImport(CoreHRDbContext db, Guid tenant, string? date = HistoricalStart, bool report = true)
    {
        var csv = $"Name,Email,Title,Department,Manager,Start date\nAmira Khelifi,amira@first.test,Director,First Co,,{date}\n"
            + (report ? "Nour Trabelsi,nour@first.test,Engineer,First Co,amira@first.test,2021-02-03\n" : "");
        var id = await Imports(db, tenant).StartAsync([new(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "people.csv", "text/csv")],
            "First Co", Importer, default);
        await Imports(db, tenant).TakeLeansAsync(id, (await Imports(db, tenant).GetAsync(id, null, default)).Version, default);
        return await Imports(db, tenant).GetAsync(id, null, default);
    }

    private static async Task CreateFirst(CoreHRDbContext db, Guid tenant)
    {
        var result = await Service(db, tenant, new LinkingIdentity()).CreateAsync(new("Amira", "Khelifi", "Director", "First Co"),
            "amira@first.test", "Test administrator", default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    private static async Task<CompanyImportDto> ChooseFile(CoreHRDbContext db, Guid tenant, CompanyImportDto read)
    {
        var offer = Assert.Single(read.Checks, check => check.Kind == "firstPersonStart");
        await Imports(db, tenant).AnswerAsync(read.Id, read.Version, new(offer.Key, "file"), default);
        return await Imports(db, tenant).GetAsync(read.Id, null, default);
    }

    [RelationalDatabaseFact]
    public async Task Earlier_start_is_explicit_kept_by_default_and_corrects_tenure_work_and_dated_reports_once()
    {
        await WithDatabaseAsync(async (cs, tenant, other) =>
        {
            await using (var db = Db(cs, tenant)) await CreateFirst(db, tenant);
            CompanyImportDto read;
            await using (var db = Db(cs, tenant))
            {
                read = await FirstImport(db, tenant);
                var offer = Assert.Single(read.Checks, check => check.Kind == "firstPersonStart");
                Assert.Equal("keep", offer.Answer);
                Assert.True(offer.Options.Single(option => option.Key == "keep").Lean);
                Assert.DoesNotContain(read.Again!.Changed, person => person.Changes.Any(change => change.Field == "startDate"));
                read = await ChooseFile(db, tenant, read);
                Assert.Contains(Assert.Single(read.Again!.Changed).Changes, change => change.Field == "startDate" && change.To == HistoricalStart);
                Assert.True(read.CanBringIn);
                await Imports(db, tenant).BringInAsync(read.Id, read.Version, read.Fingerprint, Importer, default);
            }
            // Batch zero corrects the two original rows atomically with the plan. A stopped worker resumes it.
            await using (var db = Db(cs, tenant)) Assert.False(await BringIn(db, tenant).ExecuteAsync(read.Id, default, 1));
            await using (var db = Db(cs, tenant))
            {
                var session = await db.CompanyImportSessions.SingleAsync(row => row.Id == read.Id);
                session.StopBringIn("failed");
                (await db.Employees.SingleAsync()).SetAbout("Edited after the plan was frozen");
                await db.SaveChangesAsync();
                await Imports(db, tenant).ResumeAsync(read.Id, session.Version, Importer, default);
            }
            await using (var db = Db(cs, tenant))
            {
                Assert.True(await BringIn(db, tenant).ExecuteAsync(read.Id, default));
                Assert.True(await BringIn(db, tenant).ExecuteAsync(read.Id, default));
                var first = await db.Employees.SingleAsync(row => row.Email == "amira@first.test");
                var tenure = await db.Employments.SingleAsync(row => row.EmployeeId == first.Id);
                var work = await db.WorkAssignments.SingleAsync(row => row.EmployeeId == first.Id);
                Assert.Equal(DateTime.Parse(HistoricalStart).Date, tenure.EffectiveFrom.Date);
                Assert.Equal(tenure.EffectiveFrom, work.EffectiveFrom);
                Assert.Null(tenure.EffectiveTo);
                Assert.Null(work.EffectiveTo);
                Assert.Equal("Edited after the plan was frozen", first.About);
                var line = await db.ManagerRelationships.SingleAsync();
                Assert.Equal(first.Id, line.ManagerEmployeeId);
                Assert.Equal(new DateTime(2021, 2, 3), line.EffectiveFrom.Date);
                Assert.Equal(work.Id, line.ManagerWorkAssignmentId);
                Assert.Equal(2, await db.Employees.CountAsync());
                Assert.Equal(2, await db.WorkforceAuditEntries.CountAsync(entry => entry.Action == WorkforceAuditAction.ImportCorrectionPublished));
                Assert.Empty(await FirstPersonHistory.UntouchedAsync(db, default));
            }
            await using (var db = Db(cs, other))
            {
                Assert.Empty(await FirstPersonHistory.UntouchedAsync(db, default));
                Assert.Equal(404, (await Assert.ThrowsAsync<CompanyImportException>(() => Imports(db, other).AnswerAsync(read.Id, read.Version,
                    new("firstStart|forged", "file"), default))).Status);
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task A_failed_first_batch_rolls_back_the_correction_and_retry_applies_it_once()
    {
        await WithDatabaseAsync(async (cs, tenant, other) =>
        {
            await using (var db = Db(cs, tenant)) await CreateFirst(db, tenant);
            CompanyImportDto read;
            Guid employeeId;
            await using (var db = Db(cs, tenant))
            {
                employeeId = (await db.Employees.SingleAsync()).Id;
                read = await ChooseFile(db, tenant, await FirstImport(db, tenant));
                await Imports(db, tenant).BringInAsync(read.Id, read.Version, read.Fingerprint, Importer, default);
            }
            await using (var db = Db(cs, other))
            {
                await using var transaction = await db.Database.BeginTransactionAsync();
                var context = TestTenantContext.WithTenant(other);
                var result = await new WorkforceMutationService(db, context, new WorkforceCanonicalResolver(db))
                    .ImportFirstPersonAsync(employeeId, new FirstPersonImport(new DateTime(2020, 1, 2), "CDG-002", Guid.NewGuid(), Guid.NewGuid(), null),
                        read.Id, "Other tenant", default);
                Assert.True(result.IsFailure);
                Assert.Equal("FirstPerson.Changed", result.Error.Code);
            }
            await using (var db = Db(cs, tenant))
            {
                var context = TestTenantContext.WithTenant(tenant);
                var allocator = new Moq.Mock<IEmployeeNumberAllocator>();
                allocator.Setup(service => service.AllocateManyAsync(Moq.It.IsAny<int>(), Moq.It.IsAny<ISet<string>>(), Moq.It.IsAny<CancellationToken>()))
                    .ThrowsAsync(new InvalidOperationException("Interrupted first batch"));
                var worker = new CompanyImportBringIn(db, context, new OrganizationService(db, context),
                    new WorkforceMutationService(db, context, new WorkforceCanonicalResolver(db)), allocator.Object);
                await Assert.ThrowsAsync<InvalidOperationException>(() => worker.ExecuteAsync(read.Id, default, 1));
            }
            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(DateTime.UtcNow.Date, (await db.Employments.SingleAsync()).EffectiveFrom.Date);
                Assert.Equal(DateTime.UtcNow.Date, (await db.WorkAssignments.SingleAsync()).EffectiveFrom.Date);
                Assert.Null((await db.CompanyImportSessions.SingleAsync()).PlanJson);
                Assert.Equal(3, await db.WorkforceAuditEntries.CountAsync());
                await BringIn(db, tenant).ExecuteAsync(read.Id, default);
            }
            await using (var db = Db(cs, tenant))
            {
                Assert.Equal(2, await db.Employees.CountAsync());
                Assert.Equal(2, await db.WorkforceAuditEntries.CountAsync(entry => entry.Action == WorkforceAuditAction.ImportCorrectionPublished));
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task Keeping_the_offer_retains_both_dates_and_clamps_the_report_to_the_original_assignment()
    {
        await WithDatabaseAsync(async (cs, tenant, _) =>
        {
            await using (var db = Db(cs, tenant)) await CreateFirst(db, tenant);
            CompanyImportDto read;
            await using (var db = Db(cs, tenant))
            {
                read = await FirstImport(db, tenant);
                await Imports(db, tenant).BringInAsync(read.Id, read.Version, read.Fingerprint, Importer, default);
            }
            await using (var db = Db(cs, tenant)) await BringIn(db, tenant).ExecuteAsync(read.Id, default);
            await using (var db = Db(cs, tenant))
            {
                var first = await db.Employees.SingleAsync(row => row.Email == "amira@first.test");
                var tenure = await db.Employments.SingleAsync(row => row.EmployeeId == first.Id);
                var work = await db.WorkAssignments.SingleAsync(row => row.EmployeeId == first.Id);
                Assert.Equal(DateTime.UtcNow.Date, tenure.EffectiveFrom.Date);
                Assert.Equal(tenure.EffectiveFrom, work.EffectiveFrom);
                Assert.Equal(work.EffectiveFrom, (await db.ManagerRelationships.SingleAsync()).EffectiveFrom);
                Assert.Empty(await db.WorkforceAuditEntries.Where(entry => entry.Action == WorkforceAuditAction.ImportCorrectionPublished).ToListAsync());
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task The_files_number_job_and_unit_correct_her_day_one_record_and_lines_to_her_start_with_it()
    {
        await WithDatabaseAsync(async (cs, tenant, _) =>
        {
            await using (var db = Db(cs, tenant)) await CreateFirst(db, tenant);
            const string csv = "Employee ID,Name,Email,Title,Department,Manager,Start date\n"
                + "CDG-002,Amira Khelifi,amira@first.test,Chief People Officer,People,,2020-01-02\n"
                + "CDG-005,Mariam Gharbi,mariam@first.test,Engineering Manager,People,CDG-002,2021-02-03\n";
            CompanyImportDto read;
            await using (var db = Db(cs, tenant))
            {
                var id = await Imports(db, tenant).StartAsync([new(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "people.csv", "text/csv")],
                    "First Co", Importer, default);
                await Imports(db, tenant).TakeLeansAsync(id, (await Imports(db, tenant).GetAsync(id, null, default)).Version, default);
                read = await Imports(db, tenant).GetAsync(id, null, default);
                Assert.Contains(Assert.Single(read.Again!.Changed).Changes, change => change.Field == "employeeNumber" && change.To == "CDG-002");
                await Imports(db, tenant).BringInAsync(read.Id, read.Version, read.Fingerprint, Importer, default);
            }
            await using (var db = Db(cs, tenant)) await BringIn(db, tenant).ExecuteAsync(read.Id, default);
            await using (var db = Db(cs, tenant))
            {
                var first = await db.Employees.SingleAsync(row => row.Email == "amira@first.test");
                Assert.Equal("CDG-002", first.EmployeeNumber);
                // One assignment, corrected in place from her day-one start: no change dated after the import.
                var work = await db.WorkAssignments.SingleAsync(row => row.EmployeeId == first.Id);
                Assert.Equal(DateTime.UtcNow.Date, work.EffectiveFrom.Date);
                Assert.Equal("Chief People Officer", work.JobTitle);
                Assert.Equal("People", (await db.OrgUnits.SingleAsync(unit => unit.Id == work.OrgUnitId)).Name);
                var mariam = await db.Employees.SingleAsync(row => row.Email == "mariam@first.test");
                var line = await db.ManagerRelationships.SingleAsync(row => row.SubjectEmployeeId == mariam.Id);
                Assert.Equal(first.Id, line.ManagerEmployeeId);
                Assert.Equal(work.Id, line.ManagerWorkAssignmentId);
                Assert.Equal(work.EffectiveFrom, line.EffectiveFrom);
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task Missing_same_and_later_file_dates_never_offer_or_allow_a_forged_start_choice()
    {
        await WithDatabaseAsync(async (cs, tenant, _) =>
        {
            await using (var db = Db(cs, tenant)) await CreateFirst(db, tenant);
            foreach (var date in new[] { "", DateTime.UtcNow.ToString("yyyy-MM-dd"), "2099-01-02" })
            {
                await using var db = Db(cs, tenant);
                var read = await FirstImport(db, tenant, date, report: false);
                Assert.DoesNotContain(read.Checks, check => check.Kind == "firstPersonStart");
                var key = read.Chart.People.Single().Key;
                Assert.Equal(404, (await Assert.ThrowsAsync<CompanyImportException>(() => Imports(db, tenant).AnswerAsync(read.Id, read.Version,
                    new($"firstStart|{key}", "file"), default))).Status);
                await Imports(db, tenant).DiscardAsync(read.Id, read.Version, default);
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task Profile_even_reverted_personal_work_and_employment_edits_and_unproven_establishments_are_ineligible()
    {
        await WithDatabaseAsync(async (cs, _, _) =>
        {
            foreach (var edit in new[] { "profile", "personal", "work", "employment", "unproven" })
            {
                var tenant = Guid.NewGuid();
                await using var db = Db(cs, tenant);
                await CreateFirst(db, tenant);
                var first = await db.Employees.SingleAsync();
                if (edit == "profile") { first.UpdateProfile("Changed", first.LastName, first.Email, null, null); first.UpdateProfile("Amira", first.LastName, first.Email, null, null); }
                if (edit == "personal") first.SetAbout("Changed after activation");
                if (edit == "employment") (await db.Employments.SingleAsync()).UpdateEmploymentType(null);
                if (edit == "work")
                {
                    var work = await db.WorkAssignments.SingleAsync();
                    work.UpdateDetails(work.OrgUnitId, await db.Jobs.SingleAsync(), null);
                }
                if (edit == "unproven") db.WorkforceAuditEntries.Remove(await db.WorkforceAuditEntries.SingleAsync(entry => entry.EntityId == first.Id));
                await db.SaveChangesAsync();
                var read = await FirstImport(db, tenant);
                Assert.DoesNotContain(read.Checks, check => check.Kind == "firstPersonStart");
                Assert.DoesNotContain(read.Again!.Changed, person => person.Changes.Any(change => change.Field == "startDate"));
            }
        });
    }

    [RelationalDatabaseFact]
    public async Task An_edit_after_review_or_after_publish_request_refuses_the_selected_correction_without_writes()
    {
        await WithDatabaseAsync(async (cs, _, _) =>
        {
            foreach (var requested in new[] { false, true })
            {
                var tenant = Guid.NewGuid();
                await using (var db = Db(cs, tenant)) await CreateFirst(db, tenant);
                CompanyImportDto read;
                await using (var db = Db(cs, tenant))
                {
                    read = await ChooseFile(db, tenant, await FirstImport(db, tenant));
                    if (requested) await Imports(db, tenant).BringInAsync(read.Id, read.Version, read.Fingerprint, Importer, default);
                }
                await using (var db = Db(cs, tenant))
                {
                    (await db.Employees.SingleAsync()).SetAbout("An edit after review");
                    await db.SaveChangesAsync();
                }
                await using (var db = Db(cs, tenant))
                {
                    if (requested) await Assert.ThrowsAsync<CompanyImportChangedException>(() => BringIn(db, tenant).ExecuteAsync(read.Id, default));
                    else Assert.Equal("Changed", (await Assert.ThrowsAsync<CompanyImportException>(() => Imports(db, tenant)
                        .BringInAsync(read.Id, read.Version, read.Fingerprint, Importer, default))).Code);
                    Assert.Equal(DateTime.UtcNow.Date, (await db.Employments.SingleAsync()).EffectiveFrom.Date);
                    Assert.Equal(DateTime.UtcNow.Date, (await db.WorkAssignments.SingleAsync()).EffectiveFrom.Date);
                    Assert.Equal(1, await db.Employees.CountAsync());
                    Assert.Equal("An edit after review", (await db.Employees.SingleAsync()).About);
                    Assert.Empty(await db.WorkforceAuditEntries.Where(entry => entry.Action == WorkforceAuditAction.ImportCorrectionPublished).ToListAsync());
                }
            }
        });
    }
}
