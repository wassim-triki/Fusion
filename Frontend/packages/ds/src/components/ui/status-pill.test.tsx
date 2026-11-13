import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { showStatus } from "./status-pill";

afterEach(() => vi.useRealTimers());

describe("showStatus (B-456)", () => {
  it("says what just happened in one pill, replaces it with the next, and leaves by itself", () => {
    vi.useFakeTimers();
    act(() => showStatus("Saved"));
    expect(screen.getByRole("status").textContent).toBe("Saved");

    act(() => showStatus("This changed since you opened it", { tone: "notice" }));
    const pill = screen.getByRole("status"); // throws on two
    expect(pill.textContent).toBe("This changed since you opened it");
    expect(pill.dataset.tone).toBe("notice");

    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
