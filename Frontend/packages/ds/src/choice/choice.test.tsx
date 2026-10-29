import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  ChoiceMatrix,
  FilterChips,
  OptionCards,
  QuickPicks,
  Segmented,
} from "./choice";

const CADENCES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
] as const;

function ControlledSegmented({
  onChange,
}: {
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState<string>("weekly");
  return (
    <Segmented
      label="Cadence"
      value={value}
      options={CADENCES}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("Segmented", () => {
  // Arrow keys come from Radix's roving focus, which happy-dom doesn't drive; the radio semantics are what we check.
  it("is one radio group whose options are radios", async () => {
    const onChange = vi.fn();
    render(<ControlledSegmented onChange={onChange} />);

    expect(
      screen.getByRole("radiogroup", { name: "Cadence" })
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(onChange).toHaveBeenLastCalledWith("monthly");
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Weekly" })).not.toBeChecked();
  });
});

describe("ChoiceMatrix", () => {
  const rows = [
    { key: "plans", label: "Plans and goals" },
    { key: "deadlines", label: "Deadline reminders" },
  ];
  const columns = [
    { value: "required", label: "Required" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ] as const;

  it("gives each row its own radio group named after it", async () => {
    const onChange = vi.fn();
    const modes: Record<string, string> = {
      plans: "on",
      deadlines: "required",
    };
    render(
      <ChoiceMatrix
        rowHeader="Group"
        rows={rows}
        columns={columns}
        valueOf={(key) => modes[key] as "on"}
        onChange={onChange}
      />
    );

    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(
      screen.getByRole("radio", { name: "Deadline reminders: Required" })
    ).toBeChecked();
    await userEvent.click(
      screen.getByRole("radio", { name: "Plans and goals: Off" })
    );
    expect(onChange).toHaveBeenCalledWith("plans", "off");
  });

  it("shows the choices without letting a view-only reader change them", () => {
    render(
      <ChoiceMatrix
        rowHeader="Group"
        rows={rows}
        columns={columns}
        valueOf={() => "on"}
        onChange={vi.fn()}
        editable={false}
      />
    );

    expect(
      screen.getByRole("radio", { name: "Plans and goals: On" })
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Plans and goals: Off" })
    ).toBeDisabled();
  });
});

describe("FilterChips", () => {
  const options = [
    { value: "all", label: "All", count: 12 },
    { value: "performance", label: "Performance", count: 9 },
    { value: "core", label: "Core HR", count: 3 },
  ] as const;

  it("keeps one chip on when single, and never none", async () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        type="single"
        label="Show"
        value="all"
        options={options}
        onChange={onChange}
      />
    );

    await userEvent.click(screen.getByRole("radio", { name: /Core HR/ }));
    expect(onChange).toHaveBeenCalledWith("core");
    onChange.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: /All/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds and removes chips when several can be on, in the options' order", async () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        type="multiple"
        label="Modules"
        value={["core"]}
        options={options}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("button", { name: /Core HR/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await userEvent.click(screen.getByRole("button", { name: /Performance/ }));
    expect(onChange).toHaveBeenCalledWith(["performance", "core"]);
  });
});

describe("QuickPicks", () => {
  it("marks the pick the field already holds and fills the field with another", async () => {
    const onPick = vi.fn();
    render(
      <QuickPicks
        label="From"
        value="2026-10-29"
        options={[
          { value: "2026-10-29", label: "Today" },
          { value: "2026-11-01", label: "1 Nov" },
        ]}
        onPick={onPick}
      />
    );

    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await userEvent.click(screen.getByRole("button", { name: "1 Nov" }));
    expect(onPick).toHaveBeenCalledWith("2026-11-01");
  });
});

describe("OptionCards", () => {
  it("is one radio group whose whole card picks the option", async () => {
    const onChange = vi.fn();
    render(
      <OptionCards
        label="Measured by"
        value="number"
        options={[
          {
            value: "number",
            label: "A number",
            description: "A start, a target, a unit",
          },
          {
            value: "milestones",
            label: "Milestones",
            description: "Weighted steps",
          },
        ]}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("radio", { name: /A number/ })).toBeChecked();
    await userEvent.click(screen.getByText("Weighted steps"));
    expect(onChange).toHaveBeenCalledWith("milestones");
  });
});
