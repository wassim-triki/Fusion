using System.Text;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>B-182: People's views and sign-in, the directory, the export, and invitations planned, sent and reminded.</summary>
public sealed class PeopleDirectoryInvitationsRelationalTests
{
    [RelationalDatabaseFact]
    public async Task Views_count_and_filter_people_and_sign_in_comes_only_when_asked()
    {
        await WithCompanyAsync(async company =>
        {
            var statuses = company.Statuses;
            statuses.Set(company.Amira, "Active");
            statuses.Set(company.Karim, "InvitePending", invitedDaysAgo: 4);

            var hr = await company.People(new PeopleQuery(View: PeopleView.Everyone, IncludeSignIn: true));
            Assert.Equal(new PeopleViewCountsDto(4, 1, 0, 3, 0), hr.Views);
            Assert.Equal(4, hr.TotalCount);
            Assert.Equal(PeopleSignInState.SignsIn, Row(hr, "Amira").SignIn!.State);
            Assert.Equal(PeopleSignInState.Invited, Row(hr, "Karim").SignIn!.State);
            Assert.Equal(PeopleSignInState.NoEmail, Row(hr, "Ons").SignIn!.State);
            Assert.Equal(PeopleSignInState.NotInvited, Row(hr, "Sami").SignIn!.State);
            Assert.Equal("Amira Khelifi", Row(hr, "Karim").PrimaryManager!.DisplayName);

            var notSignedIn = await company.People(new PeopleQuery(View: PeopleView.NotSignedIn, IncludeSignIn: true));
            Assert.Equal(["Karim", "Ons", "Sami"], notSignedIn.Items.Select(row => row.FirstName).Order());

            var starting = await company.People(new PeopleQuery(View: PeopleView.StartingSoon));
            Assert.Equal("Sami", Assert.Single(starting.Items).FirstName);

            // Without access rights: no sign-in on any row, no Not signed in count, and the view shows nobody.
            var plain = await company.People(new PeopleQuery(View: PeopleView.Everyone));
            Assert.All(plain.Items, row => Assert.Null(row.SignIn));
            Assert.Null(plain.Views!.NotSignedIn);
            Assert.Empty((await company.People(new PeopleQuery(View: PeopleView.NotSignedIn))).Items);

            var reportsToAmira = await company.People(new PeopleQuery(ManagerKey: company.Key(company.Amira).ToLowerInvariant()));
            Assert.Equal(["Karim", "Ons"], reportsToAmira.Items.Select(row => row.FirstName).Order());
            var paged = await company.People(new PeopleQuery(View: PeopleView.Everyone, PageSize: 3, Page: 2));
            Assert.Equal(4, paged.TotalCount);
            Assert.Single(paged.Items);

            var skilled = await company.People(new PeopleQuery(Fields: new Dictionary<string, string> { ["skills"] = "react" }));
            Assert.Equal("Karim", Assert.Single(skilled.Items).FirstName);
            // People for HR reads every field, HR-only ones included.
            Assert.Equal("Karim", Assert.Single((await company.People(new PeopleQuery(Fields: new Dictionary<string, string> { ["salary-band"] = "b" }))).Items).FirstName);
            Assert.Empty((await company.People(new PeopleQuery(Fields: new Dictionary<string, string> { ["nope"] = "x" }))).Items);
        });
    }

    [RelationalDatabaseFact]
    public async Task The_directory_shows_everyone_with_only_what_a_colleague_may_read()
    {
        await WithCompanyAsync(async company =>
        {
            var directory = await new PeopleDirectoryQueryHandler(company.Sender.Object, company.Db)
                .Handle(new PeopleDirectoryQuery(company.Ons), default);
            Assert.True(directory.IsSuccess);
            Assert.Equal(company.Key(company.Ons), directory.Value.ViewerEmployeeKey);
            Assert.Equal(4, directory.Value.People.Count);
            var karim = directory.Value.People.Single(person => person.DisplayName == "Karim Ben Ali");
            // Skills are shown to everyone; the HR-only salary band never is.
            Assert.Equal(["React", "SQL"], karim.Tags);
            Assert.True(directory.Value.People.Single(person => person.DisplayName == "Sami Trabelsi").StartingSoon);
            Assert.Equal("Amira Khelifi", karim.Manager!.DisplayName);
        });
    }

