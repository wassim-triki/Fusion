using System.Text.Json;

namespace EY.HRPlatform.CoreHR.Features.EmployeeFields;

public sealed record EmployeeFieldDefinitionDto(
    Guid? Id,
    string Key,
    string Label,
    string Area,
    string Type,
    string ChangedBy,
    bool Visible,
    bool VisibleToEmployee,
    bool VisibleToManager,
    bool Required,
    bool BuiltIn,
    int SortOrder,
    string? SourceKey,
    string? GalleryKey);

public sealed record EmployeeFieldGalleryItemDto(
    string Key,
    string Label,
    string Description,
    string Area,
    string Type,
    string ChangedBy);

public sealed record EmployeeFieldMissingPersonDto(
    string EmployeeKey,
    string DisplayName,
    string? JobTitle,
    IReadOnlyList<string> Missing);

public sealed record EmployeeFieldSettingsDto(
    uint? Version,
    IReadOnlyList<EmployeeFieldDefinitionDto> Fields,
    IReadOnlyList<EmployeeFieldGalleryItemDto> Gallery,
    IReadOnlyList<EmployeeFieldMissingPersonDto> RecordsToComplete);

public sealed record EmployeeFieldInput(
    Guid? Id,
    string Key,
    string Label,
    string Area,
    string Type,
    string ChangedBy,
    bool Visible,
    bool VisibleToEmployee,
    bool VisibleToManager,
    bool Required,
    int SortOrder,
    string? GalleryKey);

public sealed record UpdateEmployeeFieldsRequest(IReadOnlyList<EmployeeFieldInput>? Fields);

public sealed record EmployeeProfileFieldDto(
    string Key,
    string Label,
    string Area,
    string Type,
    JsonElement? Value,
    bool Required,
    bool CanEdit);

public sealed record UpdateEmployeeFieldValueRequest(JsonElement Value);
