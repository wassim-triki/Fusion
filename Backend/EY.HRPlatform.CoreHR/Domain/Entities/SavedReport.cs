using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public sealed class SavedReport : BaseEntity, ITenantEntity
{
    private SavedReport() { }
    public Guid TenantId { get; private set; }
    public Guid OwnerId { get; private set; }
    public string Name { get; private set; } = "";
    public string DefinitionJson { get; private set; } = "";
    public List<ReportShare> Shares { get; private set; } = [];

    public static SavedReport Create(Guid tenantId, Guid ownerId, string name, string definition)
    {
        var report = new SavedReport { TenantId = tenantId, OwnerId = ownerId };
        report.Change(name, definition);
        return report;
    }

    public void Change(string name, string definition)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 120) throw new ArgumentException("Name is required, up to 120 characters.");
        Name = name.Trim();
        DefinitionJson = definition;
        UpdatedAt = DateTime.UtcNow;
    }
}

public sealed class ReportShare
{
    private ReportShare() { }
    public Guid ReportId { get; private set; }
    public Guid RoleId { get; private set; }
    public static ReportShare Create(Guid reportId, Guid roleId) => new() { ReportId = reportId, RoleId = roleId };
}
