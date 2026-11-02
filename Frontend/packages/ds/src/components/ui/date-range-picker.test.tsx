import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangePicker, type DateRangeValue } from "./date-range-picker";

function Picker({ closed = () => {} }: { closed?: () => void }) {
  const [value, setValue] = useState<DateRangeValue>({ from: "2026-01-10", to: "2026-01-20" });
  return <><DateRangePicker aria-label="Dates" value={value} onChange={setValue}
    onOpenChange={open => { if (!open) closed(); }} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}

describe("Date range interaction", () => {
  it("starts a new range, accepts the same day twice and notifies closing", async () => {
    const user = userEvent.setup(), closed = vi.fn();
    render(<Picker closed={closed} />);
    await user.click(screen.getByRole("button", { name: "Dates" }));
    const day = document.querySelector<HTMLButtonElement>('button[data-day="1/15/2026"]')!;
    await user.click(day);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(document.querySelector<HTMLButtonElement>('button[data-day="1/15/2026"]')!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-15","to":"2026-01-15"}');
    expect(closed).toHaveBeenCalledOnce();
  });

  it("orders reverse clicks and starts fresh after reopening", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole("button", { name: "Dates" }));
    await user.click(document.querySelector<HTMLButtonElement>('button[data-day="1/25/2026"]')!);
    await user.click(document.querySelector<HTMLButtonElement>('button[data-day="1/5/2026"]')!);
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-05","to":"2026-01-25"}');
    await user.click(screen.getByRole("button", { name: "Dates" }));
    await user.click(document.querySelector<HTMLButtonElement>('button[data-day="1/12/2026"]')!);
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-12"}');
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
