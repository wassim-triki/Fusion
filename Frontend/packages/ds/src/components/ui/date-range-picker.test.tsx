import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangePicker, type DateRangeValue } from "./date-range-picker";

function Picker({ initial = { from: "2026-01-10", to: "2026-01-20" } }: { initial?: DateRangeValue }) {
  const [value, setValue] = useState<DateRangeValue>(initial);
  return <><DateRangePicker aria-label="Dates" value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}

const day = (date: string) => document.querySelector<HTMLButtonElement>(`button[data-day="${date}"]`)!;

describe("Date range interaction", () => {
  it("moves each end on its own and never clears the other", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole("button", { name: "Dates" }));
    await user.click(day("1/5/2026"));
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-05","to":"2026-01-20"}');
    await user.click(day("1/25/2026"));
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-05","to":"2026-01-25"}');
    // Inside the range, the nearer end moves.
    await user.click(day("1/8/2026"));
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-08","to":"2026-01-25"}');
    await user.click(day("1/22/2026"));
    expect(screen.getByTestId("value")).toHaveTextContent('{"from":"2026-01-08","to":"2026-01-22"}');
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("orders the first two clicks of an empty range", async () => {
    const user = userEvent.setup();
    render(<Picker initial={{}} />);
    await user.click(screen.getByRole("button", { name: "Dates" }));
    const now = new Date();
    const pick = (d: number) => day(`${now.getMonth() + 1}/${d}/${now.getFullYear()}`);
    await user.click(pick(20));
    await user.click(pick(5));
    const iso = (d: number) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify({ from: iso(5), to: iso(20) }));
  });
});
