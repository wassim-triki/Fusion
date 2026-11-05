using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

public sealed class PeopleAccessStatusTests
{
    [Theory]
    [InlineData("Unprovisioned", "NoAccess", "No Fusion access")]
    [InlineData("InvitePending", "InvitationPending", "Invitation pending")]
    [InlineData("Active", "Active", "Active")]
    [InlineData("Inactive", "Suspended", "Suspended")]
    [InlineData("Conflict", "NeedsReview", "Needs review")]
    [InlineData("InviteExpired", "NeedsReview", "Needs review")]
    [InlineData("InviteRevoked", "NeedsReview", "Needs review")]
    [InlineData("InviteAccepted", "NeedsReview", "Needs review")]
    public async Task Projects_authoritative_identity_state_without_collapsing_it(
        string provisioningState,
        string expectedState,
        string expectedLabel)
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var employee = Employee.Create(
            tenantId,
            "Ada",
            "Lovelace",
            "ada@example.com",
            DateTime.UtcNow.AddYears(-1),
            employeeNumber: "E-001");
        db.Employees.Add(employee);
        await db.SaveChangesAsync();

        var status = new WorkforceAccountStatusDto(
            employee.Id,
            "ada@example.com",
            "Ada Lovelace",
            "Employee",
            [],
            provisioningState,
            provisioningState is "Active" or "Inactive" ? Guid.NewGuid() : null,
            provisioningState == "Active",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            provisioningState == "Conflict"
                ? new WorkforceAccountConflictDto("EmailConflict", "Review this identity.", true, null)
                : null);
        var reader = new Mock<IWorkforceAccountStatusReader>();
        reader.Setup(current => current.GetStatusesAsync(
                It.IsAny<IReadOnlyCollection<WorkforceAccountSubjectDto>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, WorkforceAccountStatusDto> { [employee.Id] = status });

        var result = await new PeopleAccessStatusQueryHandler(db, reader.Object)
            .Handle(new PeopleAccessStatusQuery(employee.StableEmployeeKey), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedState, result.Value.State);
        Assert.Equal(expectedLabel, result.Value.Label);
    }

    [Fact]
    public async Task Missing_work_email_is_no_access_without_asking_identity_to_guess()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var employee = Employee.Create(
            tenantId,
            "Amina",
            "Abid",
            null,
            DateTime.UtcNow.AddYears(-1),
            employeeNumber: "E-002");
        db.Employees.Add(employee);
        await db.SaveChangesAsync();
        var reader = new Mock<IWorkforceAccountStatusReader>(MockBehavior.Strict);

        var result = await new PeopleAccessStatusQueryHandler(db, reader.Object)
            .Handle(new PeopleAccessStatusQuery(employee.StableEmployeeKey), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("NoAccess", result.Value.State);
        Assert.Contains("work email", result.Value.Detail, StringComparison.OrdinalIgnoreCase);
        reader.VerifyNoOtherCalls();
    }

    [Fact]
    public void People_show_how_someone_who_signs_in_does_it()
    {
        // B-191: Identity reports the methods; People carries them for the Sign-in column.
        var status = new WorkforceAccountStatusDto(
            Guid.NewGuid(), "ada@example.com", "Ada Lovelace", "Employee", [], "Active", Guid.NewGuid(), true,
            DateTime.UtcNow, null, null, null, null, null, null, null, null, ["password", "company"]);

        var signIn = PeopleQueryHandler.SignInOf(status);

        Assert.Equal(PeopleSignInState.SignsIn, signIn.State);
        Assert.Equal(["password", "company"], signIn.Methods);
        Assert.Null(PeopleQueryHandler.SignInOf(status with { ProvisioningState = "InvitePending" }).Methods);
    }
}
