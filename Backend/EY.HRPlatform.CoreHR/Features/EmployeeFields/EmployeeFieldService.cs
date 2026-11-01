using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.EmployeeFields;

public sealed class EmployeeFieldService(CoreHRDbContext db, ITenantContext tenantContext)
{
    private sealed record Spec(
        string Key,
        string Label,
        EmployeeFieldArea Area,
        EmployeeFieldType Type,
        EmployeeFieldEditor Editor,
        bool Required,
        int SortOrder,
        string? SourceKey,
        string? GalleryKey = null,
        string? Description = null,
        bool VisibleToManager = true);

    private static readonly IReadOnlyList<Spec> BuiltIns =
    [
        new("about-me", "About me", EmployeeFieldArea.About, EmployeeFieldType.Text, EmployeeFieldEditor.Employee, false, 10, "about"),
        new("preferred-name", "Preferred name", EmployeeFieldArea.Personal, EmployeeFieldType.Text, EmployeeFieldEditor.Employee, false, 10, "preferredName"),
        new("phone", "Phone", EmployeeFieldArea.Personal, EmployeeFieldType.Phone, EmployeeFieldEditor.Employee, false, 20, "phone"),
        new("personal-email", "Personal email", EmployeeFieldArea.Personal, EmployeeFieldType.Email, EmployeeFieldEditor.Employee, false, 30, "personalEmail", VisibleToManager: false),
        new("home-address", "Home address", EmployeeFieldArea.Personal, EmployeeFieldType.Address, EmployeeFieldEditor.EmployeeWithApproval, false, 40, "homeAddress", VisibleToManager: false),
        new("emergency-contact", "Emergency contact", EmployeeFieldArea.Personal, EmployeeFieldType.Section, EmployeeFieldEditor.Employee, false, 50, "emergencyContacts", "emergency-contact", VisibleToManager: false),
        new("date-of-birth", "Date of birth", EmployeeFieldArea.Personal, EmployeeFieldType.Date, EmployeeFieldEditor.Hr, false, 60, "dateOfBirth", VisibleToManager: false),
        new("first-name", "First name", EmployeeFieldArea.Personal, EmployeeFieldType.Text, EmployeeFieldEditor.Hr, true, 900, "firstName"),
        new("last-name", "Last name", EmployeeFieldArea.Personal, EmployeeFieldType.Text, EmployeeFieldEditor.Hr, true, 910, "lastName"),
        new("work-email", "Work email", EmployeeFieldArea.Personal, EmployeeFieldType.Email, EmployeeFieldEditor.Hr, false, 920, "email"),
        new("hire-date", "Hire date", EmployeeFieldArea.Job, EmployeeFieldType.Date, EmployeeFieldEditor.DatedChange, true, 10, "hireDate"),
        new("job-title", "Job", EmployeeFieldArea.Job, EmployeeFieldType.Text, EmployeeFieldEditor.DatedChange, false, 20, "jobTitle"),
        new("work-location", "Place", EmployeeFieldArea.Job, EmployeeFieldType.Text, EmployeeFieldEditor.DatedChange, false, 30, "workLocation"),
        new("employment-type", "Employment type", EmployeeFieldArea.Job, EmployeeFieldType.Text, EmployeeFieldEditor.DatedChange, false, 40, "employmentType"),
    ];

