using System.Globalization;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Reports;

public sealed class ReportService(CoreHRDbContext db, ITenantContext tenant, ReportEngine engine, IWorkforceAccessIdentityClient identity)
{
    public async Task<IReadOnlyList<ReportSummaryDto>> ListAsync(ReportViewer viewer, CancellationToken ct)
    {
        DemandSee(viewer);
        var roles = await identity.ReportRolesAsync(viewer.UserId, ct);
        var held = roles.Where(r => r.Held).Select(r => r.Id).ToList();
        return (await db.SavedReports.AsNoTracking().Include(r => r.Shares)
            .Where(r => r.OwnerId == viewer.UserId || r.Shares.Any(s => held.Contains(s.RoleId))).OrderBy(r => r.Name).ToListAsync(ct))
            .Select(r => new ReportSummaryDto(r.Id, r.Name, r.OwnerId == viewer.UserId && viewer.Build)).ToList();
    }

    public async Task<SavedReportDto?> GetAsync(Guid id, ReportViewer viewer, CancellationToken ct)
    {
        DemandSee(viewer);
        var report = await db.SavedReports.AsNoTracking().Include(r => r.Shares).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return null;
        if (report.OwnerId != viewer.UserId)
        {
            var held = (await identity.ReportRolesAsync(viewer.UserId, ct)).Where(r => r.Held).Select(r => r.Id).ToHashSet();
            if (!report.Shares.Any(s => held.Contains(s.RoleId))) return null;
        }
        var dto = Dto(report, viewer);
        var allowed = (await engine.FieldsAsync(viewer, ct)).Select(f => f.Key).ToHashSet();
        // A definition can contain sensitive filter literals. Never send those to a viewer who cannot see the field.
        if (!allowed.Contains(dto.Definition.GroupBy) || dto.Definition.Fields.Any(f => !allowed.Contains(f))
            || dto.Definition.Filters.Any(f => !allowed.Contains(f.Field))) throw new UnauthorizedAccessException();
        return dto;
    }

    public async Task<SavedReportDto?> SaveAsync(Guid? id, SaveReportRequest request, ReportViewer viewer, CancellationToken ct)
    {
        DemandBuild(viewer);
        // Validate the definition with the writer's current field visibility, not only its syntax.
        await engine.RunAsync(request.Definition, viewer, ct);
        SavedReport? report;
        if (id is { } existing)
        {
            report = await db.SavedReports.Include(r => r.Shares).SingleOrDefaultAsync(r => r.Id == existing && r.OwnerId == viewer.UserId, ct);
            if (report is null) return null;
            report.Change(request.Name, JsonSerializer.Serialize(request.Definition));
        }
        else
        {
            report = SavedReport.Create(tenant.TenantId, viewer.UserId, request.Name, JsonSerializer.Serialize(request.Definition));
            db.SavedReports.Add(report);
        }
        await db.SaveChangesAsync(ct);
        return Dto(report, viewer);
    }

    public async Task<bool> ShareAsync(Guid id, IReadOnlyList<Guid> roleIds, ReportViewer viewer, CancellationToken ct)
    {
        DemandBuild(viewer);
        var report = await db.SavedReports.Include(r => r.Shares).SingleOrDefaultAsync(r => r.Id == id && r.OwnerId == viewer.UserId, ct);
        if (report is null) return false;
        var roles = await identity.ReportRolesAsync(viewer.UserId, ct);
        if (roleIds.Count > 100 || roleIds.Any(id => !roles.Any(r => r.Id == id))) throw new ArgumentException("Choose the company's roles.");
        var chosen = roleIds.ToHashSet();
        report.Shares.RemoveAll(s => !chosen.Contains(s.RoleId));
        foreach (var role in chosen.Where(id => !report.Shares.Any(s => s.RoleId == id))) report.Shares.Add(ReportShare.Create(report.Id, role));
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> DeleteAsync(Guid id, ReportViewer viewer, CancellationToken ct)
    {
        DemandBuild(viewer);
        var report = await db.SavedReports.SingleOrDefaultAsync(r => r.Id == id && r.OwnerId == viewer.UserId, ct);
        if (report is null) return false;
        db.SavedReports.Remove(report);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public static PeopleExportFile Export(ReportRunDto run, bool excel)
    {
        var headers = new List<string> { "Group" };
        headers.AddRange(run.Periods.Select(p => p.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));
        headers.Add("Change");
        var rows = run.Series.Select(s => new List<string> { s.Label }.Concat(s.Values.Select(Number)).Append(Number(s.Change)).ToList()).ToList();
        rows.Add(new List<string> { "Everyone" }.Concat(run.Totals.Select(Number)).Append(Number(run.Totals[^1] - run.Totals[0])).ToList());
        if (run.Fields.Count > 0)
        {
            rows.Add([]);
            rows.Add(run.Fields.Select(f => f.Label).ToList());
            rows.AddRange(run.People.Select(p => run.Fields.Select(f => p.Values.GetValueOrDefault(f.Key) ?? "").ToList()));
        }
        return excel ? new(PeopleExport.Xlsx(headers, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Report.xlsx")
            : new(PeopleExport.Csv(headers, rows), "text/csv; charset=utf-8", "Report.csv");
    }

    private static string Number(decimal n) => n.ToString(CultureInfo.InvariantCulture);
    private static SavedReportDto Dto(SavedReport r, ReportViewer v) => new(r.Id, r.Name, JsonSerializer.Deserialize<ReportDefinition>(r.DefinitionJson)!,
        v.Build && r.OwnerId == v.UserId, r.OwnerId == v.UserId ? r.Shares.Select(s => s.RoleId).ToList() : []);
    private static void DemandSee(ReportViewer v) { if (!v.CanSee) throw new UnauthorizedAccessException(); }
    private static void DemandBuild(ReportViewer v) { DemandSee(v); if (!v.Build) throw new UnauthorizedAccessException(); }
}
