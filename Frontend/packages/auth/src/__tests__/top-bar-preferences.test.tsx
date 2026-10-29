import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { TopBarPreferences } from "../components/top-bar-preferences";

const { mockSetLanguage, mockRefresh } = vi.hoisted(() => ({
  mockSetLanguage: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../language", () => ({
  useLanguage: () => ["en", mockSetLanguage, false],
}));
vi.mock("@repo/api/query", () => ({
  useRefreshFusionAttention: () => mockRefresh,
}));
vi.mock("@repo/ds/shell", () => ({
  LanguageMenu: ({
    failed,
    onChange,
  }: {
    failed: boolean;
    onChange: (value: string) => void;
  }) => (
    <button
      type="button"
      data-failed={String(failed)}
      onClick={() => onChange("fr")}
    >
      language
    </button>
  ),
  ThemeToggle: () => <span>theme</span>,
}));

beforeEach(() => {
  mockSetLanguage.mockReset();
  mockRefresh.mockReset();
});

describe("TopBarPreferences", () => {
  it("saves the language on the account, then asks the bell again in it", async () => {
    mockSetLanguage.mockResolvedValue(undefined);
    render(<TopBarPreferences />);

    await userEvent.click(screen.getByRole("button", { name: "language" }));

    expect(mockSetLanguage).toHaveBeenCalledWith("fr");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.getByText("theme")).toBeInTheDocument();
  });

  it("marks the menu when the save fails and leaves the bell alone", async () => {
    mockSetLanguage.mockRejectedValue(new Error("offline"));
    render(<TopBarPreferences />);

    await userEvent.click(screen.getByRole("button", { name: "language" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "language" })).toHaveAttribute(
        "data-failed",
        "true"
      )
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
