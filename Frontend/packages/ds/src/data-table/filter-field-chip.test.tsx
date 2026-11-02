import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterFieldChip } from "./data-table-filters";
import type { DataTableFilterValue } from "./use-data-table";

function Filter({ single = false, dates = false }: { single?: boolean; dates?: boolean }) {
  const [value, setValue] = useState<DataTableFilterValue>();
  return <><FilterFieldChip field={dates ? { id: "date", label: "Date", type: "dateRange" } : {
    id: "team", label: "Team", type: "options", single,
    options: ["Sales", "Design", "Engineering", "Support", "Finance", "People", "Legal", "Operations", "Research", "Marketing"].map(value => ({ value, label: value }))
  }} value={value} onChange={setValue} /><output>{JSON.stringify(value ?? null)}</output></>;
}

describe("Filter chip interactions", () => {
  it("applies multiple choices live and stays open when the last choice is cleared", async () => {
    const user = userEvent.setup();
    render(<Filter />);
    await user.click(screen.getByRole("button", { name: "Filter by Team" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Sales" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Sales" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Design" }));
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent('["Sales","Design"]');
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Sales" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Design" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("[]");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Engineering" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Team filter" }));
    expect(screen.getByRole("button", { name: "Filter by Team" })).toBeInTheDocument();
  });

  it("bounds a long menu and finds choices beyond the initial list", async () => {
    const user = userEvent.setup();
    render(<Filter />);
    await user.click(screen.getByRole("button", { name: "Filter by Team" }));
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(8);
    expect(screen.getByText("Showing 8 of 10. Search to narrow.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Team" }), "marketing");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Marketing" }));
    await user.clear(screen.getByRole("textbox", { name: "Team" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Marketing" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(8);
  });

  it("searches, navigates from search, and closes with Escape from search", async () => {
    const user = userEvent.setup();
    render(<Filter />);
    await user.click(screen.getByRole("button", { name: "Filter by Team" }));
    const search = screen.getByRole("textbox", { name: "Team" });
    await user.click(search);
    await user.type(search, "eng");
    expect(screen.queryByRole("menuitemcheckbox", { name: "Sales" })).not.toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemcheckbox", { name: "Engineering" })).toHaveFocus();
    await user.click(search);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("commits single choices and closes the menu", async () => {
    const user = userEvent.setup();
    render(<Filter single />);
    await user.click(screen.getByRole("button", { name: "Filter by Team" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Sales" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent('["Sales"]');
  });

  it("keeps a date filter open until the second day is chosen", async () => {
    const user = userEvent.setup();
    render(<Filter dates />);
    await user.click(screen.getByRole("button", { name: "Filter by Date" }));
    const day = document.querySelector<HTMLButtonElement>("button[data-day]")!;
    const date = day.dataset.day!;
    await user.click(day);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(document.querySelector<HTMLButtonElement>(`button[data-day="${date}"]`)!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const value = JSON.parse(screen.getByRole("status", { hidden: true }).textContent!);
    expect(value.from).toBe(value.to);
  });
});