    [RelationalDatabaseFact]
    public async Task The_export_holds_the_filtered_rows_and_never_runs_a_formula()
    {
        await WithCompanyAsync(async company =>
        {
            var rows = (await company.People(new PeopleQuery(View: PeopleView.Everyone, Unpaged: true, IncludeSignIn: true))).Items;
            var withAccess = await new PeopleExport(company.Db).BuildAsync(rows, includeSignIn: true, PeopleExportFormat.Csv, default);
            var csv = Encoding.UTF8.GetString(withAccess.Bytes);
            Assert.Contains("\"Sign-in\"", csv);
            Assert.Contains("\"Salary band\"", csv);
            Assert.Contains("\"React, SQL\"", csv);
            Assert.Contains("\"'=HYPERLINK(1)\"", csv);
            Assert.Equal(5, csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);

            var without = await new PeopleExport(company.Db).BuildAsync(rows, includeSignIn: false, PeopleExportFormat.Xlsx, default);
            Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", without.ContentType);
            Assert.True(without.Bytes.Length > 0);
        });
    }

    [RelationalDatabaseFact]
    public async Task Invitations_send_now_plan_for_later_and_go_out_once()
    {
        await WithCompanyAsync(async company =>
        {
            company.Statuses.Set(company.Amira, "Active");
            var plan = await company.Invitations.PlanAsync(default);
            // Ons has no work email; Sami waits for their first day; Karim and nobody else can be invited.
            Assert.Equal(1, plan.NotSignedIn);
            Assert.Equal(0, plan.Managers);
            Assert.Equal(1, plan.NoEmail);
            Assert.Equal(1, plan.JoinersOnFirstDay);

            await Assert.ThrowsAsync<ArgumentException>(() => company.Invitations.SendAsync(
                new SendInvitationsRequest(InvitationAudience.NotSignedIn, null, company.Now.AddMinutes(-1)), null, "HR", default));

            var planned = await company.Invitations.SendAsync(
                new SendInvitationsRequest(InvitationAudience.NotSignedIn, null, company.Now.AddDays(2)), null, "Amira Khelifi", default);
            Assert.NotNull(planned.Scheduled);
            Assert.Equal(1, planned.Scheduled!.People);
            Assert.Equal(0, await company.Invitations.SendDueAsync(default));
            company.Provisioner.Verify(p => p.BulkProvisionAsync(It.IsAny<List<WorkforceBulkProvisionSubject>>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>(), It.IsAny<string?>()), Times.Never);

            company.Clock.Advance(TimeSpan.FromDays(2));
            Assert.Equal(1, await company.Invitations.SendDueAsync(default));
            Assert.Equal(0, await company.Invitations.SendDueAsync(default));
            company.Provisioner.Verify(p => p.BulkProvisionAsync(
                It.Is<List<WorkforceBulkProvisionSubject>>(subjects => subjects.Single().EmployeeId == company.Karim),
                It.IsAny<Guid>(), It.IsAny<CancellationToken>(), It.IsAny<string?>()), Times.Once);
            var sent = await company.Db.InvitationSchedules.SingleAsync();
            Assert.NotNull(sent.SentAt);
            Assert.Equal(1, sent.Invited);
            Assert.False(await company.Invitations.CancelAsync(sent.Id, "HR", default));

            var another = await company.Invitations.SendAsync(
                new SendInvitationsRequest(InvitationAudience.Managers, null, company.Now.AddHours(3)), null, "HR", default);
            Assert.Single((await company.Invitations.PlanAsync(default)).Scheduled);
            Assert.True(await company.Invitations.CancelAsync(another.Scheduled!.Id, "HR", default));
            Assert.Empty((await company.Invitations.PlanAsync(default)).Scheduled);

            // Another company can neither see nor cancel this one's plans.
            var other = await company.Invitations.SendAsync(
                new SendInvitationsRequest(InvitationAudience.NotSignedIn, null, company.Now.AddHours(5)), null, "HR", default);
            await using var otherDb = company.OtherTenantDb();
            Assert.Empty(await otherDb.InvitationSchedules.ToListAsync());
            Assert.False(await company.InvitationsFor(otherDb, company.OtherTenantId).CancelAsync(other.Scheduled!.Id, "HR", default));
        });
    }

