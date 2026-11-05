using System.Net;
using System.Net.Sockets;
using System.Text;

namespace EY.HRPlatform.Identity.Features.SingleSignOn;

/// <summary>A provider call Fusion refused to make or could not complete; the message is safe to show an administrator.</summary>
public sealed class SsoBackchannelException(string message) : Exception(message);

public sealed record SsoHttpAnswer(int Status, string Body);

/// <summary>Reaches the local test provider (Development and Testing only); tests swap it for the in-process server.</summary>
public interface ISsoLoopbackChannel
{
    HttpMessageHandler CreateHandler();
}

public sealed class SocketsLoopbackChannel : ISsoLoopbackChannel
{
    public HttpMessageHandler CreateHandler() => new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false };
}

/// <summary>
/// Every outbound call to a provider (discovery, keys, token) goes through here, because an administrator types the
/// issuer address and Fusion must not become a way to reach its own network (B-191 D15). Https only; the host is
/// resolved and checked when the connection is made, so a name that later resolves elsewhere can't slip through;
/// no proxy, no redirects, five seconds, 256 KB. The one exception is the local test provider's exact prefix, in
/// Development and Testing only.
/// </summary>
public sealed class SsoBackchannel : IDisposable
{
    public const int MaxResponseBytes = 256 * 1024;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    private readonly SsoOptions _options;
    private readonly HttpClient _guarded;
    private readonly HttpClient? _loopback;

    public SsoBackchannel(SsoOptions options, ISsoLoopbackChannel? loopback = null, HttpMessageHandler? guardedHandler = null)
    {
        _options = options;
        _guarded = new HttpClient(guardedHandler ?? CreateGuardedHandler(), disposeHandler: true) { Timeout = Timeout };
        _loopback = options.TestProviderPrefix is not null && loopback is not null
            ? new HttpClient(loopback.CreateHandler(), disposeHandler: true) { Timeout = Timeout }
            : null;
    }

    public static SocketsHttpHandler CreateGuardedHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        UseCookies = false,
        ConnectTimeout = Timeout,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectCallback = ConnectGuardedAsync,
    };

    public async Task<string> GetAsync(string url, CancellationToken cancellationToken)
    {
        var answer = await SendAsync(new HttpRequestMessage(HttpMethod.Get, Checked(url, out var client)), client, cancellationToken);
        if (answer.Status is < 200 or > 299)
            throw new SsoBackchannelException($"{Host(url)} answered {answer.Status}.");
        return answer.Body;
    }

    public async Task<SsoHttpAnswer> PostFormAsync(
        string url, IReadOnlyDictionary<string, string> form, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Checked(url, out var client))
        {
            Content = new FormUrlEncodedContent(form),
        };
        return await SendAsync(request, client, cancellationToken);
    }

    /// <summary>Whether a browser may be sent to this address: https, or the local test provider's normalized prefix.</summary>
    public bool IsAllowedAddress(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var uri)
           && string.IsNullOrEmpty(uri.UserInfo)
           && (uri.Scheme == Uri.UriSchemeHttps || IsTestProvider(uri));

    // Compared after the address is normalized, so "dev-oidc/../" can't walk out of the test provider.
    private bool IsTestProvider(Uri uri)
        => _loopback is not null && _options.TestProviderPrefix is { } prefix
           && uri.AbsoluteUri.StartsWith(prefix, StringComparison.Ordinal);

    private Uri Checked(string url, out HttpClient client)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            throw new SsoBackchannelException("That isn't a web address.");

        if (IsTestProvider(uri))
        {
            client = _loopback!;
            return uri;
        }

        if (uri.Scheme != Uri.UriSchemeHttps)
            throw new SsoBackchannelException("The address must start with https://.");
        if (!string.IsNullOrEmpty(uri.UserInfo))
            throw new SsoBackchannelException("The address can't carry a user name.");

        client = _guarded;
        return uri;
    }

    private static async Task<SsoHttpAnswer> SendAsync(HttpRequestMessage request, HttpClient client, CancellationToken cancellationToken)
    {
        request.Headers.Accept.ParseAdd("application/json");
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (HttpRequestException exception) when (exception.InnerException is SsoBackchannelException refused)
        {
            throw refused;
        }
        catch (HttpRequestException)
        {
            throw new SsoBackchannelException($"Fusion couldn't reach {request.RequestUri!.Host}.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new SsoBackchannelException($"{request.RequestUri!.Host} took too long to answer.");
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            if (status is >= 300 and < 400)
                throw new SsoBackchannelException($"{request.RequestUri!.Host} redirected elsewhere; Fusion doesn't follow redirects.");

            if (response.Content.Headers.ContentLength > MaxResponseBytes)
                throw new SsoBackchannelException($"{request.RequestUri!.Host} answered with too much data.");

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var buffer = new byte[MaxResponseBytes + 1];
            var read = 0;
            while (read < buffer.Length)
            {
                var chunk = await stream.ReadAsync(buffer.AsMemory(read), cancellationToken);
                if (chunk == 0) break;
                read += chunk;
            }

            if (read > MaxResponseBytes)
                throw new SsoBackchannelException($"{request.RequestUri!.Host} answered with too much data.");

            return new SsoHttpAnswer(status, Encoding.UTF8.GetString(buffer, 0, read));
        }
    }

    private static async ValueTask<Stream> ConnectGuardedAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var host = context.DnsEndPoint.Host;
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(host, out var literal)
                ? [literal]
                : await Dns.GetHostAddressesAsync(host, cancellationToken);
        }
        catch (SocketException)
        {
            throw new SsoBackchannelException($"Fusion couldn't find {host}.");
        }

        // Every address must be public: a name that resolves to one private address among public ones is refused.
        if (addresses.Length == 0 || addresses.Any(IsForbidden))
            throw new SsoBackchannelException($"{host} points to a private network address; Fusion won't call it.");

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    /// <summary>Loopback, private, link-local (cloud metadata), shared (CGNAT), multicast, reserved and unspecified.</summary>
    public static bool IsForbidden(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();

        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any)
            || address.Equals(IPAddress.Broadcast) || address.Equals(IPAddress.IPv6None))
            return true;

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return b[0] == 0
                   || b[0] == 10
                   || b[0] == 127
                   || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)
                   || (b[0] == 169 && b[1] == 254)
                   || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                   || (b[0] == 192 && b[1] == 0 && b[2] == 0)
                   || (b[0] == 192 && b[1] == 168)
                   || (b[0] == 198 && (b[1] == 18 || b[1] == 19))
                   || b[0] >= 224;
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var b = address.GetAddressBytes();
            return address.IsIPv6LinkLocal
                   || address.IsIPv6SiteLocal
                   || address.IsIPv6Multicast
                   || (b[0] & 0xFE) == 0xFC; // unique local, fc00::/7
        }

        return true;
    }

    private static string Host(string url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;

    public void Dispose()
    {
        _guarded.Dispose();
        _loopback?.Dispose();
    }
}
