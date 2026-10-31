using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>
/// A file kept on a person's page (B-180): a contract, a certificate, a signed letter. The bytes live in the
/// tenant-partitioned file store; the row keeps what the Documents tab lists.
/// </summary>
public sealed class EmployeeDocument : ITenantEntity
{
    public const int MaxNameLength = 200;

    private EmployeeDocument() { }

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string ContentType { get; private set; } = string.Empty;
    public long SizeBytes { get; private set; }
    public string StorageKey { get; private set; } = string.Empty;
    public DateTime AddedAt { get; private set; }
    public string AddedByName { get; private set; } = string.Empty;
    /// <summary>The person who added it, when they have a record; they may remove it again.</summary>
    public Guid? AddedByEmployeeId { get; private set; }

    public static EmployeeDocument Add(Guid tenantId, Guid employeeId, string name, string contentType, long sizeBytes,
        string storageKey, string addedByName, Guid? addedByEmployeeId, DateTime addedAt)
    {
        if (tenantId == Guid.Empty || employeeId == Guid.Empty || string.IsNullOrWhiteSpace(storageKey))
            throw new ArgumentException("A document needs a tenant, a person and stored bytes.");
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0) throw new ArgumentException("A document needs a name.");
        if (trimmed.Length > MaxNameLength) trimmed = trimmed[..MaxNameLength];
        return new EmployeeDocument
        {
            TenantId = tenantId,
            EmployeeId = employeeId,
            Name = trimmed,
            ContentType = contentType,
            SizeBytes = sizeBytes,
            StorageKey = storageKey,
            AddedByName = string.IsNullOrWhiteSpace(addedByName) ? "Unknown" : addedByName.Trim(),
            AddedByEmployeeId = addedByEmployeeId,
            AddedAt = addedAt,
        };
    }
}
