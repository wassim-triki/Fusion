using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Infrastructure.Services;

public static class InvitationLinkBuilder
{
    private const string DefaultPublicBaseUrl = "http://localhost:3000";
    private const string InviteAcceptPath = "/invite/accept";

    /// <summary><paramref name="company"/>: the company's slug, so the page wears its brand like its sign-in.</summary>
    public static string Build(IConfiguration configuration, string token, string? company = null)
    {
        var publicBaseUrl = configuration["Application:PublicBaseUrl"];
        return Build(publicBaseUrl, token, company);
    }

    public static string Build(string? publicBaseUrl, string token, string? company = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(token);

        var normalizedBaseUrl = string.IsNullOrWhiteSpace(publicBaseUrl)
            ? DefaultPublicBaseUrl
            : publicBaseUrl.TrimEnd('/');

        return $"{normalizedBaseUrl}{InviteAcceptPath}?token={Uri.EscapeDataString(token)}{CompanyQuery(company)}";
    }

    /// <summary>"&amp;company=slug" for a link that already has a query, or nothing without a company.</summary>
    public static string CompanyQuery(string? company)
        => string.IsNullOrWhiteSpace(company) ? string.Empty : $"&company={Uri.EscapeDataString(company)}";
}
