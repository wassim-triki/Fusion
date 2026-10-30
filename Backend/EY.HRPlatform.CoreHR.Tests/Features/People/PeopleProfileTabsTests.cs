using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Infrastructure.Photos;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>
/// B-127/B-129: the Personal tab, photos and job history. Amira leads; Mariam reports to her and manages Nour;
/// Karim also reports to Amira and manages Sami. Bob works in another tenant.
/// </summary>
public sealed class PeopleProfileTabsTests : IDisposable
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateTime Today = DateTime.UtcNow.Date;

    private readonly string _photoRoot = Path.Combine(Path.GetTempPath(), $"fusion-photos-{Guid.NewGuid():N}");
    private readonly string _db = Guid.NewGuid().ToString();
    private Guid _amira, _mariam, _nour, _karim, _sami, _bob;
    private string _nourKey = "", _samiKey = "", _bobKey = "", _mariamKey = "";

    public void Dispose()
    {
        if (Directory.Exists(_photoRoot))
            Directory.Delete(_photoRoot, recursive: true);
    }

    private async Task SeedAsync()
    {
        await using var seed = TestDbContextFactory.CreateWithoutTenant(_db);
        var unit = OrgUnit.Create(TenantA, "OPS", "Operations", "Department", null);
        var unitB = OrgUnit.Create(TenantB, "OPS", "Operations", "Department", null);
        seed.OrgUnits.AddRange(unit, unitB);

        (Guid Id, Guid Assignment, string Key) Person(Guid tenant, Guid unitId, string first, string title, Guid? managerId = null, Guid? managerAssignment = null)
        {
            var employee = Employee.Create(tenant, first, "Test", $"{first.ToLowerInvariant()}.{tenant:N}@example.test",
                employeeNumber: $"E-{Guid.NewGuid():N}"[..12], phone: "+216 20 000 000");
            var employment = Employment.Start(tenant, employee.Id, Today.AddYears(-3), null, WorkforceSourceType.Manual);
            var assignment = WorkAssignment.Create(tenant, employment.Id, employee.Id, unitId, TestCatalog.Job(tenant, title), TestCatalog.Place(tenant, "Tunis"), true,
                Today.AddYears(-3), null, WorkforceSourceType.Manual);
            seed.Employees.Add(employee);
            seed.Employments.Add(employment);
            seed.WorkAssignments.Add(assignment);
            if (managerId is { } manager)
                seed.ManagerRelationships.Add(ManagerRelationship.Create(tenant, employee.Id, manager, assignment.Id,
                    managerAssignment!.Value, ReportingRelationshipType.PrimaryManager, Today.AddYears(-3), WorkforceSourceType.Manual));
            return (employee.Id, assignment.Id, employee.StableEmployeeKey);
        }

        var amira = Person(TenantA, unit.Id, "Amira", "CEO");
        var mariam = Person(TenantA, unit.Id, "Mariam", "VP", amira.Id, amira.Assignment);
        var nour = Person(TenantA, unit.Id, "Nour", "Analyst", mariam.Id, mariam.Assignment);
        var karim = Person(TenantA, unit.Id, "Karim", "VP", amira.Id, amira.Assignment);
        var sami = Person(TenantA, unit.Id, "Sami", "Analyst", karim.Id, karim.Assignment);
        var bob = Person(TenantB, unitB.Id, "Bob", "Clerk");
        await seed.SaveChangesAsync();

        (_amira, _mariam, _nour, _karim, _sami, _bob) = (amira.Id, mariam.Id, nour.Id, karim.Id, sami.Id, bob.Id);
        (_nourKey, _samiKey, _bobKey, _mariamKey) = (nour.Key, sami.Key, bob.Key, mariam.Key);
    }

    private CoreHRDbContext Db(Guid tenant) => TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), _db);

    private static PeopleViewer Colleague(Guid id) => new(id, ManagesPeople: false, ViewsTenant: false, ManagesTeam: false, UpdatesSelf: true);
    private static PeopleViewer Manager(Guid id) => new(id, ManagesPeople: false, ViewsTenant: false, ManagesTeam: true, UpdatesSelf: true);
    private static PeopleViewer TenantReader(Guid id) => new(id, ManagesPeople: false, ViewsTenant: true, ManagesTeam: true, UpdatesSelf: true);
    private static PeopleViewer PeopleAdmin(Guid id) => new(id, ManagesPeople: true, ViewsTenant: true, ManagesTeam: true, UpdatesSelf: true);

    private Task<EY.HRPlatform.SharedKernel.Results.Result<PeoplePersonalDto>> ReadAsync(string key, PeopleViewer viewer, Guid? tenant = null)
        => new PeoplePersonalQueryHandler(Db(tenant ?? TenantA)).Handle(new PeoplePersonalQuery(key, viewer), default);

    private async Task<EY.HRPlatform.SharedKernel.Results.Result<PeoplePersonalDto>> UpdateAsync(
        string key, PeopleViewer viewer, UpdatePersonalRequest body, Guid? tenant = null, uint? version = null,
        SelfServiceSettings? selfService = null)
    {
        var db = Db(tenant ?? TenantA);
        var current = await new PeoplePersonalQueryHandler(db).Handle(new PeoplePersonalQuery(key, PeopleAdmin(Guid.Empty)), default);
        var settings = new Mock<ITenantSettingsReadService>();
        settings.Setup(item => item.GetCurrentAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TenantSettingsDto { SelfService = selfService ?? new SelfServiceSettings() });
        return await new UpdatePeoplePersonalCommandHandler(db, TestTenantContext.WithTenant(tenant ?? TenantA), settings.Object)
            .Handle(new UpdatePeoplePersonalCommand(key, viewer, version ?? (current.IsSuccess ? current.Value.Version : 0), body, "test|Tester"), default);
    }

    private static UpdatePersonalRequest Body(int contacts = 1, DateOnly? born = null, string? email = "nour@example.test") => new(
        "Nouri",
        "+216 98 765 432",
        email,
        new PeopleHomeAddressDto("12 Rue de Marseille", "Tunis", "1000", "Tunisia"),
        born ?? new DateOnly(1994, 5, 12),
        Enumerable.Range(1, contacts).Select(i => new PeopleEmergencyContactDto($"Contact {i}", "Sister", $"+216 22 000 00{i}")).ToList());

    // --- Personal tab: who sees what ------------------------------------------------------------------

    [Fact]
    public async Task Each_viewer_sees_the_personal_fields_their_level_allows()
    {
        await SeedAsync();
        Assert.True((await UpdateAsync(_nourKey, PeopleAdmin(_amira), Body())).IsSuccess);

        var self = (await ReadAsync(_nourKey, Colleague(_nour))).Value;
        Assert.Equal(PersonalAccess.Full, self.Access);
        Assert.True(self.CanEdit);
        Assert.Equal("nour@example.test", self.PersonalEmail);
        Assert.Equal("Tunis", self.HomeAddress!.City);
        Assert.Equal(new DateOnly(1994, 5, 12), self.DateOfBirth);
        Assert.Single(self.EmergencyContacts!);

        var admin = (await ReadAsync(_nourKey, PeopleAdmin(_karim))).Value;
        Assert.Equal(PersonalAccess.Full, admin.Access);
        Assert.True(admin.CanEdit);

        // Her branch manager, and a manager above in the same branch, see the mobile only.
        foreach (var manager in new[] { _mariam, _amira })
        {
            var view = (await ReadAsync(_nourKey, Manager(manager))).Value;
            Assert.Equal(PersonalAccess.Contact, view.Access);
            Assert.False(view.CanEdit);
            Assert.Equal("+216 98 765 432", view.Mobile);
            Assert.Null(view.PersonalEmail);
            Assert.Null(view.HomeAddress);
            Assert.Null(view.DateOfBirth);
            Assert.Null(view.EmergencyContacts);
        }

        Assert.Equal(PersonalAccess.Contact, (await ReadAsync(_nourKey, TenantReader(_sami))).Value.Access);

        // Another branch's manager and a colleague get the preferred name only.
        foreach (var viewer in new[] { Manager(_karim), Colleague(_sami) })
        {
            var view = (await ReadAsync(_nourKey, viewer)).Value;
            Assert.Equal(PersonalAccess.Directory, view.Access);
            Assert.Equal("Nouri", view.PreferredName);
            Assert.Null(view.Mobile);
            Assert.Null(view.PersonalEmail);
            Assert.Null(view.HomeAddress);
            Assert.Null(view.DateOfBirth);
            Assert.Null(view.EmergencyContacts);
        }
    }

    [Fact]
    public async Task Another_tenants_person_is_not_found()
    {
        await SeedAsync();
        Assert.Equal("Employee.NotFound", (await ReadAsync(_bobKey, PeopleAdmin(_amira))).Error.Code);
        Assert.Equal("Employee.NotFound", (await UpdateAsync(_bobKey, PeopleAdmin(_amira), Body())).Error.Code);
        Assert.Equal("Employee.NotFound", (await UploadAsync(_bobKey, PeopleAdmin(_amira), Png())).Error.Code);
        Assert.Equal("Employee.NotFound", (await HistoryAsync(_bobKey, PeopleAdmin(_amira))).Error.Code);
    }

    // --- Personal tab: who changes it -------------------------------------------------------------------

    [Fact]
    public async Task A_person_changes_their_own_details_at_once_and_it_lands_in_history()
    {
        await SeedAsync();
        var result = await UpdateAsync(_nourKey, Colleague(_nour), Body(contacts: 3));
        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value.EmergencyContacts!.Count);

        await using var db = Db(TenantA);
        var entry = Assert.Single(db.WorkforceAuditEntries, item => item.Action == WorkforceAuditAction.PersonalDetailsUpdated);
        Assert.Equal(_nour, entry.EntityId);
        Assert.Equal("Preferred name, Mobile, Personal email, Home address, Date of birth, Emergency contacts", entry.ChangeDetails);

        var timeline = await new PeopleTimelineComposer(db).ComposeAsync(_nour, _nourKey, default);
        var personal = Assert.Single(timeline.Timeline, item => item.Kind == PeopleChangeKind.PersonalDetails);
        Assert.Equal("Updated contact details", personal.Title);
        Assert.Contains(personal.Fields, field => field.Label == "Mobile" && field.From is null && field.To is null);

        // Saving the same values again changes nothing and writes no history.
        Assert.True((await UpdateAsync(_nourKey, Colleague(_nour), Body(contacts: 3))).IsSuccess);
        await using var after = Db(TenantA);
        Assert.Single(after.WorkforceAuditEntries, item => item.Action == WorkforceAuditAction.PersonalDetailsUpdated);
    }

    [Fact]
    public async Task Nobody_else_but_a_people_admin_changes_someones_details()
    {
        await SeedAsync();
        foreach (var viewer in new[] { Colleague(_sami), Manager(_mariam), Manager(_karim), TenantReader(_amira) })
            Assert.Equal(PeopleAccess.ForbiddenCode, (await UpdateAsync(_nourKey, viewer, Body())).Error.Code);

        // Without the self-update permission, not even their own.
        var selfWithoutUpdate = Colleague(_nour) with { UpdatesSelf = false };
        Assert.Equal(PeopleAccess.ForbiddenCode, (await UpdateAsync(_nourKey, selfWithoutUpdate, Body())).Error.Code);

        Assert.True((await UpdateAsync(_nourKey, PeopleAdmin(_amira), Body())).IsSuccess);
    }

    [Fact]
    public async Task The_companys_self_service_settings_bind_the_person_but_not_hr()
    {
        await SeedAsync();
        var locked = new SelfServiceSettings(CanEditPreferredName: false, CanEditPhone: false);
        var name = await UpdateAsync(_nourKey, Colleague(_nour), Body(), selfService: locked with { CanEditPhone = true });
        Assert.Equal("Your company doesn't let you change your preferred name.", name.Error.Message);
        var mobile = await UpdateAsync(_nourKey, Colleague(_nour), Body(), selfService: locked with { CanEditPreferredName = true });
        Assert.Equal("Your company doesn't let you change your mobile.", mobile.Error.Message);

        // Leaving the locked fields as they are, the rest still saves.
        var rest = Body() with { PreferredName = null, Mobile = " +216 20 000 000 " };
        Assert.True((await UpdateAsync(_nourKey, Colleague(_nour), rest, selfService: locked)).IsSuccess);

        Assert.True((await UpdateAsync(_nourKey, PeopleAdmin(_amira), Body(), selfService: locked)).IsSuccess);
    }

    [Fact]
    public async Task Invalid_details_are_refused()
    {
        await SeedAsync();
        Assert.Equal("Employee.Validation", (await UpdateAsync(_nourKey, Colleague(_nour), Body(contacts: 4))).Error.Code);
        Assert.Equal("Employee.Validation", (await UpdateAsync(_nourKey, Colleague(_nour), Body(born: DateOnly.FromDateTime(Today.AddDays(1))))).Error.Code);
        Assert.Equal("Employee.Validation", (await UpdateAsync(_nourKey, Colleague(_nour), Body(email: "not-an-email"))).Error.Code);
        var noPhone = Body() with { EmergencyContacts = [new PeopleEmergencyContactDto("Leila", null, " ")] };
        Assert.Equal("Employee.Validation", (await UpdateAsync(_nourKey, Colleague(_nour), noPhone)).Error.Code);
    }

    [Fact]
    public async Task A_stale_version_is_a_conflict()
    {
        await SeedAsync();
        await Assert.ThrowsAsync<ConcurrencyException>(() => UpdateAsync(_nourKey, Colleague(_nour), Body(), version: 999_999));
    }

    // --- Photos -----------------------------------------------------------------------------------------

    private static byte[] Png(int size = 64)
    {
        var bytes = new byte[size];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(bytes, 0);
        return bytes;
    }

    private static byte[] Webp()
    {
        var bytes = new byte[32];
        "RIFF"u8.CopyTo(bytes);
        "WEBP"u8.CopyTo(bytes.AsSpan(8));
        return bytes;
    }

    private IEmployeePhotoStore Store(Guid tenant) => new LocalEmployeePhotoStore(TestTenantContext.WithTenant(tenant), _photoRoot);

    private Task<EY.HRPlatform.SharedKernel.Results.Result<EmployeePhotoDto>> UploadAsync(
        string key, PeopleViewer viewer, byte[] bytes, string fileName = "me.png", Guid? tenant = null)
    {
        var t = tenant ?? TenantA;
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
        return new UploadEmployeePhotoHandler(Db(t), TestTenantContext.WithTenant(t), Store(t), NullLogger<UploadEmployeePhotoHandler>.Instance)
            .Handle(new UploadEmployeePhotoCommand(key, viewer, file, "test|Tester"), default);
    }

    private Task<EY.HRPlatform.SharedKernel.Results.Result<EmployeePhotoDto>> RemoveAsync(string key, PeopleViewer viewer)
        => new RemoveEmployeePhotoHandler(Db(TenantA), TestTenantContext.WithTenant(TenantA), Store(TenantA), NullLogger<RemoveEmployeePhotoHandler>.Instance)
            .Handle(new RemoveEmployeePhotoCommand(key, viewer, "test|Tester"), default);

    [Fact]
    public async Task A_person_sets_and_replaces_their_photo_and_every_card_carries_its_address()
    {
        await SeedAsync();
        var first = await UploadAsync(_nourKey, Colleague(_nour), Png());
        Assert.True(first.IsSuccess);
        Assert.StartsWith($"/corehr/employees/people/{_nourKey}/photo?v=", first.Value.PhotoUrl);

        var second = await UploadAsync(_nourKey, Colleague(_nour), Webp(), "me.webp");
        Assert.NotEqual(first.Value.PhotoUrl, second.Value.PhotoUrl);

        var stored = await new EmployeePhotoQueryHandler(Db(TenantA)).Handle(new EmployeePhotoQuery(_nourKey), default);
        Assert.Equal("image/webp", stored.Value.ContentType);
        Assert.EndsWith(stored.Value.Version, second.Value.PhotoUrl);
        await using (var stream = await Store(TenantA).OpenAsync(stored.Value.StorageKey, default))
            Assert.NotNull(stream);
        // The replaced file is gone; only the current one is on disk.
        Assert.Single(Directory.GetFiles(Path.Combine(_photoRoot, $"{TenantA:N}")));

        var card = await new MyCardQueryHandler(Db(TenantA), new EY.HRPlatform.CoreHR.Features.Workforce.Services.WorkforceCanonicalResolver(Db(TenantA)))
            .Handle(new MyCardQuery(_nour, DateTime.UtcNow), default);
        Assert.Equal(second.Value.PhotoUrl, card.Value.PhotoUrl);
        var people = await new PeopleQueryHandler(Db(TenantA), TestTenantContext.WithTenant(TenantA))
            .Handle(new PeopleQuery(null, null, null, PeopleOrganizationScope.Subtree, PeopleSortField.Name, PeopleSortDirection.Asc, 1, 25, null), default);
        Assert.Equal(second.Value.PhotoUrl, people.Value.Items.Single(item => item.EmployeeKey == _nourKey).PhotoUrl);
        Assert.Null(people.Value.Items.Single(item => item.EmployeeKey == _samiKey).PhotoUrl);
    }

    [Fact]
    public async Task The_profile_and_job_history_carry_the_photos_of_the_people_around_the_person()
    {
        await SeedAsync();
        await using (var db = Db(TenantA))
        {
            var nourAssignment = db.WorkAssignments.Single(item => item.EmployeeId == _nour);
            var karimAssignment = db.WorkAssignments.Single(item => item.EmployeeId == _karim);
            db.ManagerRelationships.Add(ManagerRelationship.Create(TenantA, _nour, _karim, nourAssignment.Id, karimAssignment.Id,
                ReportingRelationshipType.SecondaryManager, Today.AddMonths(-1), WorkforceSourceType.Manual));
            await db.SaveChangesAsync();
        }
        var karimKey = Db(TenantA).Employees.Single(item => item.Id == _karim).StableEmployeeKey;
        var mariamPhoto = (await UploadAsync(_mariamKey, PeopleAdmin(_amira), Png())).Value.PhotoUrl;
        var nourPhoto = (await UploadAsync(_nourKey, PeopleAdmin(_amira), Png())).Value.PhotoUrl;
        var karimPhoto = (await UploadAsync(karimKey, PeopleAdmin(_amira), Png())).Value.PhotoUrl;

        Task<PeopleProfileDto> ProfileAsync(string key)
        {
            var db = Db(TenantA);
            var organization = new Mock<IOrganizationService>();
            organization.Setup(o => o.GetUnitAsync(It.IsAny<Guid>(), It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new OrganizationUnitStateDto(Guid.NewGuid(), "OPS", "Operations", Guid.NewGuid(), "Department", null, null,
                    "Operations", OrgUnitLifecycleState.Active, DateOnly.MinValue, 1));
            return new PeopleProfileQueryHandler(db, organization.Object, new WorkforceChangeReader(db))
                .Handle(new PeopleProfileQuery(key, null, EmployeeReadAudience.HrAdmin, null, _amira), default)
                .ContinueWith(task => task.Result.Value);
        }

        var nour = await ProfileAsync(_nourKey);
        Assert.Equal(mariamPhoto, nour.PrimaryManager!.PhotoUrl);
        Assert.Equal(karimPhoto, Assert.Single(nour.DottedLineManagers).PhotoUrl);
        Assert.Equal(nourPhoto, Assert.Single((await ProfileAsync(_mariamKey)).DirectReports).PhotoUrl);
        Assert.Null(Assert.Single((await ProfileAsync(karimKey)).DirectReports).PhotoUrl);
        Assert.All((await HistoryAsync(_nourKey, PeopleAdmin(_amira))).Value.Rows, row => Assert.Equal(mariamPhoto, row.Manager!.PhotoUrl));
    }

    [Fact]
    public async Task Only_the_person_or_a_people_admin_changes_a_photo()
    {
        await SeedAsync();
        foreach (var viewer in new[] { Colleague(_sami), Manager(_mariam), TenantReader(_karim) })
        {
            Assert.Equal(PeopleAccess.ForbiddenCode, (await UploadAsync(_nourKey, viewer, Png())).Error.Code);
            Assert.Equal(PeopleAccess.ForbiddenCode, (await RemoveAsync(_nourKey, viewer)).Error.Code);
        }
        Assert.False(Directory.Exists(_photoRoot));

        Assert.True((await UploadAsync(_nourKey, PeopleAdmin(_amira), Png())).IsSuccess);
        Assert.True((await RemoveAsync(_nourKey, PeopleAdmin(_amira))).IsSuccess);
        Assert.Empty(Directory.GetFiles(Path.Combine(_photoRoot, $"{TenantA:N}")));
        Assert.True((await new EmployeePhotoQueryHandler(Db(TenantA)).Handle(new EmployeePhotoQuery(_nourKey), default)).IsFailure);
    }

    [Fact]
    public async Task A_file_that_is_not_an_image_or_is_too_large_is_refused()
    {
        await SeedAsync();
        var text = "<svg onload=alert(1)>"u8.ToArray();
        Assert.Equal("Use a JPEG, PNG or WebP image.", (await UploadAsync(_nourKey, Colleague(_nour), text, "me.png")).Error.Message);
        Assert.Equal("The photo is larger than 5 MB.",
            (await UploadAsync(_nourKey, Colleague(_nour), Png((int)EmployeePhotos.MaxBytes + 1))).Error.Message);
        Assert.Equal("Choose a photo.", (await UploadAsync(_nourKey, Colleague(_nour), [])).Error.Message);
        Assert.False(Directory.Exists(_photoRoot));
    }

    [Fact]
    public async Task The_store_refuses_keys_outside_the_tenant()
    {
        var store = Store(TenantA);
        await Assert.ThrowsAsync<ArgumentException>(() => store.DeleteAsync($"{TenantB:N}/{Guid.NewGuid():N}.png", default));
        Assert.Null(await store.OpenAsync($"{TenantA:N}/../{TenantB:N}/{Guid.NewGuid():N}.png", default));
        Assert.Null(await store.OpenAsync($"{TenantB:N}/{Guid.NewGuid():N}.png", default));
    }

    // --- Job history ------------------------------------------------------------------------------------

    private Task<EY.HRPlatform.SharedKernel.Results.Result<PeopleJobHistoryDto>> HistoryAsync(string key, PeopleViewer viewer)
        => new PeopleJobHistoryQueryHandler(Db(TenantA)).Handle(new PeopleJobHistoryQuery(key, viewer), default);

    [Fact]
    public async Task Job_history_rows_follow_title_and_manager_changes_newest_first()
    {
        await SeedAsync();
        await using (var db = Db(TenantA))
        {
            // A year ago Nour was promoted; three months ago she moved under Karim.
            var assignment = db.WorkAssignments.Single(item => item.EmployeeId == _nour);
            assignment.End(Today.AddYears(-1));
            var promoted = WorkAssignment.Create(TenantA, assignment.EmploymentId, _nour, assignment.OrgUnitId, TestCatalog.Job(TenantA, "Senior Analyst"),
                TestCatalog.Place(TenantA, "Tunis"), true, Today.AddYears(-1), null, WorkforceSourceType.Manual);
            db.WorkAssignments.Add(promoted);
            var line = db.ManagerRelationships.Single(item => item.SubjectEmployeeId == _nour);
            line.End(Today.AddMonths(-3));
            var karimAssignment = db.WorkAssignments.Single(item => item.EmployeeId == _karim);
            db.ManagerRelationships.Add(ManagerRelationship.Create(TenantA, _nour, _karim, promoted.Id, karimAssignment.Id,
                ReportingRelationshipType.PrimaryManager, Today.AddMonths(-3), WorkforceSourceType.Manual));
            await db.SaveChangesAsync();
        }

        var rows = (await HistoryAsync(_nourKey, PeopleAdmin(_amira))).Value.Rows;
        Assert.Equal(3, rows.Count);
        Assert.True(rows[0].IsCurrent);
        Assert.Equal(("Senior Analyst", "Karim Test"), (rows[0].JobTitle, rows[0].Manager!.DisplayName));
        Assert.Equal(("Senior Analyst", "Mariam Test"), (rows[1].JobTitle, rows[1].Manager!.DisplayName));
        Assert.Equal(("Analyst", "Mariam Test"), (rows[2].JobTitle, rows[2].Manager!.DisplayName));
        Assert.False(rows[1].IsCurrent);
        Assert.Equal("Operations", rows[2].UnitName);
    }

    [Fact]
    public async Task Job_history_is_for_hr_and_the_branch_manager_only()
    {
        await SeedAsync();
        Assert.True((await HistoryAsync(_nourKey, PeopleAdmin(_karim))).IsSuccess);
        Assert.True((await HistoryAsync(_nourKey, TenantReader(_karim))).IsSuccess);
        Assert.True((await HistoryAsync(_nourKey, Manager(_mariam))).IsSuccess);
        foreach (var viewer in new[] { Manager(_karim), Colleague(_sami), Colleague(_nour) })
            Assert.Equal(PeopleAccess.ForbiddenCode, (await HistoryAsync(_nourKey, viewer)).Error.Code);
    }

    // --- Profile: the mobile follows the Personal tab ---------------------------------------------------

    [Fact]
    public async Task The_profile_shows_the_mobile_to_the_person_hr_and_their_branch_manager_only()
    {
        await SeedAsync();
        Task<string?> PhoneAsync(EmployeeReadAudience audience, Guid viewer, Guid? branchOf = null)
        {
            var db = Db(TenantA);
            var organization = new Mock<IOrganizationService>();
            organization.Setup(o => o.GetUnitAsync(It.IsAny<Guid>(), It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new OrganizationUnitStateDto(Guid.NewGuid(), "OPS", "Operations", Guid.NewGuid(), "Department", null, null,
                    "Operations", OrgUnitLifecycleState.Active, DateOnly.MinValue, 1));
            return new PeopleProfileQueryHandler(db, organization.Object, new WorkforceChangeReader(db))
                .Handle(new PeopleProfileQuery(_nourKey, null, audience, branchOf, viewer), default)
                .ContinueWith(task => task.Result.Value.Identity.Phone);
        }

        Assert.NotNull(await PhoneAsync(EmployeeReadAudience.HrAdmin, _amira));
        Assert.NotNull(await PhoneAsync(EmployeeReadAudience.Manager, _mariam, _mariam));
        Assert.NotNull(await PhoneAsync(EmployeeReadAudience.Employee, _nour));
        Assert.Null(await PhoneAsync(EmployeeReadAudience.Manager, _karim, _karim));
        Assert.Null(await PhoneAsync(EmployeeReadAudience.Employee, _sami));
    }

    // --- Endpoints --------------------------------------------------------------------------------------

    [Fact]
    public async Task The_endpoints_need_a_profile_permission_and_pass_the_callers_own_identity()
    {
        var employeeId = Guid.NewGuid();
        var (none, noneSender) = Controller(Caller(employeeId));
        Assert.IsType<ForbidResult>(await none.GetPersonal("K", default));
        Assert.IsType<ForbidResult>(await none.UpdatePersonal("K", Body(), "\"1\"", default));
        Assert.IsType<ForbidResult>(await none.GetPhoto("K", null, default));
        Assert.IsType<ForbidResult>(await none.UploadPhoto("K", null, default));
        Assert.IsType<ForbidResult>(await none.RemovePhoto("K", default));
        Assert.IsType<ForbidResult>(await none.GetJobHistory("K", default));
        noneSender.VerifyNoOtherCalls();

        var (self, sender) = Controller(Caller(employeeId,
            (CorePermissions.EmployeeView, PermissionScopes.Self), (CorePermissions.ProfileSelfUpdate, PermissionScopes.Self)));
        var precondition = Assert.IsType<ObjectResult>(await self.UpdatePersonal("K", Body(), null, default));
        Assert.Equal(StatusCodes.Status412PreconditionFailed, precondition.StatusCode);

        sender.Setup(s => s.Send(It.IsAny<UpdatePeoplePersonalCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(EY.HRPlatform.SharedKernel.Results.Result.Failure<PeoplePersonalDto>(PeopleAccess.Forbidden("No.")));
        var forbidden = Assert.IsType<ObjectResult>(await self.UpdatePersonal("K", Body(), "\"7\"", default));
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
        sender.Verify(s => s.Send(
            It.Is<UpdatePeoplePersonalCommand>(c => c.ExpectedVersion == 7 && c.Viewer.EmployeeId == employeeId
                && c.Viewer.UpdatesSelf && !c.Viewer.ManagesPeople && !c.Viewer.ViewsTenant && !c.Viewer.ManagesTeam),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    private static ClaimsPrincipal Caller(Guid employeeId, params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim>
        {
            new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()),
            new(CustomClaimTypes.EmployeeId, employeeId.ToString()),
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
        };
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private static (PeopleProfileController Controller, Mock<ISender> Sender) Controller(ClaimsPrincipal caller)
    {
        var sender = new Mock<ISender>();
        return (new PeopleProfileController(sender.Object, new CoreAccessPolicyService(), new UnconfiguredEmployeePhotoStore())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        }, sender);
    }
}
