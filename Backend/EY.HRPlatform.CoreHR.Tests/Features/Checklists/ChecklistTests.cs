using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Checklists;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Tests.Features.Checklists;

/// <summary>
/// B-184: a hire copies the company's joining template onto the person, dated from the first day; HR sees and ticks
/// everything, the manager sees the manager's and the person's tasks and ticks only the manager's, the person sees and
/// ticks only their own; nothing reads across companies. Celebrations: anniversaries, and birthdays only when shared.
/// </summary>
public sealed class ChecklistTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private sealed record World(string Db, Employee Joiner, Employee Manager, Employee Peer, Employee Stranger, WorkforceChange Hire);

    private static TenantContext Tenant(Guid id)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(id);
        return tenant;
    }

    private static CoreHRDbContext Db(World world, Guid? tenant = null) => TestDbContextFactory.Create(new TestTenantContext(tenant ?? TenantA), world.Db);

    private static ChecklistViewer Hr => new(null, "Amira Khelifi", true);
    private static ChecklistViewer As(Employee person) => new(person.Id, person.DisplayName, false);

    /// <summary>Tenant A: Sami manages Nour (hired, first day in 3 days) and Mariam; Omar works elsewhere in the company.</summary>
    private static async Task<World> SeedAsync(bool template = true)
    {
        var name = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(name);
        Employee Person(string first, Guid tenant) => Employee.Create(tenant, first, "Test", $"{first.ToLowerInvariant()}@example.com",
            employeeNumber: $"E-{Guid.NewGuid():N}");
        var manager = Person("Sami", TenantA);
        var joiner = Person("Nour", TenantA);
        var peer = Person("Mariam", TenantA);
        var stranger = Person("Omar", TenantA);
        seed.Employees.AddRange(manager, joiner, peer, stranger);
        if (template)
        {
            seed.ChecklistTemplateTasks.AddRange(
                ChecklistTemplateTask.Create(TenantA, ChecklistKind.Joining, "Prepare the contract", ChecklistOwner.Hr, -5, 0, null),
                ChecklistTemplateTask.Create(TenantA, ChecklistKind.Joining, "Plan the first week", ChecklistOwner.Manager, -2, 1, null),
                ChecklistTemplateTask.Create(TenantA, ChecklistKind.Joining, "Add your photo", ChecklistOwner.Person, 1, 2, null),
                ChecklistTemplateTask.Create(TenantA, ChecklistKind.Leaving, "Return the laptop", ChecklistOwner.Person, 0, 0, null));
        }
        var hire = WorkforceChange.Create(TenantA, joiner.Id, WorkforceChangeKind.Join, Today.AddDays(3), null, "{}", "hr", []);
        seed.WorkforceChanges.Add(hire);
        await seed.SaveChangesAsync();

        var details = new WorkforceChangeDetails(ManagerTo: new ChangePersonRef(manager.Id, manager.StableEmployeeKey, manager.DisplayName), IsHire: true);
        await using (var db = TestDbContextFactory.Create(new TestTenantContext(TenantA), name))
        {
            await ChecklistService.StageAsync(db, TenantA, hire, details, "hr", default);
            await db.SaveChangesAsync();
        }
        return new World(name, joiner, manager, peer, stranger, hire);
    }

    [Fact]
    public async Task A_hire_copies_the_joining_template_dated_from_the_first_day()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var list = Assert.Single((await new ChecklistService(db, Tenant(TenantA)).ForPersonAsync(world.Joiner.StableEmployeeKey, Hr, default))!);
        Assert.Equal("Joining", list.Kind);
        Assert.Equal(Today.AddDays(3), list.Day);
        Assert.Equal([Today.AddDays(-2), Today.AddDays(1), Today.AddDays(4)], list.Tasks.Select(task => task.DueDate));
    }

    [Fact]
    public async Task Without_a_template_no_checklist_is_made()
    {
        var world = await SeedAsync(template: false);
        await using var db = Db(world);
        Assert.Empty(db.Checklists);
    }

    [Fact]
    public async Task Each_viewer_sees_only_their_part()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var service = new ChecklistService(db, Tenant(TenantA));
        async Task<string[]> Owners(ChecklistViewer viewer) => (await service.ForPersonAsync(world.Joiner.StableEmployeeKey, viewer, default))!
            .SelectMany(list => list.Tasks).Select(task => task.Owner).ToArray();

        Assert.Equal(["hr", "manager", "person"], await Owners(Hr));
        Assert.Equal(["manager", "person"], await Owners(As(world.Manager)));
        Assert.Equal(["person"], await Owners(As(world.Joiner)));
        Assert.Empty(await Owners(As(world.Peer)));
    }

    [Fact]
    public async Task Only_the_owner_or_HR_ticks_a_task_and_it_records_who_and_when()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var service = new ChecklistService(db, Tenant(TenantA));
        var tasks = db.ChecklistTasks.ToDictionary(task => task.Owner, task => task.Id);

        Assert.Equal(ChecklistService.TickOutcome.NotFound, (await service.SetDoneAsync(tasks[ChecklistOwner.Manager], true, As(world.Joiner), default)).Outcome);
        Assert.Equal(ChecklistService.TickOutcome.Forbidden, (await service.SetDoneAsync(tasks[ChecklistOwner.Person], true, As(world.Manager), default)).Outcome);
        Assert.Equal(ChecklistService.TickOutcome.NotFound, (await service.SetDoneAsync(tasks[ChecklistOwner.Hr], true, As(world.Peer), default)).Outcome);

        var (outcome, done) = await service.SetDoneAsync(tasks[ChecklistOwner.Manager], true, As(world.Manager), default);
        Assert.Equal(ChecklistService.TickOutcome.Done, outcome);
        Assert.Equal(world.Manager.DisplayName, done!.DoneBy);
        Assert.NotNull(done.DoneAt);

        var (_, undone) = await service.SetDoneAsync(tasks[ChecklistOwner.Manager], false, Hr, default);
        Assert.Null(undone!.DoneBy);
        Assert.Null(undone.DoneAt);
    }

    [Fact]
    public async Task Another_company_cannot_see_or_tick_the_tasks()
    {
        var world = await SeedAsync();
        Guid taskId;
        await using (var a = Db(world)) taskId = a.ChecklistTasks.First().Id;
        await using var db = Db(world, TenantB);
        var service = new ChecklistService(db, Tenant(TenantB));
        Assert.Null(await service.ForPersonAsync(world.Joiner.StableEmployeeKey, Hr, default));
        Assert.Equal(ChecklistService.TickOutcome.NotFound, (await service.SetDoneAsync(taskId, true, Hr, default)).Outcome);
        Assert.Empty(await service.WorkAsync(Hr, "en", default));
    }

    [Fact]
    public async Task Needs_you_shows_each_owner_their_tasks_and_the_joiner_their_first_week()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var service = new ChecklistService(db, Tenant(TenantA));

        var manager = Assert.Single(await service.WorkAsync(As(world.Manager), "en", default));
        Assert.Equal($"Welcome {world.Joiner.DisplayName}", manager.Title);
        Assert.Equal(["Plan the first week"], manager.Steps!.Select(step => step.Label));

        var joiner = Assert.Single(await service.WorkAsync(As(world.Joiner), "en", default));
        Assert.Equal("Your first week", joiner.Title);
        Assert.Equal("/core/profile#checklist", joiner.Href);

        Assert.Equal(["Prepare the contract"], Assert.Single(await service.WorkAsync(Hr, "en", default)).Steps!.Select(step => step.Label));
        Assert.Empty(await service.WorkAsync(As(world.Peer), "en", default));
    }

    [Fact]
    public async Task Cancelling_the_change_removes_its_checklist()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        await ChecklistService.RemoveForChangeAsync(db, world.Hire.Id, default);
        await db.SaveChangesAsync();
        Assert.Empty(db.Checklists);
        Assert.Empty(db.ChecklistTasks);
    }

    [Fact]
    public async Task Celebrations_show_anniversaries_and_only_shared_birthdays_to_the_people_around()
    {
        var name = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow;
        Employee mariam, nour, omar, zed;
        await using (var seed = TestDbContextFactory.CreateWithoutTenant(name))
        {
            Employee Person(Guid tenant, string first, DateOnly born, bool shares, int years)
            {
                var person = Employee.Create(tenant, first, "Test", $"{first.ToLowerInvariant()}@example.com", employeeNumber: $"E-{Guid.NewGuid():N}");
                person.UpdatePersonalDetails(new PersonalDetails(null, null, null, null, born, []), Today);
                person.SetBirthdaySharing(shares);
                seed.Employees.Add(person);
                seed.Employments.Add(Employment.Start(tenant, person.Id, now.Date.AddDays(2).AddYears(-years), null, WorkforceSourceType.Manual));
                return person;
            }
            var soon = Today.AddDays(5).AddYears(-30);
            var sami = Person(TenantA, "Sami", soon, true, 1);
            mariam = Person(TenantA, "Mariam", soon, true, 3);
            nour = Person(TenantA, "Nour", soon, false, 2);
            omar = Person(TenantA, "Omar", soon, true, 4);
            zed = Person(TenantB, "Zed", soon, true, 5);
            void Reports(Employee who, Employee to) => seed.ManagerRelationships.Add(ManagerRelationship.Create(TenantA, who.Id, to.Id,
                Guid.NewGuid(), Guid.NewGuid(), ReportingRelationshipType.PrimaryManager, now.AddYears(-1), WorkforceSourceType.Manual));
            Reports(mariam, sami);
            Reports(nour, sami);
            await seed.SaveChangesAsync();
        }

        await using var db = TestDbContextFactory.Create(new TestTenantContext(TenantA), name);
        var items = await Celebrations.UpcomingAsync(db, nour.Id, Today, Today.AddDays(14), "en", default);
        var titles = items.Select(item => item.Title).ToList();

        Assert.Contains("Mariam Test: 3 years here", titles);
        Assert.Contains("Mariam Test's birthday", titles);
        Assert.Contains("Sami Test's birthday", titles);
        Assert.Contains("2 years here for you", titles);
        Assert.DoesNotContain("Your birthday", titles);
        Assert.DoesNotContain(titles, title => title.Contains("Omar") || title.Contains("Zed"));
        Assert.All(items.Where(item => item.Kind == "birthday"), item => Assert.Equal(Today.AddDays(5), item.Date));
    }
}
