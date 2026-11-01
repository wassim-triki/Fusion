using System.Text;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>What a sheet holds. A workbook can hold both, one per sheet.</summary>
public enum CompanyImportKind { People, Units, Unknown }

/// <summary>How Fusion came to a column's meaning. Weak needs a person: Fusion has a lean, not an answer.</summary>
public enum CompanyImportReadingOrigin { Rules, Weak, Ai, Unknown, Empty }

/// <summary>The meanings a column can have, per kind. <see cref="Out"/> leaves the column out.</summary>
public static class CompanyImportFields
{
    public const string Out = "out";

    public const string EmployeeNumber = "employeeNumber";
    public const string PersonId = "personId";
    public const string FirstName = "firstName";
    public const string LastName = "lastName";
    public const string FullName = "fullName";
    public const string PreferredName = "preferredName";
    public const string WorkEmail = "workEmail";
    public const string JobTitle = "jobTitle";
    public const string JobLevel = "jobLevel";
    public const string JobFamily = "jobFamily";
    public const string Unit = "unit";
    public const string Manager = "manager";
    public const string Place = "place";
    public const string StartDate = "startDate";
    public const string EndDate = "endDate";
    public const string Status = "status";

    public const string UnitCode = "unitCode";
    public const string UnitName = "unitName";
    public const string ParentUnit = "parentUnit";
    public const string UnitType = "unitType";
    public const string UnitHead = "unitHead";

    public static readonly IReadOnlyList<string> PeopleFields =
    [
        EmployeeNumber, PersonId, FirstName, LastName, FullName, PreferredName, WorkEmail, JobTitle, JobLevel, JobFamily,
        Unit, Manager, Place, StartDate, EndDate, Status,
    ];

    public static readonly IReadOnlyList<string> UnitFields = [UnitCode, UnitName, ParentUnit, UnitType, UnitHead];

    public static IReadOnlyList<string> For(CompanyImportKind kind)
        => kind == CompanyImportKind.Units ? UnitFields : kind == CompanyImportKind.People ? PeopleFields : [];

    // Headers compared lower-case with only letters and digits. Strong: Fusion is sure. Weak: a person decides, Fusion leans.
    private static readonly Dictionary<string, string> PeopleStrong = Map(new()
    {
        [EmployeeNumber] = ["employeenumber", "employeeno", "empno", "employeeid", "empid", "staffid", "staffnumber", "staffno", "matricule", "personnelnumber", "employeecode", "badgenumber"],
        [PersonId] = ["workerreference", "workerid", "workerref", "personid", "personreference"],
        [FirstName] = ["firstname", "givenname", "forename", "prenom"],
        [LastName] = ["lastname", "surname", "familyname", "nom", "nomdefamille"],
        [FullName] = ["fullname", "name", "employeename", "employee", "person", "displayname", "nomcomplet", "staffname"],
        [PreferredName] = ["preferredname", "knownas", "nickname"],
        [WorkEmail] = ["workemail", "email", "emailaddress", "mail", "businessemail", "companyemail", "workmail", "courriel"],
        [JobTitle] = ["jobtitle", "title", "displaytitle", "job", "poste", "fonction", "jobname", "position", "positiontitle"],
        [JobLevel] = ["joblevel", "level", "careerlevel", "niveau"],
        [JobFamily] = ["jobfamily", "family", "jobfunction", "careerfamily"],
        [Unit] = ["unit", "department", "dept", "team", "organization", "organisation", "orgunit", "division", "businessunit", "service", "departement", "unitcode", "departmentcode"],
        [Manager] = ["manager", "reportsto", "managerid", "managerreference", "linemanager", "supervisor", "managernumber", "manageremail", "managername", "directmanager", "managerref"],
        [Place] = ["location", "place", "office", "site", "city", "worklocation", "lieu", "workplace"],
        [StartDate] = ["startdate", "employmentstart", "hiredate", "dateofhire", "joined", "joiningdate", "joindate", "datedembauche", "dateembauche", "dateofjoining", "employmentstartdate", "start"],
        [EndDate] = ["employmentend", "enddate", "leavingdate", "terminationdate", "lastday", "datedesortie", "employmentenddate"],
        [Status] = ["lifecyclestatus", "status", "employmentstatus", "statut"],
        [Out] = ["salary", "pay", "wage", "basesalary", "grosssalary", "salaire", "iban", "bankaccount", "workdetailseffectivefrom"],
    });

