using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Competencies by job (D-41, D-94): expectations per Core HR job family and level, written, drafted from the jobs or
/// read from the company's own file, and read in a review at the person's level with the next level's.
/// </summary>
public sealed class CompetencyExpectationsTests
{
    private static readonly JobCatalogueValue Engineering = new(Guid.NewGuid(), "Engineering", 1);
    private static readonly JobCatalogueValue Consulting = new(Guid.NewGuid(), "Consulting", 2);
    private static readonly JobCatalogueValue Junior = new(Guid.NewGuid(), "Junior", 1);
    private static readonly JobCatalogueValue Mid = new(Guid.NewGuid(), "Mid-level", 2);
    private static readonly JobCatalogueValue Senior = new(Guid.NewGuid(), "Senior", 3);
    private static readonly JobCatalogueValue Director = new(Guid.NewGuid(), "Director", 6);

    private const string Path = "/api/performance/settings/competencies";

    private static async Task<(ReviewWorld World, Guid Ownership, Guid Craft)> SetUpAsync()
    {
        var world = await CreateAsync();
        world.Factory.Core.Catalogue = new JobCatalogue([Engineering, Consulting], [Junior, Mid, Senior, Director],
        [
            new(Engineering.Id, Junior.Id, "Software Engineer I"), new(Engineering.Id, Mid.Id, "Software Engineer II"),
            new(Engineering.Id, Senior.Id, "Senior Engineer"), new(Consulting.Id, Senior.Id, "Senior Consultant"),
        ]);
        Place(world, world.Aicha, Engineering, Mid);
        Place(world, world.Fares, Engineering, Mid);
        Place(world, world.Tarek, Engineering, Senior);
        var ownership = await CreateCompetencyAsync(world, "Ownership");
        var craft = await CreateCompetencyAsync(world, "Craft");
        return (world, ownership, craft);
    }

    private static void Place(ReviewWorld world, WorkforceSnapshot person, JobCatalogueValue family, JobCatalogueValue level)
    {
        var placed = person with { JobFamilyId = family.Id, LevelId = level.Id };
        var core = world.Factory.Core;
        core.AllActive[core.AllActive.FindIndex(item => item.EmployeeId == person.EmployeeId)] = placed;
        core.ById[person.EmployeeId] = placed;
    }

    private static async Task<Guid> CreateCompetencyAsync(ReviewWorld world, string name)
        => (await Data(await world.Admin.PostAsJsonAsync(Path, new { name, description = $"{name} at work.", behaviors = Array.Empty<string>() })))
            .GetProperty("id").GetGuid();

    private static object Cell(Guid competency, JobCatalogueValue level, string? text, string source = "Written")
        => new { competencyId = competency, levelId = level.Id, text, source };

    [Fact]
    public async Task The_grid_reads_Core_HRs_families_with_the_levels_their_jobs_use_and_who_holds_each()
    {
        var (world, _, _) = await SetUpAsync();
        await using var _w = world;

        var grid = await Data(await world.Admin.GetAsync($"{Path}/by-job"));
        var families = grid.GetProperty("families").EnumerateArray().ToList();
        Assert.Equal(["Engineering", "Consulting"], families.Select(f => f.GetProperty("label").GetString()));
        var engineering = families[0];
        Assert.Equal(3, engineering.GetProperty("people").GetInt32());
        var levels = engineering.GetProperty("levels").EnumerateArray().ToList();
        // Director has no job in Engineering, so it isn't a column there.
        Assert.Equal(["Junior", "Mid-level", "Senior"], levels.Select(l => l.GetProperty("label").GetString()));
        Assert.Equal(JsonValueKind.Null, levels[0].GetProperty("example").ValueKind);
        Assert.Equal(2, levels[1].GetProperty("people").GetInt32());
        Assert.Equal("Aicha Ben Ali", levels[1].GetProperty("example").GetProperty("displayName").GetString());
        Assert.Equal(2, grid.GetProperty("competencies").GetArrayLength());
    }