    [RelationalDatabaseFact]
    public async Task A_joiner_is_invited_on_their_first_day_and_a_pending_invitation_is_reminded_once()
    {
        await WithCompanyAsync(async company =>
        {
            company.Statuses.Set(company.Amira, "Active");
            company.Statuses.Set(company.Karim, "InvitePending", invitedDaysAgo: 4);

            await company.Invitations.RunAutomaticAsync(default);
            // Sami starts in three days: nothing yet. Karim's invitation is four days old: one reminder.
            company.Provisioner.Verify(p => p.BulkProvisionAsync(It.IsAny<List<WorkforceBulkProvisionSubject>>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>(), It.IsAny<string?>()), Times.Never);
            company.Access.Verify(a => a.ResendInviteAsync(company.Karim, It.IsAny<CancellationToken>()), Times.Once);

            company.Clock.Advance(TimeSpan.FromDays(3));
            await company.Invitations.RunAutomaticAsync(default);
            await company.Invitations.RunAutomaticAsync(default);
            company.Provisioner.Verify(p => p.BulkProvisionAsync(
                It.Is<List<WorkforceBulkProvisionSubject>>(subjects => subjects.Single().EmployeeId == company.Sami),
                It.IsAny<Guid>(), It.IsAny<CancellationToken>(), It.IsAny<string?>()), Times.Once);
            company.Access.Verify(a => a.ResendInviteAsync(company.Karim, It.IsAny<CancellationToken>()), Times.Once);

            company.Settings = company.Settings with { InviteJoinersOnFirstDay = false, RemindAfterDays = 0 };
            company.Statuses.Set(company.Karim, "InvitePending", invitedDaysAgo: 9, inviteId: Guid.NewGuid());
            await company.Invitations.RunAutomaticAsync(default);
            company.Access.Verify(a => a.ResendInviteAsync(company.Karim, It.IsAny<CancellationToken>()), Times.Once);
        });
    }

    private static PeopleRowDto Row(PeoplePageDto page, string firstName) => page.Items.Single(row => row.FirstName == firstName);

    private sealed class Company
    {
        public required CoreHRDbContext Db { get; init; }
        public required string ConnectionString { get; init; }
        public required Guid TenantId { get; init; }
        public required FakeStatuses Statuses { get; init; }
        public required Mock<ISender> Sender { get; init; }
        public required Mock<IWorkforceBulkProvisioner> Provisioner { get; init; }
        public required Mock<IWorkforceAccessIdentityClient> Access { get; init; }
        public required ManualClock Clock { get; init; }
        public required Dictionary<Guid, string> Keys { get; init; }
        public required Dictionary<Guid, (string? Email, int Reports)> Facts { get; init; }
        public ProvisioningSettings Settings { get; set; } = new(RemindAfterDays: 3, InviteJoinersOnFirstDay: true);
        public Guid Amira { get; set; }
        public Guid Karim { get; set; }
        public Guid Ons { get; set; }
        public Guid Sami { get; set; }
        public DateTime Now => Clock.GetUtcNow().UtcDateTime;
        public string Key(Guid id) => Keys[id];
        public PeopleInvitations Invitations => InvitationsFor(Db, TenantId);
        public Guid OtherTenantId { get; } = Guid.NewGuid();

        public async Task<PeoplePageDto> People(PeopleQuery query)
        {
            var result = await new PeopleQueryHandler(Db, TestTenantContext.WithTenant(TenantId), Statuses).Handle(query, default);
            return result.Value;
        }

        public CoreHRDbContext OtherTenantDb() => CreateDb(ConnectionString, OtherTenantId);

        public PeopleInvitations InvitationsFor(CoreHRDbContext db, Guid tenantId)
        {
            var tenant = TestTenantContext.WithTenant(tenantId);
            var sender = new Mock<ISender>();
            sender.Setup(s => s.Send(It.IsAny<PeopleQuery>(), It.IsAny<CancellationToken>()))
                .Returns((PeopleQuery query, CancellationToken token) => new PeopleQueryHandler(db, tenant, Statuses).Handle(query, token));
            var workforce = new Mock<IWorkforceContractService>();
            workforce.Setup(w => w.ResolveEmployeesForCompanyAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
                .Returns((IReadOnlyCollection<Guid> ids, CancellationToken _) => Task.FromResult<IReadOnlyList<WorkforceEmployeeSummaryDto>>(
                    ids.Where(id => Facts.ContainsKey(id) && tenantId == TenantId).Select(Summary).ToList()));
            var settings = new Mock<ITenantSettingsReadService>();
            settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => new TenantSettingsDto { Provisioning = Settings });
            return new PeopleInvitations(db, tenant, sender.Object, workforce.Object,
                new WorkforceInvitationSender(Access.Object, Provisioner.Object), Statuses, Access.Object, settings.Object, Clock);
        }

