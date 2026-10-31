using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>
/// Seeing Fusion as someone is read-only: a request carrying a view token may read, never change. Every service that
/// receives browser traffic runs this right after authentication, so the rule holds whichever door a request uses.
/// The one write a view may make is ending itself.
/// </summary>
public sealed class ReadOnlyViewMiddleware(RequestDelegate next)
{
    public const string EndPath = "/api/identity/view-as/end";

    public static bool IsViewing(ClaimsPrincipal principal) => principal.HasClaim(claim => claim.Type == CustomClaimTypes.ViewSession);

    public async Task InvokeAsync(HttpContext context)
    {
        if (IsViewing(context.User)
            && !HttpMethods.IsGet(context.Request.Method)
            && !HttpMethods.IsHead(context.Request.Method)
            && !HttpMethods.IsOptions(context.Request.Method)
            && !(HttpMethods.IsPost(context.Request.Method)
                && context.Request.Path.Equals(EndPath, StringComparison.OrdinalIgnoreCase)))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                type = "read-only-view",
                title = "Nothing can be changed while seeing Fusion as someone.",
                status = StatusCodes.Status403Forbidden,
            });
            return;
        }

        await next(context);
    }
}
