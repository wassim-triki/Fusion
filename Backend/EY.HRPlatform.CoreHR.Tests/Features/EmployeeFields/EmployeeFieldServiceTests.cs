using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.EmployeeFields;

public sealed class EmployeeFieldServiceTests
{
    [Fact]
    public async Task Gallery_fields_are_tenant_scoped_and_enforce_visibility_and_editing_on_the_server()
    {
        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var database = Guid.NewGuid().ToString();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId), database);
        var person = Employee.Create(tenantId, "Aicha", "Bouazizi", "aicha@example.test", employeeNumber: "CDG-1");
        var colleague = Employee.Create(tenantId, "Omar", "Mansour", "omar@example.test", employeeNumber: "CDG-2");
        db.Employees.AddRange(person, colleague);
        await db.SaveChangesAsync();

        var service = new EmployeeFieldService(db, TestTenantContext.WithTenant(tenantId));
        var defaults = await service.SettingsAsync(default);
        var fields = defaults.Fields.Select(Input).ToList();
        fields.Add(new EmployeeFieldInput(null, "skills", "Skills", "About", "Tags", "Employee",
            true, true, true, false, 20, "skills"));
        fields.Add(new EmployeeFieldInput(null, "languages-spoken", "Languages spoken", "About", "Tags", "Employee",
            true, true, false, false, 30, "languages-spoken"));
        var saved = await service.SaveAsync(fields, null, "admin", default);
        Assert.NotNull(saved.Version);

        var forbidden = await service.UpdateValueAsync(person.StableEmployeeKey, "skills",
            JsonSerializer.SerializeToElement(new[] { "Playwright" }), EmployeeReadAudience.Employee, colleague.Id, false, "Omar", default);
        Assert.Equal("EmployeeField.Forbidden", forbidden.Error.Code);

        var updated = await service.UpdateValueAsync(person.StableEmployeeKey, "skills",
            JsonSerializer.SerializeToElement(new[] { "Playwright", "API testing", "Playwright" }),
            EmployeeReadAudience.Employee, person.Id, false, "Aicha", default);
        Assert.True(updated.IsSuccess);
        Assert.Equal(2, updated.Value.Value!.Value.GetArrayLength());
        Assert.True((await service.UpdateValueAsync(person.StableEmployeeKey, "languages-spoken",
            JsonSerializer.SerializeToElement(new[] { "Arabic", "French" }),
            EmployeeReadAudience.Employee, person.Id, false, "Aicha", default)).IsSuccess);

        var own = await service.ProfileFieldsAsync(person.Id, EmployeeReadAudience.Employee, person.Id, false, default);
        Assert.Equal(["skills", "languages-spoken"], own.Select(item => item.Key));
        var seenByColleague = await service.ProfileFieldsAsync(person.Id, EmployeeReadAudience.Employee, colleague.Id, false, default);
        Assert.Equal(["skills"], seenByColleague.Select(item => item.Key));
        Assert.All(seenByColleague, item => Assert.False(item.CanEdit));

        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateValueAsync(person.StableEmployeeKey, "skills",
            JsonSerializer.SerializeToElement("not tags"), EmployeeReadAudience.Employee, person.Id, false, "Aicha", default));

        await using var otherDb = TestDbContextFactory.Create(TestTenantContext.WithTenant(otherTenantId), database);
        var otherService = new EmployeeFieldService(otherDb, TestTenantContext.WithTenant(otherTenantId));
        Assert.Empty(await otherService.ProfileFieldsAsync(person.Id, EmployeeReadAudience.HrAdmin, null, true, default));
        var crossTenant = await otherService.UpdateValueAsync(person.StableEmployeeKey, "skills",
            JsonSerializer.SerializeToElement(new[] { "No" }), EmployeeReadAudience.HrAdmin, null, true, "other", default);
        Assert.Equal("Employee.NotFound", crossTenant.Error.Code);
    }

    [Fact]
    public async Task Core_identity_and_required_invariants_survive_catalogue_updates()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new EmployeeFieldService(db, TestTenantContext.WithTenant(tenantId));
        var defaults = await service.SettingsAsync(default);
        var changed = defaults.Fields.Select(field => Input(field) with
        {
            Visible = false,
            VisibleToEmployee = false,
            VisibleToManager = false,
            Required = false,
        }).ToList();

        var saved = await service.SaveAsync(changed, null, "admin", default);
        foreach (var key in new[] { "first-name", "last-name" })
        {
            var field = saved.Fields.Single(item => item.Key == key);
            Assert.True(field.Visible && field.VisibleToEmployee && field.VisibleToManager && field.Required);
        }
        Assert.True(saved.Fields.Single(item => item.Key == "work-email").Visible);
        Assert.True(saved.Fields.Single(item => item.Key == "hire-date").Required);
    }

    [Fact]
    public async Task Own_fields_stay_out_of_job_and_hidden_fields_cannot_be_written()
    {
        var tenantId = Guid.NewGuid();
        var database = Guid.NewGuid().ToString();
        EmployeeFieldService Request() => new(TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId), database), TestTenantContext.WithTenant(tenantId));
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId), database);
        var person = Employee.Create(tenantId, "Aicha", "Bouazizi", "aicha@example.test", employeeNumber: "CDG-1");
        db.Employees.Add(person);
        await db.SaveChangesAsync();
        var service = new EmployeeFieldService(db, TestTenantContext.WithTenant(tenantId));
        var fields = (await service.SettingsAsync(default)).Fields.Select(Input).ToList();

        // Each refused save is its own request; neither may leave a catalogue behind for the next one.
        await Assert.ThrowsAsync<ArgumentException>(() => Request().SaveAsync(
            [.. fields, new EmployeeFieldInput(null, "grade", "Grade", "Job", "Text", "DatedChange", true, true, true, false, 50, null)],
            null, "admin", default));
        await Assert.ThrowsAsync<ArgumentException>(() => Request().SaveAsync(
            [.. fields, new EmployeeFieldInput(null, "bank", "Bank", "Personal", "Text", "EmployeeWithApproval", true, true, false, false, 50, null)],
            null, "admin", default));

        await service.SaveAsync(
            [.. fields,
                new EmployeeFieldInput(null, "badge", "Badge number", "Personal", "Text", "Hr", true, false, false, false, 50, null),
                new EmployeeFieldInput(null, "first-day", "First day on site", "Personal", "Date", "Employee", true, false, true, false, 60, null)],
            null, "admin", default);

        var own = await service.ProfileFieldsAsync(person.Id, EmployeeReadAudience.Employee, person.Id, false, default);
        Assert.Equal(["first-day"], own.Select(item => item.Key));
        var hidden = await service.UpdateValueAsync(person.StableEmployeeKey, "badge",
            JsonSerializer.SerializeToElement("B-1"), EmployeeReadAudience.Employee, person.Id, false, "Aicha", default);
        Assert.Equal("EmployeeField.NotFound", hidden.Error.Code);
        Assert.True((await service.UpdateValueAsync(person.StableEmployeeKey, "badge",
            JsonSerializer.SerializeToElement("B-1"), EmployeeReadAudience.HrAdmin, null, true, "hr", default)).IsSuccess);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateValueAsync(person.StableEmployeeKey, "first-day",
            JsonSerializer.SerializeToElement("next monday"), EmployeeReadAudience.Employee, person.Id, false, "Aicha", default));
    }

    private static EmployeeFieldInput Input(EmployeeFieldDefinitionDto field)
        => new(field.Id, field.Key, field.Label, field.Area, field.Type, field.ChangedBy,
            field.Visible, field.VisibleToEmployee, field.VisibleToManager, field.Required, field.SortOrder, field.GalleryKey);
}
