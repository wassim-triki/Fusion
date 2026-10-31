using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public class Employee : AggregateRoot, ITenantEntity
{
    public const int MaxEmergencyContacts = 3;

    private readonly List<EmergencyContact> _emergencyContacts = [];

    private Employee() { }

    public Guid TenantId { get; private set; }

    /// <summary>
    /// Row version for optimistic concurrency control (mapped to PostgreSQL xmin).
    /// </summary>
    public uint Version { get; private set; }
    public string EmployeeNumber { get; private set; } = string.Empty;
    public string StableEmployeeKey { get; private set; } = string.Empty;
    public string FirstName { get; private set; } = string.Empty;
    public string LastName { get; private set; } = string.Empty;
    public string? PreferredName { get; private set; }
    public string? Email { get; private set; }
    public string? Phone { get; private set; }
    public string? Department { get; private set; }
    public string? PersonalEmail { get; private set; }
    public DateOnly? DateOfBirth { get; private set; }
    public string? HomeStreet { get; private set; }
    public string? HomeCity { get; private set; }
    public string? HomePostalCode { get; private set; }
    public string? HomeCountry { get; private set; }
    public IReadOnlyList<EmergencyContact> EmergencyContacts => _emergencyContacts;

    /// <summary>Storage key of the current profile photo; null when the person has none.</summary>
    public string? PhotoKey { get; private set; }
    public string FullName => $"{FirstName} {LastName}";
    public string DisplayName => !string.IsNullOrWhiteSpace(PreferredName)
        ? $"{PreferredName} {LastName}"
        : FullName;

    public static Employee Create(
        Guid tenantId,
        string firstName,
        string lastName,
        string? email,
        string? department = null,
        string? employeeNumber = null,
        string? phone = null)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId cannot be empty.", nameof(tenantId));

        if (string.IsNullOrWhiteSpace(firstName))
            throw new ArgumentException("First name cannot be empty.", nameof(firstName));

        if (string.IsNullOrWhiteSpace(lastName))
            throw new ArgumentException("Last name cannot be empty.", nameof(lastName));

        var id = Guid.NewGuid();
        return new Employee
        {
            Id = id,
            TenantId = tenantId,
            EmployeeNumber = NormalizeEmployeeNumber(employeeNumber),
            StableEmployeeKey = GenerateStableKey(id),
            FirstName = firstName.Trim(),
            LastName = lastName.Trim(),
            Email = NormalizeEmail(email),
            Phone = NormalizePhone(phone),
            Department = department?.Trim()
        };
    }

    public static Employee CreateSeeded(
        Guid id,
        Guid tenantId,
        string firstName,
        string lastName,
        string? email,
        string? department = null,
        string? employeeNumber = null,
        string? phone = null)
    {
        var employee = Create(tenantId, firstName, lastName, email, department, employeeNumber, phone);
        employee.Id = id;
        employee.StableEmployeeKey = GenerateStableKey(id);
        return employee;
    }

    public static Employee Create(
        Guid tenantId,
        string firstName,
        string lastName,
        string? email,
        DateTime hireDate,
        string? department = null,
        string? jobTitle = null,
        string? employeeNumber = null,
        string? phone = null,
        string? workLocation = null,
        string? employmentType = null)
        => Create(
            tenantId,
            firstName,
            lastName,
            email,
            department,
            employeeNumber,
            phone);

    /// <summary>
    /// Updates Core-owned identity/profile facts only (name, email, phone, preferred name).
    /// Workforce facts (job title, organization, manager, employment type/state) are owned by
    /// the canonical <c>Employment</c>/<c>WorkAssignment</c>/<c>ManagerRelationship</c> chain and
    /// are never written through this method.
    /// </summary>
    public void UpdateProfile(
        string firstName,
        string lastName,
        string? email,
        string? preferredName,
        string? phone)
    {
        if (string.IsNullOrWhiteSpace(firstName))
            throw new ArgumentException("First name cannot be empty.", nameof(firstName));

        if (string.IsNullOrWhiteSpace(lastName))
            throw new ArgumentException("Last name cannot be empty.", nameof(lastName));

        FirstName = firstName.Trim();
        LastName = lastName.Trim();
        Email = NormalizeEmail(email);
        PreferredName = NormalizePreferredName(preferredName);
        Phone = NormalizePhone(phone);
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdatePreferredName(string? preferredName)
    {
        PreferredName = NormalizePreferredName(preferredName);
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdatePhone(string? phone)
    {
        Phone = NormalizePhone(phone);
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Replaces the Personal tab in one go and returns the names of the sections that changed (empty when
    /// nothing did). Emergency contacts must be loaded. The names are labels for change history, never values.
    /// </summary>
    public IReadOnlyList<string> UpdatePersonalDetails(PersonalDetails details, DateOnly today)
    {
        var preferredName = NormalizePreferredName(details.PreferredName);
        if (preferredName?.Length > 100)
            throw new ArgumentException("Preferred name cannot exceed 100 characters.", nameof(details));
        var mobile = NormalizePhone(details.Mobile);
        var personalEmail = NormalizePersonalEmail(details.PersonalEmail);
        var address = NormalizeAddress(details.HomeAddress);
        if (details.DateOfBirth is { } born && (born >= today || born < new DateOnly(1900, 1, 1)))
            throw new ArgumentException("Date of birth must be a past date after 1900.", nameof(details));
        if (details.EmergencyContacts.Count > MaxEmergencyContacts)
            throw new ArgumentException($"Keep at most {MaxEmergencyContacts} emergency contacts.", nameof(details));
        var contacts = details.EmergencyContacts
            .Select(contact => EmergencyContactDetails.Normalize(contact.Name, contact.Relationship, contact.Phone))
            .ToList();

        var changed = new List<string>();
        if (preferredName != PreferredName) changed.Add("Preferred name");
        if (mobile != Phone) changed.Add("Mobile");
        if (personalEmail != PersonalEmail) changed.Add("Personal email");
        if (address != new HomeAddress(HomeStreet, HomeCity, HomePostalCode, HomeCountry)) changed.Add("Home address");
        if (details.DateOfBirth != DateOfBirth) changed.Add("Date of birth");
        var contactsChanged = !contacts.SequenceEqual(
            _emergencyContacts.OrderBy(item => item.Position).Select(item => item.ToDetails()));
        if (contactsChanged) changed.Add("Emergency contacts");
        if (changed.Count == 0)
            return changed;

        PreferredName = preferredName;
        Phone = mobile;
        PersonalEmail = personalEmail;
        (HomeStreet, HomeCity, HomePostalCode, HomeCountry) = (address.Street, address.City, address.PostalCode, address.Country);
        DateOfBirth = details.DateOfBirth;
        if (contactsChanged)
        {
            _emergencyContacts.Clear();
            _emergencyContacts.AddRange(contacts.Select((contact, index) => EmergencyContact.Create(TenantId, Id, index, contact)));
        }
        // Always touches the row, so its version moves even when only the contacts changed.
        UpdatedAt = DateTime.UtcNow;
        return changed;
    }

    /// <summary>The home address as stored (normalized parts).</summary>
    public HomeAddress CurrentHomeAddress => new(HomeStreet, HomeCity, HomePostalCode, HomeCountry);

    /// <summary>Normalizes an address the way the profile stores it; throws on a part that is too long.</summary>
    public static HomeAddress NormalizedHomeAddress(HomeAddress? address) => NormalizeAddress(address);

    /// <summary>Sets the home address alone (an approved request); returns whether it changed.</summary>
    public bool ReplaceHomeAddress(HomeAddress address)
    {
        var next = NormalizeAddress(address);
        if (next == CurrentHomeAddress)
            return false;
        (HomeStreet, HomeCity, HomePostalCode, HomeCountry) = (next.Street, next.City, next.PostalCode, next.Country);
        UpdatedAt = DateTime.UtcNow;
        return true;
    }

    /// <summary>Points the profile at a newly stored photo and returns the key of the one it replaces, if any.</summary>
    public string? ReplacePhoto(string photoKey)
    {
        if (string.IsNullOrWhiteSpace(photoKey))
            throw new ArgumentException("A photo key is required.", nameof(photoKey));
        var previous = PhotoKey;
        PhotoKey = photoKey;
        UpdatedAt = DateTime.UtcNow;
        return previous;
    }

    /// <summary>Clears the photo and returns the key of the one removed, if any.</summary>
    public string? RemovePhoto()
    {
        var previous = PhotoKey;
        PhotoKey = null;
        UpdatedAt = DateTime.UtcNow;
        return previous;
    }

    public void UpdateEmployeeNumber(string employeeNumber)
    {
        EmployeeNumber = NormalizeEmployeeNumber(employeeNumber);
        UpdatedAt = DateTime.UtcNow;
    }

    private static string? NormalizePreferredName(string? preferredName)
    {
        if (string.IsNullOrWhiteSpace(preferredName))
            return null;

        return preferredName.Trim();
    }

    private static string? NormalizePersonalEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return null;

        var normalized = email.Trim().ToLowerInvariant();
        if (normalized.Length > 256)
            throw new ArgumentException("Personal email cannot exceed 256 characters.", nameof(email));
        var at = normalized.IndexOf('@');
        if (at <= 0 || at != normalized.LastIndexOf('@') || normalized.Any(char.IsWhiteSpace)
            || !normalized[(at + 1)..].Contains('.') || normalized.EndsWith('.'))
            throw new ArgumentException("Personal email is not a valid address.", nameof(email));

        return normalized;
    }

    private static HomeAddress NormalizeAddress(HomeAddress? address)
    {
        static string? Part(string? value, int max, string label)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;
            var trimmed = value.Trim();
            if (trimmed.Length > max)
                throw new ArgumentException($"{label} cannot exceed {max} characters.", nameof(address));
            return trimmed;
        }

        return new HomeAddress(
            Part(address?.Street, 200, "Street"),
            Part(address?.City, 100, "City"),
            Part(address?.PostalCode, 20, "Postal code"),
            Part(address?.Country, 100, "Country"));
    }

    private static string GenerateStableKey(Guid id)
    {
        return $"E-{id:N}".ToUpperInvariant();
    }

    private static string NormalizeEmployeeNumber(string? employeeNumber)
    {
        if (string.IsNullOrWhiteSpace(employeeNumber))
            throw new ArgumentException("Employee Number is required.", nameof(employeeNumber));

        var normalized = employeeNumber.Trim().ToUpperInvariant();
        if (normalized.Length > 64)
        {
            throw new ArgumentException("EmployeeNumber cannot exceed 64 characters.", nameof(employeeNumber));
        }

        return normalized;
    }

    private static string? NormalizeEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return null;

        var normalized = email.Trim().ToLowerInvariant();
        if (normalized.Length > 256)
            throw new ArgumentException("Email cannot exceed 256 characters.", nameof(email));

        return normalized;
    }

    private static string? NormalizePhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone))
            return null;

        var normalized = phone.Trim();
        if (normalized.Length > 50)
        {
            throw new ArgumentException("Phone cannot exceed 50 characters.", nameof(phone));
        }

        return normalized;
    }

}
