using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.SingleSignOn;

/// <summary>How someone confirms it's them before a sensitive change: their password, or a fresh provider sign-in.</summary>
public sealed record StepUpProof(string? Password, bool Sso);

public enum StepUpOutcome
{
    Confirmed,
    PasswordIncorrect,
    Locked,
    ConfirmationRequired,
}

/// <summary>
/// One confirmation for every sensitive change (B-191 D12): adding an administrator, the company provider's settings,
/// removing a proved domain, turning the requirement off and setting a first password. Someone without a password
/// confirms through their provider, which signs them in again.
/// </summary>
public sealed class SsoStepUp(UserManager<ApplicationUser> userManager, AppIdentityDbContext dbContext)
{
    public static readonly TimeSpan ConfirmationLifetime = TimeSpan.FromMinutes(5);

    public async Task<StepUpOutcome> VerifyAsync(ApplicationUser actor, StepUpProof? proof, CancellationToken cancellationToken)
    {
        if (proof?.Sso == true)
            return await ConsumeConfirmationAsync(actor.Id, cancellationToken)
                ? StepUpOutcome.Confirmed
                : StepUpOutcome.ConfirmationRequired;

        if (await userManager.IsLockedOutAsync(actor))
            return StepUpOutcome.Locked;

        if (string.IsNullOrEmpty(proof?.Password) || string.IsNullOrEmpty(actor.PasswordHash)
            || userManager.PasswordHasher.VerifyHashedPassword(actor, actor.PasswordHash, proof.Password) == PasswordVerificationResult.Failed)
        {
            await userManager.AccessFailedAsync(actor);
            return StepUpOutcome.PasswordIncorrect;
        }

        await userManager.ResetAccessFailedCountAsync(actor);
        return StepUpOutcome.Confirmed;
    }

    /// <summary>
    /// Uses up the caller's fresh provider confirmation: signed in again with prompt=login, as themselves, in the last
    /// five minutes, once.
    /// </summary>
    private async Task<bool> ConsumeConfirmationAsync(Guid userId, CancellationToken cancellationToken)
    {
        var since = DateTime.UtcNow - ConfirmationLifetime;
        var flow = await dbContext.SsoFlows
            .Where(item => item.Purpose == SsoFlowPurpose.Confirm && item.ActorUserId == userId && item.ResultUserId == userId
                && item.ConsumedAt == null && item.CompletedAt != null && item.CompletedAt >= since)
            .OrderByDescending(item => item.CompletedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (flow is null) return false;
        flow.Consume(DateTime.UtcNow);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public static (int Status, string Code, string Message) Refusal(StepUpOutcome outcome) => outcome switch
    {
        StepUpOutcome.Locked => (StatusCodes.Status429TooManyRequests, "password-locked", "Too many wrong passwords. Try again in a few minutes."),
        StepUpOutcome.ConfirmationRequired => (StatusCodes.Status403Forbidden, "confirmation-required", "Confirm it's you with your provider, then try again."),
        _ => (StatusCodes.Status403Forbidden, "password-incorrect", "That isn't your password."),
    };
}