    private static readonly IReadOnlyList<Spec> Gallery =
    [
        new("skills", "Skills", EmployeeFieldArea.About, EmployeeFieldType.Tags, EmployeeFieldEditor.Employee, false, 20, null, "skills", "Tags"),
        new("languages-spoken", "Languages spoken", EmployeeFieldArea.About, EmployeeFieldType.Tags, EmployeeFieldEditor.Employee, false, 30, null, "languages-spoken", "Tags"),
        new("certifications", "Certifications", EmployeeFieldArea.About, EmployeeFieldType.Tags, EmployeeFieldEditor.Employee, false, 40, null, "certifications", "Name, issuer, expiry"),
        new("pronouns", "Pronouns", EmployeeFieldArea.About, EmployeeFieldType.Text, EmployeeFieldEditor.Employee, false, 50, null, "pronouns", "Next to the name"),
        new("education", "Education", EmployeeFieldArea.Personal, EmployeeFieldType.Section, EmployeeFieldEditor.Employee, false, 60, null, "education", "School, degree, year"),
        new("emergency-contact", "Emergency contact", EmployeeFieldArea.Personal, EmployeeFieldType.Section, EmployeeFieldEditor.Employee, false, 70, null, "emergency-contact", "Name, relationship, phone", false),
        new("driving-licence", "Driving licence", EmployeeFieldArea.Personal, EmployeeFieldType.Text, EmployeeFieldEditor.Employee, false, 80, null, "driving-licence", "Category and expiry"),
        new("social-profiles", "Social profiles", EmployeeFieldArea.Personal, EmployeeFieldType.Tags, EmployeeFieldEditor.Employee, false, 90, null, "social-profiles", "LinkedIn, GitHub"),
        new("t-shirt-size", "T-shirt size", EmployeeFieldArea.Personal, EmployeeFieldType.Text, EmployeeFieldEditor.Employee, false, 100, null, "t-shirt-size", "XS to XXL"),
        new("dietary-needs", "Dietary needs", EmployeeFieldArea.Personal, EmployeeFieldType.Text, EmployeeFieldEditor.Employee, false, 110, null, "dietary-needs", "For events"),
    ];

    public async Task<Dictionary<string, FieldConfig>?> StoredPolicyAsync(CancellationToken cancellationToken)
    {
        var definitions = await ActiveDefinitionsAsync(cancellationToken);
        if (definitions.Count == 0) return null;
        return definitions.Where(item => item.SourceKey is not null && TenantSettingsDto.DefaultEmployeeFieldConfig.ContainsKey(item.SourceKey)).ToDictionary(
            item => item.SourceKey!,
            item => new FieldConfig(item.Visible, item.Required, item.VisibleToEmployee, item.VisibleToManager));
    }

    public async Task<EmployeeFieldSettingsDto> SettingsAsync(CancellationToken cancellationToken)
    {
        var catalog = await db.EmployeeFieldCatalogs.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        var definitions = await ActiveDefinitionsAsync(cancellationToken);
        var fields = definitions.Count == 0 ? DefaultDtos() : definitions.Select(ToDto).ToList();
        return new EmployeeFieldSettingsDto(
            catalog?.Version,
            fields.OrderBy(item => AreaOrder(item.Area)).ThenBy(item => item.SortOrder).ToList(),
            Gallery.Select(item => new EmployeeFieldGalleryItemDto(
                item.GalleryKey!, item.Label, item.Description!, item.Area.ToString(), item.Type.ToString(), item.Editor.ToString())).ToList(),
            await RecordsToCompleteAsync(definitions, cancellationToken));
    }

    public async Task<EmployeeFieldSettingsDto> SaveAsync(
        IReadOnlyList<EmployeeFieldInput> inputs,
        uint? expectedVersion,
        string? actor,
        CancellationToken cancellationToken)
    {
        if (inputs.Count is 0 or > 100) throw new ArgumentException("Between 1 and 100 fields is required.");
        var duplicate = inputs.GroupBy(item => item.Key.Trim(), StringComparer.OrdinalIgnoreCase).FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null) throw new ArgumentException($"Field key '{duplicate.Key}' is repeated.");

        var catalog = await db.EmployeeFieldCatalogs.SingleOrDefaultAsync(cancellationToken);
        if (catalog is null)
        {
            if (expectedVersion.HasValue) throw new ConcurrencyException("EmployeeFields", Guid.Empty);
            catalog = EmployeeFieldCatalog.Create(tenantContext.TenantId, actor);
            db.EmployeeFieldCatalogs.Add(catalog);
        }
        else if (!expectedVersion.HasValue || catalog.Version != expectedVersion.Value)
        {
            throw new ConcurrencyException("EmployeeFields", catalog.Id);
        }

        // One SaveChanges at the end: a refused input leaves no half-created catalogue behind.
        var existing = await db.EmployeeFieldDefinitions.Where(item => item.CatalogId == catalog.Id).ToListAsync(cancellationToken);
        if (existing.Count == 0)
        {
            foreach (var spec in BuiltIns)
            {
                var legacy = TenantSettingsDto.DefaultEmployeeFieldConfig.GetValueOrDefault(spec.SourceKey ?? string.Empty);
                var builtIn = FromSpec(catalog.Id, spec, legacy, actor);
                db.EmployeeFieldDefinitions.Add(builtIn);
                existing.Add(builtIn);
            }
        }