    private static readonly Dictionary<string, string> PeopleWeak = Map(new()
    {
        [JobLevel] = ["grade", "band", "echelon", "seniority", "rank", "jobgrade", "payband"],
        [JobTitle] = ["role", "jobrole"],
        [PersonId] = ["id", "reference", "ref"],
        [JobFamily] = ["function", "jobcategory", "category"],
        [Place] = ["country", "region", "branch"],
        [StartDate] = ["since", "from"],
    });

    private static readonly Dictionary<string, string> UnitStrong = Map(new()
    {
        [UnitCode] = ["code", "businesscode", "unitcode", "departmentcode", "orgcode", "costcenter", "costcentre"],
        [UnitName] = ["name", "unit", "unitname", "department", "departmentname", "team", "teamname", "orgunit", "orgunitname", "division"],
        [ParentUnit] = ["parent", "parentcode", "parentbusinesscode", "parentunit", "parentname", "parentunitcode", "belongsto", "parentdepartment"],
        [UnitType] = ["type", "unittype", "kind", "organizationtype", "orgtype"],
        [UnitHead] = ["head", "lead", "leader", "headofunit", "owner", "responsable", "unithead", "manager", "heademployeenumber"],
        [Out] = ["budget", "costcode"],
    });

    private static readonly Dictionary<string, string> UnitWeak = Map(new()
    {
        [UnitCode] = ["id", "reference", "ref"],
        [ParentUnit] = ["reportsto", "under", "within"],
        [UnitType] = ["level", "tier"],
    });

    // Headers only one kind of sheet has, used to recognise a sheet before reading its columns.
    private static readonly HashSet<string> PeopleSigns =
    [
        "firstname", "lastname", "surname", "givenname", "email", "workemail", "emailaddress", "employeenumber", "employeeno", "empno",
        "employeeid", "startdate", "hiredate", "employmentstart", "manager", "reportsto", "linemanager", "jobtitle", "title", "position",
        "fullname", "employeename", "location", "workerreference", "matricule", "prenom",
    ];

    private static readonly HashSet<string> UnitSigns =
    [
        "parent", "parentcode", "parentbusinesscode", "parentunit", "parentname", "unitname", "unitcode", "departmentname", "head",
        "headofunit", "unittype", "organizationtype", "belongsto", "costcenter",
    ];

    /// <summary>Recognises a sheet from its headers: people if it names people, units if it names units and their parents.</summary>
    public static CompanyImportKind Recognise(IEnumerable<string?> headers)
    {
        var keys = headers.Select(Key).Where(key => key.Length > 0).ToList();
        var people = keys.Count(PeopleSigns.Contains);
        var units = keys.Count(UnitSigns.Contains);
        if (people >= 2 && people >= units) return CompanyImportKind.People;
        if (units >= 1 && keys.Any(key => UnitStrong.TryGetValue(key, out var field) && field == UnitName)) return CompanyImportKind.Units;
        if (people >= 1) return CompanyImportKind.People;
        return CompanyImportKind.Unknown;
    }

    /// <summary>The rules' reading of one header for a kind: a field and how sure Fusion is, or nothing.</summary>
    public static (string Field, CompanyImportReadingOrigin Origin)? Read(CompanyImportKind kind, string? header)
    {
        var key = Key(header);
        if (key.Length == 0) return null;
        if (key.StartsWith("fusion", StringComparison.Ordinal)) return (Out, CompanyImportReadingOrigin.Rules);
        var (strong, weak) = kind == CompanyImportKind.Units ? (UnitStrong, UnitWeak) : (PeopleStrong, PeopleWeak);
        if (strong.TryGetValue(key, out var field)) return (field, CompanyImportReadingOrigin.Rules);
        if (weak.TryGetValue(key, out field)) return (field, CompanyImportReadingOrigin.Weak);
        return null;
    }

    public static string Key(string? header)
    {
        if (string.IsNullOrWhiteSpace(header)) return string.Empty;
        var builder = new StringBuilder();
        foreach (var ch in header.Normalize(NormalizationForm.FormD).ToLowerInvariant())
            if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') builder.Append(ch);
        return builder.ToString();
    }

    private static Dictionary<string, string> Map(Dictionary<string, string[]> byField)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (field, keys) in byField)
            foreach (var key in keys) map.TryAdd(key, field);
        return map;
    }
}
