import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatePicker } from "./date-picker";

function Picker() {
  const [date, setDate] = useState("2026-01-10");
  const [time, setTime] = useState("09:00");
  return <DatePicker aria-label="Schedule" value={date} onChange={setDate}
    time={time} onTimeChange={setTime} timeLabel="Time" times={["09:00", "10:30"]} />;
}

describe("Date and time picker", () => {
  it("keeps one popover open to select a day and time, preserving both when reopened", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    await user.click(document.querySelector<HTMLButtonElement>('button[data-day="1/15/2026"]')!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Time" }));
    await user.click(screen.getByRole("option", { name: "10:30" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Schedule" })).toHaveTextContent("15 Jan 2026 · 10:30");
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByRole("combobox", { name: "Time" })).toHaveTextContent("10:30");
  });
});
