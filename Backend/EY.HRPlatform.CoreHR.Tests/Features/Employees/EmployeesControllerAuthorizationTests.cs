using System.Reflection;
using EY.HRPlatform.CoreHR.Controllers;
using Microsoft.AspNetCore.Authorization;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class EmployeesControllerAuthorizationTests
{
    [Fact]
    public void Controller_RequiresAuthenticatedUserAtClassLevel()
    {
        var authorizeAttribute = typeof(EmployeesController)
            .GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.NotNull(authorizeAttribute);
        Assert.Null(authorizeAttribute!.Roles);
    }

    [Theory]
    [InlineData(nameof(EmployeesController.GetAll))]
    [InlineData(nameof(EmployeesController.GetReadinessSummary))]
    [InlineData(nameof(EmployeesController.GetById))]
    public void PermissionControlledEndpoints_DoNotDeclareMethodRoleAttributes(string methodName)
    {
        var method = GetControllerMethod(methodName);
        var authorizeAttribute = method.GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.True(authorizeAttribute is null || string.IsNullOrWhiteSpace(authorizeAttribute.Roles));
    }

    private static MethodInfo GetControllerMethod(string methodName)
        => typeof(EmployeesController).GetMethod(methodName)
            ?? throw new InvalidOperationException($"Could not find EmployeesController.{methodName}.");
}