    [Fact]
    public async Task Cells_are_written_rewritten_and_cleared_and_only_the_familys_levels_and_live_competencies_are_accepted()
    {
        var (world, ownership, craft) = await SetUpAsync();
        await using var _w = world;

        var saved = await Data(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new
        {
            familyId = Engineering.Id,
            cells = new[] { Cell(ownership, Mid, "  Owns a feature   end to end "), Cell(craft, Mid, "Writes tests first", "File"), Cell(ownership, Senior, "Owns a service", "Drafted") },
        }));
        Assert.Equal(3, saved.GetArrayLength());
        Assert.Contains(saved.EnumerateArray(), e => e.GetProperty("text").GetString() == "Owns a feature end to end");

        saved = await Data(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new
        {
            familyId = Engineering.Id,
            cells = new[] { Cell(ownership, Mid, "Owns a feature and its rollout"), Cell(craft, Mid, "") },
        }));
        Assert.Equal(2, saved.GetArrayLength());
        Assert.Contains(saved.EnumerateArray(), e => e.GetProperty("text").GetString() == "Owns a feature and its rollout" && e.GetProperty("source").GetString() == "Written");

        // Director isn't one of Engineering's levels; an unknown family doesn't exist.
        var wrongLevel = await Failure(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new { familyId = Engineering.Id, cells = new[] { Cell(ownership, Director, "Sets direction") } }));
        Assert.Equal((HttpStatusCode.BadRequest, "CompetencyExpectation.Level"), (wrongLevel.Status, wrongLevel.Code));
        var noFamily = await world.Admin.PutAsJsonAsync($"{Path}/expectations", new { familyId = Guid.NewGuid(), cells = new[] { Cell(ownership, Mid, "x") } });
        Assert.Equal(HttpStatusCode.NotFound, noFamily.StatusCode);

        // An archived competency takes no new words.
        var current = (await Data(await world.Admin.GetAsync(Path))).EnumerateArray().Single(c => c.GetProperty("id").GetGuid() == craft);
        await Data(await world.Admin.PostAsJsonAsync($"{Path}/{craft}/archive", new { expectedVersion = current.GetProperty("version").GetUInt32() }));
        var archived = await Failure(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new { familyId = Engineering.Id, cells = new[] { Cell(craft, Mid, "Writes tests") } }));
        Assert.Equal("CompetencyExpectation.Competency", archived.Code);
    }

    [Fact]
    public async Task A_settings_viewer_reads_the_grid_but_writes_drafts_and_files_need_settings_manage()
    {
        var (world, ownership, _) = await SetUpAsync();
        await using var _w = world;
        using var viewer = world.Factory.CreateAuthenticatedClient(permissions:
            [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.SettingsView, PermissionScopes.Tenant)]);
        using var employee = world.As(world.Aicha);

        using var read = await viewer.GetAsync($"{Path}/by-job");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var employeeRead = await employee.GetAsync($"{Path}/by-job");
        Assert.Equal(HttpStatusCode.Forbidden, employeeRead.StatusCode);

        foreach (var client in new[] { viewer, employee })
        {
            using var write = await client.PutAsJsonAsync($"{Path}/expectations", new { familyId = Engineering.Id, cells = new[] { Cell(ownership, Mid, "x") } });
            Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
            using var draft = await client.PostAsJsonAsync($"{Path}/expectations/draft", new { familyId = Engineering.Id });
            Assert.Equal(HttpStatusCode.Forbidden, draft.StatusCode);
            using var file = await client.PostAsync($"{Path}/expectations/read", FileForm(Engineering.Id, "Competency,Mid-level\nOwnership,x\n"));
            Assert.Equal(HttpStatusCode.Forbidden, file.StatusCode);
        }
        Assert.Empty(world.Factory.Ai.Requests);
    }

    [Fact]
    public async Task Another_company_neither_sees_nor_writes_this_companys_expectations()
    {
        var (world, ownership, _) = await SetUpAsync();
        await using var _w = world;
        await Data(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new { familyId = Engineering.Id, cells = new[] { Cell(ownership, Mid, "Owns a feature") } }));

        using var outsider = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), permissions:
            [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.SettingsView, PermissionScopes.Tenant),
                new(PerformancePermissions.SettingsManage, PermissionScopes.Tenant)]);
        var theirs = await Data(await outsider.GetAsync($"{Path}/by-job"));
        Assert.Empty(theirs.GetProperty("expectations").EnumerateArray());
        Assert.Empty(theirs.GetProperty("competencies").EnumerateArray());

        var write = await Failure(await outsider.PutAsJsonAsync($"{Path}/expectations", new { familyId = Engineering.Id, cells = new[] { Cell(ownership, Mid, "Overwritten") } }));
        Assert.Equal("CompetencyExpectation.Competency", write.Code);
        var ours = await Data(await world.Admin.GetAsync($"{Path}/by-job"));
        Assert.Equal("Owns a feature", Assert.Single(ours.GetProperty("expectations").EnumerateArray()).GetProperty("text").GetString());
    }

    [Fact]
    public async Task Your_own_file_is_read_cell_by_cell_and_what_couldnt_be_placed_is_named_and_left_empty()
    {
        var (world, ownership, craft) = await SetUpAsync();
        await using var _w = world;
        var csv = "Family,Competency,junior,Mid-level,Senior,Notes\n"
            + "Engineering,OWNERSHIP,Owns tasks,Owns a feature,,keep\n"
            + "Consulting,Ownership,Not ours,Not ours,Not ours,\n"
            + "Engineering,Craft,,Writes tests first,Shapes the test strategy,\n"
            + "Engineering,Curiosity,Asks why,Asks why,Asks why,\n";

        var read = await Data(await world.Admin.PostAsync($"{Path}/expectations/read", FileForm(Engineering.Id, csv)));

        var cells = read.GetProperty("cells").EnumerateArray()
            .Select(c => (c.GetProperty("competencyId").GetGuid(), c.GetProperty("levelId").GetGuid(), c.GetProperty("text").GetString())).ToList();
        Assert.Equal(4, cells.Count);
        Assert.Subset(cells.ToHashSet(), new HashSet<(Guid, Guid, string?)> { (ownership, Junior.Id, "Owns tasks"), (ownership, Mid.Id, "Owns a feature"),
            (craft, Mid.Id, "Writes tests first"), (craft, Senior.Id, "Shapes the test strategy") });
        Assert.Equal(6, read.GetProperty("of").GetInt32());
        Assert.Equal(["Notes", "Curiosity"], read.GetProperty("unread").EnumerateArray().Select(u => u.GetString()));
        Assert.Equal("framework.csv", read.GetProperty("fileName").GetString());

        // Reading saves nothing.
        Assert.Empty((await Data(await world.Admin.GetAsync($"{Path}/by-job"))).GetProperty("expectations").EnumerateArray());

        var notASheet = await Failure(await world.Admin.PostAsync($"{Path}/expectations/read", FileForm(Engineering.Id, "hello", "notes.txt")));
        Assert.Equal((HttpStatusCode.BadRequest, "CompetencyExpectation.File"), (notASheet.Status, notASheet.Code));
    }

    [Fact]
    public async Task Drafts_fill_only_the_empty_cells_from_the_jobs_and_save_nothing()
    {
        var (world, ownership, craft) = await SetUpAsync();
        await using var _w = world;
        await Data(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new
        {
            familyId = Engineering.Id,
            cells = new[] { Cell(ownership, Junior, "Owns tasks"), Cell(ownership, Mid, "Owns a feature"), Cell(ownership, Senior, "Owns a service"), Cell(craft, Junior, "Follows the checklist") },
        }));
        // Competency 2 (Craft) at levels 2 and 3 are the empty cells; the model also answers a written cell and an unknown one.
        world.Factory.Ai.Answer = new
        {
            cells = new object[]
            {
                new { competency = 2, level = 2, text = "Writes tests   before the code" },
                new { competency = 2, level = 3, text = "Shapes the test strategy across services" },
                new { competency = 1, level = 1, text = "Overwrites a written cell" },
                new { competency = 9, level = 1, text = "No such cell" },
            },
        };

        var drafted = await Data(await world.Admin.PostAsJsonAsync($"{Path}/expectations/draft", new { familyId = Engineering.Id }));

        var cells = drafted.GetProperty("cells").EnumerateArray().ToList();
        Assert.Equal(2, cells.Count);
        Assert.All(cells, c => Assert.Equal(craft, c.GetProperty("competencyId").GetGuid()));
        Assert.Contains(cells, c => c.GetProperty("levelId").GetGuid() == Mid.Id && c.GetProperty("text").GetString() == "Writes tests before the code");
        var request = JsonSerializer.Serialize(Assert.Single(world.Factory.Ai.Requests).Input);
        Assert.Contains("Software Engineer II", request);
        Assert.Contains("Owns a feature", request);
        Assert.Equal(4, (await Data(await world.Admin.GetAsync($"{Path}/by-job"))).GetProperty("expectations").GetArrayLength());

        world.Factory.Ai.IsAvailable = false;
        var off = await Failure(await world.Admin.PostAsJsonAsync($"{Path}/expectations/draft", new { familyId = Engineering.Id }));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, off.Status);
    }

    [Fact]
    public async Task A_review_reads_each_competency_at_the_persons_level_with_what_the_next_level_asks()
    {
        var (world, ownership, craft) = await SetUpAsync();
        await using var _w = world;
        await Data(await world.Admin.PutAsJsonAsync($"{Path}/expectations", new
        {
            familyId = Engineering.Id,
            cells = new[] { Cell(ownership, Mid, "Owns a feature"), Cell(ownership, Senior, "Owns a service"), Cell(craft, Mid, "Writes tests first") },
        }));
        var round = await world.CreateRoundAsync(peers: false, questions: false, competencyIds: [ownership, craft]);
        await world.LaunchAsync(round);

        var review = await Data(await world.As(world.Aicha).GetAsync($"/api/performance/reviews/{world.ReviewOf(round, world.Aicha)}"));

        var items = review.GetProperty("items").EnumerateArray().Where(i => i.GetProperty("kind").GetString() == "Competency")
            .ToDictionary(i => i.GetProperty("itemId").GetGuid());
        Assert.Equal("Mid-level", items[ownership].GetProperty("expectation").GetProperty("level").GetString());
        Assert.Equal("Owns a feature", items[ownership].GetProperty("expectation").GetProperty("text").GetString());
        Assert.Equal(("Senior", "Owns a service"), (items[ownership].GetProperty("nextExpectation").GetProperty("level").GetString(),
            items[ownership].GetProperty("nextExpectation").GetProperty("text").GetString()));
        // Nothing written for Senior Craft: no next level shown, never a "not set".
        Assert.Equal(JsonValueKind.Null, items[craft].GetProperty("nextExpectation").ValueKind);

        // Core HR unreachable: the review still opens, without expectations.
        world.Factory.Core.Unavailable = true;
        var offline = await Data(await world.As(world.Aicha).GetAsync($"/api/performance/reviews/{world.ReviewOf(round, world.Aicha)}"));
        Assert.All(offline.GetProperty("items").EnumerateArray().Where(i => i.GetProperty("kind").GetString() == "Competency"),
            i => Assert.Equal(JsonValueKind.Null, i.GetProperty("expectation").ValueKind));
    }

    private static MultipartFormDataContent FileForm(Guid familyId, string text, string name = "framework.csv")
    {
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes(text));
        file.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        return new MultipartFormDataContent { { new StringContent(familyId.ToString()), "familyId" }, { file, "file", name } };
    }
}
