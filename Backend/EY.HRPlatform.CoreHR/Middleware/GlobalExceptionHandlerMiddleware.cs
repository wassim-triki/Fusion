using System.Net;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence.Interceptors;
using EY.HRPlatform.SharedKernel.Api;

namespace EY.HRPlatform.CoreHR.Middleware;

public class GlobalExceptionHandlerMiddleware(RequestDelegate next, ILogger<GlobalExceptionHandlerMiddleware> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (EntityNotFoundException ex)
        {
            logger.LogWarning(ex, "Entity not found: {EntityType} for {Method} {Path}",
                ex.EntityType, context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.NotFound, ex.Message);
        }
        catch (DuplicateEntityException ex)
        {
            logger.LogWarning(ex, "Duplicate entity: {EntityType} for {Method} {Path}",
                ex.EntityType, context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.Conflict, ex.Message);
        }
        catch (CatalogConflictException ex)
        {
            logger.LogWarning(ex, "Catalogue conflict for {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.Conflict, ex.Message);
        }
        catch (ConcurrencyException ex)
        {
            logger.LogWarning(ex, "Concurrency conflict: {EntityType} {EntityId} for {Method} {Path}",
                ex.EntityType, ex.EntityId, context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.Conflict, ex.Message);
        }
        catch (InvalidTenantActivationStateException ex)
        {
            logger.LogWarning(ex, "Invalid tenant activation state for {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.Conflict, ex.Message);
        }
        catch (TenantAccessDeniedException ex)
        {
            logger.LogWarning(ex, "Tenant access denied for {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.Forbidden, "Tenant access denied.");
        }
        catch (ArgumentException ex)
        {
            logger.LogWarning(ex, "Validation error for {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.BadRequest, ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteErrorResponseAsync(context, HttpStatusCode.InternalServerError, "An unexpected error occurred.");
        }
    }

    private static async Task WriteErrorResponseAsync(HttpContext context, HttpStatusCode statusCode, string message)
    {
        if (context.Response.HasStarted)
            return;

        context.Response.StatusCode = (int)statusCode;
        context.Response.ContentType = "application/json";

        var response = ApiResponse.Failure(message);
        var json = JsonSerializer.Serialize(response, JsonOptions);
        await context.Response.WriteAsync(json);
    }
}