        private WorkforceEmployeeSummaryDto Summary(Guid id)
            => new(id, Keys[id], "N", "First", "Last", null, "First Last", "First Last", Facts[id].Email, "Job",
                DateTime.UtcNow, "Active", true, null, null, Facts[id].Reports, null!, 1);
    }

    private static async Task WithCompanyAsync(Func<Company, Task> test)
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_invites_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        await CreateDatabaseAsync(baseConnection, databaseName);
        try
        {
            var tenantId = Guid.NewGuid();
            var today = DateTime.UtcNow.Date;
            await using var db = CreateDb(connectionString, tenantId);
            await db.Database.MigrateAsync();
            var tenant = TestTenantContext.WithTenant(tenantId);
            var organization = new OrganizationService(db, tenant);
            var root = await organization.CreateRootAsync(new CreateOrganizationRootRequest("CO", "Carthage", DateOnly.FromDateTime(today.AddYears(-5))), default);
            var allocator = new EmployeeNumberAllocatorService(db, tenant);
            var mutation = new WorkforceMutationService(db, tenant, new WorkforceCanonicalResolver(db));
            var job = db.JobId(tenantId, "Engineer");

            async Task<string> Existing(string first, string last, string? email, Guid? manager)
                => (await new AddExistingEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                    new AddExistingEmployeeCommand(new AddExistingEmployeeRequest(first, last, null, email, null, EmployeeNumberMode.Generated, null,
                        today.AddYears(-2), today.AddYears(-2), null, root.Id, job, null, manager), "test|HR"), default)).Value.EmployeeKey;
            async Task<Guid> Id(string key) => await db.Employees.Where(item => item.StableEmployeeKey == key).Select(item => item.Id).SingleAsync();

