using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public enum EmployeeFieldArea
{
    About = 1,
    Personal = 2,
    Job = 3,
}

public enum EmployeeFieldType
{
    Text = 1,
    Tags = 2,
    Date = 3,
    Email = 4,
    Phone = 5,
    Address = 6,
    Section = 7,
}

public enum EmployeeFieldEditor
{
    Employee = 1,
    Hr = 2,
    EmployeeWithApproval = 3,
    DatedChange = 4,
}

/// <summary>One optimistic-concurrency boundary for a company's field catalogue.</summary>
public sealed class EmployeeFieldCatalog : BaseEntity, ITenantEntity
{
    private EmployeeFieldCatalog() { }

    public Guid TenantId { get; private set; }
    public uint Version { get; private set; }

    public static EmployeeFieldCatalog Create(Guid tenantId, string? actor)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("Tenant is required.", nameof(tenantId));
        return new EmployeeFieldCatalog { TenantId = tenantId, CreatedBy = actor };
    }

    public void Touch(string? actor)
    {
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }
}

/// <summary>
/// A field the company chose for its person page. A source key means the value remains in its authoritative
/// employee, employment or assignment record; a null source key means values live in <see cref="EmployeeFieldValue"/>.
/// </summary>
public sealed class EmployeeFieldDefinition : BaseEntity, ITenantEntity
{
    public const int MaxKeyLength = 80;
    public const int MaxLabelLength = 100;

    private EmployeeFieldDefinition() { }

    public Guid TenantId { get; private set; }
    public Guid CatalogId { get; private set; }
    public string Key { get; private set; } = string.Empty;
    public string Label { get; private set; } = string.Empty;
    public EmployeeFieldArea Area { get; private set; }
    public EmployeeFieldType Type { get; private set; }
    public EmployeeFieldEditor Editor { get; private set; }
    public bool Visible { get; private set; }
    public bool VisibleToEmployee { get; private set; }
    public bool VisibleToManager { get; private set; }
    public bool Required { get; private set; }
    public bool IsBuiltIn { get; private set; }
    public bool IsActive { get; private set; } = true;
    public int SortOrder { get; private set; }
    public string? SourceKey { get; private set; }
    public string? GalleryKey { get; private set; }

    public static EmployeeFieldDefinition Create(
        Guid tenantId,
        Guid catalogId,
        string key,
        string label,
        EmployeeFieldArea area,
        EmployeeFieldType type,
        EmployeeFieldEditor editor,
        bool visible,
        bool visibleToEmployee,
        bool visibleToManager,
        bool required,
        bool isBuiltIn,
        int sortOrder,
        string? sourceKey,
        string? galleryKey,
        string? actor)
    {
        var definition = new EmployeeFieldDefinition
        {
            TenantId = tenantId,
            CatalogId = catalogId,
            Key = RequireKey(key),
            IsBuiltIn = isBuiltIn,
            SourceKey = string.IsNullOrWhiteSpace(sourceKey) ? null : sourceKey.Trim(),
            GalleryKey = string.IsNullOrWhiteSpace(galleryKey) ? null : galleryKey.Trim(),
            CreatedBy = actor,
        };
        definition.Change(label, area, type, editor, visible, visibleToEmployee, visibleToManager, required, sortOrder, actor);
        definition.UpdatedAt = null;
        definition.UpdatedBy = null;
        return definition;
    }

    public void Change(
        string label,
        EmployeeFieldArea area,
        EmployeeFieldType type,
        EmployeeFieldEditor editor,
        bool visible,
        bool visibleToEmployee,
        bool visibleToManager,
        bool required,
        int sortOrder,
        string? actor)
    {
        var clean = CatalogName.Clean(label);
        if (clean.Length == 0 || clean.Length > MaxLabelLength)
            throw new ArgumentException("A label of at most 100 characters is required.", nameof(label));
        if (!Enum.IsDefined(area) || !Enum.IsDefined(type) || !Enum.IsDefined(editor))
            throw new ArgumentException("The field kind is not supported.");
        if (area == EmployeeFieldArea.Job && editor != EmployeeFieldEditor.DatedChange)
            throw new ArgumentException("Job fields change only through a dated change.");
        if (editor == EmployeeFieldEditor.DatedChange && area != EmployeeFieldArea.Job)
            throw new ArgumentException("Only Job fields use dated changes.");

        Label = clean;
        Area = area;
        Type = type;
        Editor = editor;
        Visible = visible;
        VisibleToEmployee = visibleToEmployee;
        VisibleToManager = visibleToManager;
        Required = required;
        SortOrder = sortOrder;
        IsActive = true;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }

    public void Retire(string? actor)
    {
        if (IsBuiltIn) throw new InvalidOperationException("Built-in fields cannot be removed.");
        IsActive = false;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }

    private static string RequireKey(string key)
    {
        var clean = CatalogName.Slug(key);
        if (clean.Length == 0 || clean.Length > MaxKeyLength)
            throw new ArgumentException("A key of at most 80 characters is required.", nameof(key));
        return clean;
    }
}

/// <summary>A custom field's value for one employee, stored as JSON so tags and ready-made sections keep shape.</summary>
public sealed class EmployeeFieldValue : BaseEntity, ITenantEntity
{
    private EmployeeFieldValue() { }

    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public Guid FieldId { get; private set; }
    public string ValueJson { get; private set; } = "null";

    public static EmployeeFieldValue Create(Guid tenantId, Guid employeeId, Guid fieldId, string valueJson, string? actor)
        => new()
        {
            TenantId = tenantId,
            EmployeeId = employeeId,
            FieldId = fieldId,
            ValueJson = valueJson,
            CreatedBy = actor,
        };

    public void Change(string valueJson, string? actor)
    {
        ValueJson = valueJson;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }
}