        var byKey = existing.ToDictionary(item => item.Key, StringComparer.OrdinalIgnoreCase);
        foreach (var input in inputs)
        {
            var key = CatalogName.Slug(input.Key);
            if (byKey.TryGetValue(key, out var definition))
            {
                if (definition.IsBuiltIn)
                {
                    var spec = BuiltIns.Single(item => item.Key == key);
                    var identity = spec.SourceKey is "firstName" or "lastName" or "email";
                    definition.Change(
                        spec.Label, spec.Area, spec.Type, spec.Editor,
                        identity || input.Visible, identity || input.VisibleToEmployee, identity || input.VisibleToManager,
                        spec.SourceKey is "firstName" or "lastName" or "hireDate" || input.Required,
                        input.SortOrder, actor);
                }
                else
                {
                    definition.Change(
                        input.Label, CustomArea(input.Area), ParseType(input.Type), CustomEditor(input.ChangedBy),
                        input.Visible, input.VisibleToEmployee, input.VisibleToManager, input.Required, input.SortOrder, actor);
                }
                continue;
            }

            var preset = input.GalleryKey is null ? null : Gallery.SingleOrDefault(item => item.GalleryKey == input.GalleryKey);
            var area = preset?.Area ?? CustomArea(input.Area);
            var type = preset?.Type ?? ParseType(input.Type);
            var editor = preset?.Editor ?? CustomEditor(input.ChangedBy);
            db.EmployeeFieldDefinitions.Add(EmployeeFieldDefinition.Create(
                tenantContext.TenantId, catalog.Id, key, input.Label, area, type, editor,
                input.Visible, input.VisibleToEmployee, input.VisibleToManager, input.Required,
                false, input.SortOrder, null, preset?.GalleryKey, actor));
        }

        var kept = inputs.Select(item => CatalogName.Slug(item.Key)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var definition in existing.Where(item => !item.IsBuiltIn && item.IsActive && !kept.Contains(item.Key)))
            definition.Retire(actor);

