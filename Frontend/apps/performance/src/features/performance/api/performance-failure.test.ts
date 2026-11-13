import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@repo/api";
import { performanceFailure, reportPerformanceFailure, recoverPerformanceFailure } from "./performance-failure";
import { toast } from "sonner";
import { showStatus } from "@repo/ds/components/ui/status-pill";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@repo/ds/components/ui/status-pill", () => ({ showStatus: vi.fn() }));

describe("Performance failure recovery", () => {
  it("refreshes stale and invalid-state records and treats forbidden content as unavailable", () => {
    const error = (kind: string) => new ApiError(409, "Conflict", ["Server message"], null, { code: "Stable.Code", kind });
    expect(performanceFailure(error("Stale"))).toMatchObject({ refresh: true, message: "This changed since you opened it" });
    expect(performanceFailure(error("InvalidState")).refresh).toBe(true);
    expect(performanceFailure(error("Forbidden"))).toMatchObject({ refresh: true, unavailable: true });
    expect(performanceFailure(error("Validation")).refresh).toBe(false);
    expect(performanceFailure(new Error("Ordinary failure"))).toMatchObject({ refresh: false, kind: null, message: "Ordinary failure" });
  });

  it("shows one notification when both the mutation hook and its composer report the same failure", () => {
    const error = new ApiError(400, "Bad request", ["The weight must be a whole number"], null, { kind: "Validation" });
    reportPerformanceFailure(error);
    reportPerformanceFailure(error);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("The weight must be a whole number");
  });

  it("says a record changed under you in a quiet pill, not an error toast (B-456)", () => {
    vi.mocked(toast.error).mockClear();
    reportPerformanceFailure(new ApiError(409, "Conflict", ["Server stale message"], null, { kind: "Stale" }));
    expect(showStatus).toHaveBeenCalledWith("This changed since you opened it", { tone: "notice" });
    expect(toast.error).not.toHaveBeenCalled();
  });
});


it("awaits the record refresh after stale/invalid/forbidden actions and leaves validation drafts intact", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  for (const kind of ["Stale", "InvalidState", "Forbidden", "Validation"]) {
    await recoverPerformanceFailure(new ApiError(409, "Conflict", [kind], null, { kind }), refresh);
  }
  expect(refresh).toHaveBeenCalledTimes(3);
});