            var keys = new Dictionary<Guid, string>();
            var amiraKey = await Existing("Amira", "Khelifi", "amira@carthage.test", null);
            var amira = await Id(amiraKey);
            keys[amira] = amiraKey;
            var karimKey = await Existing("Karim", "Ben Ali", "karim@carthage.test", amira);
            var karim = await Id(karimKey);
            keys[karim] = karimKey;
            var onsKey = await Existing("Ons", "Khemiri", null, amira);
            var ons = await Id(onsKey);
            keys[ons] = onsKey;
            var samiKey = (await new HireEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                new HireEmployeeCommand(new HireEmployeeRequest("Sami", "Trabelsi", null, "sami@carthage.test", null, EmployeeNumberMode.Generated, null,
                    today.AddDays(3), null, root.Id, job, null, null), "test|HR"), default)).Value.EmployeeKey;
            var sami = await Id(samiKey);
            keys[sami] = samiKey;

            var catalog = EmployeeFieldCatalog.Create(tenantId, "test");
            db.EmployeeFieldCatalogs.Add(catalog);
            var skills = EmployeeFieldDefinition.Create(tenantId, catalog.Id, "skills", "Skills", EmployeeFieldArea.About, EmployeeFieldType.Tags,
                EmployeeFieldEditor.Employee, true, true, true, false, false, 1, null, "skills", "test");
            var band = EmployeeFieldDefinition.Create(tenantId, catalog.Id, "salary-band", "Salary band", EmployeeFieldArea.Personal, EmployeeFieldType.Tags,
                EmployeeFieldEditor.Hr, true, false, false, false, false, 2, null, null, "test");
            var note = EmployeeFieldDefinition.Create(tenantId, catalog.Id, "note", "Note", EmployeeFieldArea.About, EmployeeFieldType.Text,
                EmployeeFieldEditor.Hr, true, false, false, false, false, 3, null, null, "test");
            db.EmployeeFieldDefinitions.AddRange(skills, band, note);
            db.EmployeeFieldValues.AddRange(
                EmployeeFieldValue.Create(tenantId, karim, skills.Id, "[\"React\",\"SQL\"]", "test"),
                EmployeeFieldValue.Create(tenantId, karim, band.Id, "[\"B\"]", "test"),
                EmployeeFieldValue.Create(tenantId, ons, note.Id, "\"=HYPERLINK(1)\"", "test"));
            await db.SaveChangesAsync();

            var clock = new ManualClock(DateTime.UtcNow);
            var statuses = new FakeStatuses(clock);
            var access = new Mock<IWorkforceAccessIdentityClient>();
            access.Setup(a => a.ResolveCandidatesAsync(It.IsAny<IReadOnlyCollection<WorkforceAccessCandidateSubject>>(), It.IsAny<CancellationToken>()))
                .Returns((IReadOnlyCollection<WorkforceAccessCandidateSubject> subjects, CancellationToken _) =>
                    Task.FromResult<IReadOnlyDictionary<Guid, WorkforceAccessCandidateResult>>(subjects.ToDictionary(
                        subject => subject.EmployeeId, _ => new WorkforceAccessCandidateResult(WorkforceAccountStates.NewAccount, null, null, null))));
            access.Setup(a => a.ResendInviteAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
            var provisioner = new Mock<IWorkforceBulkProvisioner>();
            provisioner.Setup(p => p.BulkProvisionAsync(It.IsAny<List<WorkforceBulkProvisionSubject>>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>(), It.IsAny<string?>()))
                .Returns((List<WorkforceBulkProvisionSubject> subjects, Guid _, CancellationToken _, string? _) =>
                {
                    foreach (var subject in subjects) statuses.Set(subject.EmployeeId, "InvitePending");
                    return Task.FromResult(new WorkforceBulkProvisionResponse(subjects.Select(subject => new WorkforceBulkProvisionResultItem(subject.EmployeeId, "Created", "ok")).ToList()));
                });
            var sender = new Mock<ISender>();
            sender.Setup(s => s.Send(It.IsAny<PeopleQuery>(), It.IsAny<CancellationToken>()))
                .Returns((PeopleQuery query, CancellationToken token) => new PeopleQueryHandler(db, tenant, statuses).Handle(query, token));

            await test(new Company
            {
                Db = db,
                ConnectionString = connectionString,
                TenantId = tenantId,
                Statuses = statuses,
                Sender = sender,
                Provisioner = provisioner,
                Access = access,
                Clock = clock,
                Keys = keys,
                Facts = new() { [amira] = ("amira@carthage.test", 2), [karim] = ("karim@carthage.test", 0), [ons] = (null, 0), [sami] = ("sami@carthage.test", 0) },
                Amira = amira,
                Karim = karim,
                Ons = ons,
                Sami = sami,
            });
        }
        finally
        {
            await DropDatabaseAsync(baseConnection, databaseName);
        }
    }

    /// <summary>Identity's account states, set by the test; an invitation sent stays pending until it says otherwise.</summary>
    private sealed class FakeStatuses(ManualClock clock) : IWorkforceAccountStatusReader
    {
        private readonly Dictionary<Guid, (string State, DateTime? InvitedAt, Guid? InviteId)> _states = [];

        public void Set(Guid employeeId, string state, int invitedDaysAgo = 0, Guid? inviteId = null)
            => _states[employeeId] = (state, clock.GetUtcNow().UtcDateTime.AddDays(-invitedDaysAgo),
                inviteId ?? (_states.TryGetValue(employeeId, out var known) ? known.InviteId : null) ?? Guid.NewGuid());

        public Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
            IReadOnlyCollection<WorkforceAccountSubjectDto> subjects, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>>(subjects.ToDictionary(subject => subject.EmployeeId, subject =>
                _states.TryGetValue(subject.EmployeeId, out var known)
                    ? new WorkforceAccountStatusDto(subject.EmployeeId, subject.Email, null, "Employee", [], known.State, null, null, null,
                        known.InviteId, known.InvitedAt, null, null, null, null, null, null)
                    : new WorkforceAccountStatusDto(subject.EmployeeId, subject.Email, null, "Employee", [], "Unprovisioned", null, null, null,
                        null, null, null, null, null, null, null, null)));
    }

    private sealed class ManualClock(DateTime start) : TimeProvider
    {
        private DateTimeOffset _now = new(DateTime.SpecifyKind(start, DateTimeKind.Utc));
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static CoreHRDbContext CreateDb(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task CreateDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using (var terminate = new NpgsqlCommand(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @databaseName AND pid <> pg_backend_pid();", connection))
        {
            terminate.Parameters.AddWithValue("databaseName", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\"", connection);
        await drop.ExecuteNonQueryAsync();
    }
}
