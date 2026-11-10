namespace EY.HRPlatform.Performance.Domain.Objectives;

/// <summary>
/// Weights share evenly until someone sets one, always totalling 100 (D-40): the weights nobody chose split what the
/// chosen ones leave, to the hundredth, the last taking the rounding so the plan totals exactly 100. When the chosen
/// weights already reach 100 or more, the rest share nothing and the plan's readiness says so.
/// </summary>
public static class PlanWeights
{
    /// <summary>The even shares of <paramref name="remaining"/> across <paramref name="count"/> goals, summing to it exactly.</summary>
    public static IReadOnlyList<decimal> Shares(decimal remaining, int count)
    {
        if (count <= 0) return [];
        if (remaining <= 0m) return Enumerable.Repeat(0m, count).ToList();
        var each = Math.Floor(remaining / count * 100m) / 100m;
        var shares = Enumerable.Repeat(each, count).ToList();
        shares[^1] = remaining - each * (count - 1);
        return shares;
    }

    /// <summary>Gives each of a plan's goals nobody weighted its even share; call after any goal of the plan changes.</summary>
    public static void Rebalance(IEnumerable<Objective> planObjectives)
    {
        var goals = planObjectives.OrderBy(o => o.CreatedAt).ThenBy(o => o.Id).ToList();
        var shared = goals.Where(o => !o.PlanWeightIsSet).ToList();
        var remaining = 100m - goals.Where(o => o.PlanWeightIsSet).Sum(o => o.PlanWeight ?? 0m);
        var shares = Shares(remaining, shared.Count);
        for (var i = 0; i < shared.Count; i++) shared[i].ShareWeight(shares[i]);
    }
}