        catalog.Touch(actor);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyException("EmployeeFields", catalog.Id);
        }
        return await SettingsAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<EmployeeProfileFieldDto>> ProfileFieldsAsync(
        Guid employeeId,
        EmployeeReadAudience audience,
        Guid? viewerEmployeeId,
        bool canManageEmployees,
        CancellationToken cancellationToken)
    {
        audience = await EffectiveAudienceAsync(employeeId, audience, viewerEmployeeId, cancellationToken);
        var fields = await ActiveDefinitionsAsync(cancellationToken);
        if (fields.Count == 0) return [];
        var values = await db.EmployeeFieldValues.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId)
            .ToDictionaryAsync(item => item.FieldId, cancellationToken);
        return fields
            .Where(item => item.SourceKey is null && CanSee(item, employeeId, audience, viewerEmployeeId))
            .OrderBy(item => item.Area).ThenBy(item => item.SortOrder)
            .Select(item => new EmployeeProfileFieldDto(
                item.Key, item.Label, item.Area.ToString(), item.Type.ToString(),
                values.TryGetValue(item.Id, out var value) ? JsonSerializer.Deserialize<JsonElement>(value.ValueJson) : null,
                item.Required,
                CanEdit(item, employeeId, viewerEmployeeId, canManageEmployees)))
            .ToList();
    }

    public async Task<Result<EmployeeProfileFieldDto>> UpdateValueAsync(
        string employeeKey,
        string fieldKey,
        JsonElement value,
        EmployeeReadAudience audience,
        Guid? viewerEmployeeId,
        bool canManageEmployees,
        string? actor,
        CancellationToken cancellationToken)
    {
        var employee = await db.Employees.SingleOrDefaultAsync(item => item.StableEmployeeKey == employeeKey.Trim().ToUpperInvariant(), cancellationToken);
        if (employee is null) return Result.Failure<EmployeeProfileFieldDto>(new Error("Employee.NotFound", "Employee was not found."));
        var field = await db.EmployeeFieldDefinitions.SingleOrDefaultAsync(item => item.Key == CatalogName.Slug(fieldKey) && item.IsActive, cancellationToken);
        if (field is null || field.SourceKey is not null)
            return Result.Failure<EmployeeProfileFieldDto>(new Error("EmployeeField.NotFound", "Field was not found."));
        audience = await EffectiveAudienceAsync(employee.Id, audience, viewerEmployeeId, cancellationToken);
        if (!CanSee(field, employee.Id, audience, viewerEmployeeId))
            return Result.Failure<EmployeeProfileFieldDto>(new Error("EmployeeField.NotFound", "Field was not found."));
        if (!CanEdit(field, employee.Id, viewerEmployeeId, canManageEmployees))
            return Result.Failure<EmployeeProfileFieldDto>(new Error("EmployeeField.Forbidden", "You cannot change this field."));

        var normalized = NormalizeValue(field.Type, value);
        var json = normalized.GetRawText();
        var stored = await db.EmployeeFieldValues.SingleOrDefaultAsync(item => item.EmployeeId == employee.Id && item.FieldId == field.Id, cancellationToken);
        if (stored is null)
            db.EmployeeFieldValues.Add(EmployeeFieldValue.Create(tenantContext.TenantId, employee.Id, field.Id, json, actor));
        else
            stored.Change(json, actor);
        await db.SaveChangesAsync(cancellationToken);

        return Result.Success(new EmployeeProfileFieldDto(
            field.Key, field.Label, field.Area.ToString(), field.Type.ToString(), normalized,
            field.Required, true));
    }

    /// <summary>Whether the catalogue lets a person change one authoritative Personal field themselves.</summary>
    public async Task<bool?> CanSelfEditSourceAsync(string sourceKey, CancellationToken cancellationToken)
    {
        var field = await db.EmployeeFieldDefinitions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.IsActive && item.SourceKey == sourceKey, cancellationToken);
        return field is null ? null : field.Editor is EmployeeFieldEditor.Employee or EmployeeFieldEditor.EmployeeWithApproval;
    }

    /// <summary>A manager reads as a manager only inside their branch; anyone else they look at, as a colleague.</summary>
    private async Task<EmployeeReadAudience> EffectiveAudienceAsync(
        Guid employeeId, EmployeeReadAudience audience, Guid? viewerEmployeeId, CancellationToken cancellationToken)
        => audience == EmployeeReadAudience.Manager && viewerEmployeeId is { } managerId && managerId != employeeId
            && !(await ChangeSupport.BranchAsync(db, managerId, cancellationToken)).Contains(employeeId)
                ? EmployeeReadAudience.Employee
                : audience;

    private async Task<List<EmployeeFieldDefinition>> ActiveDefinitionsAsync(CancellationToken cancellationToken)
        => await db.EmployeeFieldDefinitions.AsNoTracking().Where(item => item.IsActive).ToListAsync(cancellationToken);

    private async Task<IReadOnlyList<EmployeeFieldMissingPersonDto>> RecordsToCompleteAsync(
        IReadOnlyList<EmployeeFieldDefinition> storedDefinitions,
        CancellationToken cancellationToken)
    {
        var required = (storedDefinitions.Count == 0
                ? DefaultDtos().Where(item => item.Required).Select(item => item.SourceKey).Where(item => item is not null).ToHashSet()
                : storedDefinitions.Where(item => item.Required).Select(item => item.SourceKey).Where(item => item is not null).ToHashSet())!;
        var customRequired = storedDefinitions.Where(item => item.Required && item.SourceKey is null).ToList();
        if (required.Count == 0 && customRequired.Count == 0) return [];

        var people = await db.Employees.AsNoTracking().OrderBy(item => item.LastName).ThenBy(item => item.FirstName).Take(250).ToListAsync(cancellationToken);
        var ids = people.Select(item => item.Id).ToList();
        var employments = await db.Employments.AsNoTracking().Where(item => ids.Contains(item.EmployeeId))
            .GroupBy(item => item.EmployeeId).Select(group => group.OrderByDescending(item => item.EffectiveFrom).First()).ToListAsync(cancellationToken);
        var employmentByPerson = employments.ToDictionary(item => item.EmployeeId);
        var now = DateTime.UtcNow;
        var employmentTypes = await db.EmploymentTypePeriods.AsNoTracking()
            .Where(item => ids.Contains(item.EmployeeId) && item.EffectiveFrom <= now
                && (item.EffectiveTo == null || now < item.EffectiveTo))
            .GroupBy(item => item.EmployeeId)
            .Select(group => group.OrderByDescending(item => item.EffectiveFrom).First())
            .ToListAsync(cancellationToken);
        var employmentTypeByPerson = employmentTypes.ToDictionary(item => item.EmployeeId);
        var employmentIds = employments.Select(item => item.Id).ToList();
        var assignments = await db.WorkAssignments.AsNoTracking().Where(item => employmentIds.Contains(item.EmploymentId) && item.IsPrimary)
            .GroupBy(item => item.EmployeeId).Select(group => group.OrderByDescending(item => item.EffectiveFrom).First()).ToListAsync(cancellationToken);
        var assignmentByPerson = assignments.ToDictionary(item => item.EmployeeId);
        var customIds = customRequired.Select(item => item.Id).ToList();
        var values = await db.EmployeeFieldValues.AsNoTracking().Where(item => ids.Contains(item.EmployeeId) && customIds.Contains(item.FieldId))
            .ToListAsync(cancellationToken);
        var hasCustom = values.Where(item => HasValue(item.ValueJson)).Select(item => (item.EmployeeId, item.FieldId)).ToHashSet();

        var result = new List<EmployeeFieldMissingPersonDto>();
        foreach (var person in people)
        {
            employmentByPerson.TryGetValue(person.Id, out var employment);
            assignmentByPerson.TryGetValue(person.Id, out var assignment);
            var missing = new List<string>();
            if (required.Contains("firstName") && string.IsNullOrWhiteSpace(person.FirstName)) missing.Add("First name");
            if (required.Contains("lastName") && string.IsNullOrWhiteSpace(person.LastName)) missing.Add("Last name");
            if (required.Contains("email") && string.IsNullOrWhiteSpace(person.Email)) missing.Add("Work email");
            if (required.Contains("phone") && string.IsNullOrWhiteSpace(person.Phone)) missing.Add("Phone");
            if (required.Contains("hireDate") && employment is null) missing.Add("Hire date");
            employmentTypeByPerson.TryGetValue(person.Id, out var employmentType);
            if (required.Contains("employmentType") && string.IsNullOrWhiteSpace(employmentType?.EmploymentType ?? employment?.EmploymentType)) missing.Add("Employment type");
            if (required.Contains("jobTitle") && string.IsNullOrWhiteSpace(assignment?.JobTitle)) missing.Add("Job");
            if (required.Contains("workLocation") && string.IsNullOrWhiteSpace(assignment?.WorkLocation)) missing.Add("Place");
            missing.AddRange(customRequired.Where(field => !hasCustom.Contains((person.Id, field.Id))).Select(field => field.Label));
            if (missing.Count > 0)
                result.Add(new EmployeeFieldMissingPersonDto(person.StableEmployeeKey, person.DisplayName, assignment?.JobTitle, missing));
        }
        return result.Take(50).ToList();
    }

    private EmployeeFieldDefinition FromSpec(Guid catalogId, Spec spec, FieldConfig? legacy, string? actor)
        => EmployeeFieldDefinition.Create(
            tenantContext.TenantId, catalogId, spec.Key, spec.Label, spec.Area, spec.Type, spec.Editor,
            legacy?.Visible ?? true, legacy?.VisibleToEmployee ?? true, legacy?.VisibleToManager ?? spec.VisibleToManager,
            legacy?.Required ?? spec.Required, true, spec.SortOrder, spec.SourceKey, spec.GalleryKey, actor);

    private static IReadOnlyList<EmployeeFieldDefinitionDto> DefaultDtos()
        => BuiltIns.Select(spec => new EmployeeFieldDefinitionDto(
            null, spec.Key, spec.Label, spec.Area.ToString(), spec.Type.ToString(), spec.Editor.ToString(),
            true, true, spec.VisibleToManager, spec.Required, true, spec.SortOrder, spec.SourceKey, spec.GalleryKey)).ToList();

    private static EmployeeFieldDefinitionDto ToDto(EmployeeFieldDefinition item)
        => new(item.Id, item.Key, item.Label, item.Area.ToString(), item.Type.ToString(), item.Editor.ToString(),
            item.Visible, item.VisibleToEmployee, item.VisibleToManager, item.Required, item.IsBuiltIn,
            item.SortOrder, item.SourceKey, item.GalleryKey);

    internal static bool CanSee(EmployeeFieldDefinition field, Guid subject, EmployeeReadAudience audience, Guid? viewer)
    {
        if (!field.Visible) return false;
        if (audience == EmployeeReadAudience.HrAdmin) return true;
        // Seen by: Everyone (both flags), Managers and HR (manager), You and HR (employee), HR (neither).
        // The person always sees their own field unless it is HR-only.
        if (viewer == subject) return field.VisibleToEmployee || field.VisibleToManager;
        if (audience == EmployeeReadAudience.Manager) return field.VisibleToManager;
        return field.VisibleToEmployee && field.VisibleToManager;
    }

    private static bool CanEdit(EmployeeFieldDefinition field, Guid subject, Guid? viewer, bool canManageEmployees)
        => field.Editor switch
        {
            EmployeeFieldEditor.Employee => viewer == subject,
            EmployeeFieldEditor.EmployeeWithApproval => viewer == subject,
            EmployeeFieldEditor.Hr => canManageEmployees,
            _ => false,
        };

    private static JsonElement NormalizeValue(EmployeeFieldType type, JsonElement value)
    {
        if (type == EmployeeFieldType.Tags)
        {
            if (value.ValueKind != JsonValueKind.Array) throw new ArgumentException("Tags must be an array.");
            var tags = value.EnumerateArray().Select(item => item.GetString()?.Trim() ?? string.Empty)
                .Where(item => item.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(30).ToList();
            if (tags.Any(item => item.Length > 100)) throw new ArgumentException("A tag cannot exceed 100 characters.");
            return JsonSerializer.SerializeToElement(tags);
        }
        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return JsonSerializer.SerializeToElement<string?>(null);
        if (value.ValueKind != JsonValueKind.String) throw new ArgumentException("This field needs text.");
        var text = value.GetString()?.Trim();
        if (text?.Length > 2000) throw new ArgumentException("A value cannot exceed 2,000 characters.");
        if (type == EmployeeFieldType.Date && !string.IsNullOrWhiteSpace(text) && !DateOnly.TryParseExact(text, "yyyy-MM-dd", out _))
            throw new ArgumentException("A date is written as YYYY-MM-DD.");
        return JsonSerializer.SerializeToElement(string.IsNullOrWhiteSpace(text) ? null : text);
    }

    private static bool HasValue(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.ValueKind switch
        {
            JsonValueKind.String => !string.IsNullOrWhiteSpace(doc.RootElement.GetString()),
            JsonValueKind.Array => doc.RootElement.GetArrayLength() > 0,
            JsonValueKind.Object => doc.RootElement.EnumerateObject().Any(),
            _ => false,
        };
    }

    private static EmployeeFieldArea ParseArea(string value)
        => Enum.TryParse<EmployeeFieldArea>(value, true, out var parsed) && Enum.IsDefined(parsed)
            ? parsed : throw new ArgumentException("Area must be About, Personal or Job.");

    private static EmployeeFieldType ParseType(string value)
        => Enum.TryParse<EmployeeFieldType>(value, true, out var parsed) && Enum.IsDefined(parsed)
            ? parsed : throw new ArgumentException("Field type is not supported.");

    private static EmployeeFieldEditor ParseEditor(string value)
        => Enum.TryParse<EmployeeFieldEditor>(value, true, out var parsed) && Enum.IsDefined(parsed)
            ? parsed : throw new ArgumentException("Changed by is not supported.");

    // A company's own field is stored in the values table: Job facts stay dated changes on their records, and there
    // is no approval queue for a free value, so neither applies to it.
    private static EmployeeFieldArea CustomArea(string value)
        => ParseArea(value) is var area && area != EmployeeFieldArea.Job
            ? area : throw new ArgumentException("A new field goes under About or Personal; Job changes through Make a change.");

    private static EmployeeFieldEditor CustomEditor(string value)
        => ParseEditor(value) is var editor && editor is EmployeeFieldEditor.Employee or EmployeeFieldEditor.Hr
            ? editor : throw new ArgumentException("A new field is changed by the person or by HR.");

    private static int AreaOrder(string area) => area switch { "About" => 1, "Personal" => 2, "Job" => 3, _ => 9 };
}
