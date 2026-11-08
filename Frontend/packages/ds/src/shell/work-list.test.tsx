import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WorkList, dueLabel, type WorkListItem } from "./work-list";
import { renderWithIntl } from "../testing/intl";
import fr from "../messages/fr.json";

const today = new Date(2026, 9, 15);
const modules = [
  { key: "core", label: "Core HR", status: "ready" as const },
  { key: "performance", label: "Performance", status: "ready" as const },
];

const selfAssessment: WorkListItem = {
  id: "performance:self-assessment:1",
  module: "performance",
  title: "Complete your self-assessment",
  context: "Mid-year",
  dueOn: "2026-10-17",
  href: "/performance/reviews/1",
};
const updateRequest: WorkListItem = {
  id: "performance:update-request:2",
  module: "performance",
  title: "Update progress on Ship the playbook",
  href: "/performance/cycles/c/objectives/o?mode=record",
};
const access: WorkListItem = {
  id: "core:access-not-invited:t",
  module: "core",
  title: "12 people don't have Fusion access yet",
  dueOn: "2026-10-20",
  href: "/core/people?view=not-signed-in",
};

describe("WorkList in French", () => {
  it("says what is due and what failed in French", () => {
    renderWithIntl(<WorkList items={[selfAssessment]} modules={[modules[0]!, { ...modules[1]!, status: "error" }]} today={today} />, {
      locale: "fr",
      messages: fr,
    });
    expect(screen.getByText("2 jours restants")).toBeInTheDocument();
    expect(screen.getByText("Impossible de charger les tâches Performance")).toBeInTheDocument();
  });
});

describe("dueLabel", () => {
  it("reads days left and late", () => {
    expect(dueLabel("2026-10-15", today)).toBe("Due today");
    expect(dueLabel("2026-10-16", today)).toBe("Due tomorrow");
    expect(dueLabel("2026-10-17", today)).toBe("2 days left");
    expect(dueLabel("2026-10-13", today)).toBe("2 days late");
  });
});

describe("WorkList", () => {
  it("lists items from several modules in the given order, each opening its path", () => {
    render(<WorkList items={[selfAssessment, access, updateRequest]} modules={modules} today={today} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/performance/reviews/1",
      "/core/people?view=not-signed-in",
      "/performance/cycles/c/objectives/o?mode=record",
    ]);
    expect(within(links[0]!).getByText("2 days left")).toBeInTheDocument();
  });

  it("states that nothing needs the person", () => {
    render(<WorkList items={[]} modules={modules} today={today} />);
    expect(screen.getByText("Nothing needs you right now")).toBeInTheDocument();
  });

  it("keeps loaded items, a placeholder for a slow module and a line for a failed one", () => {
    render(
      <WorkList
        items={[selfAssessment]}
        modules={[
          { key: "core", label: "Core HR", status: "error" },
          { key: "performance", label: "Performance", status: "ready" },
          { key: "learning", label: "Learning", status: "loading" },
        ]}
        today={today}
      />,
    );
    expect(screen.getByRole("link", { name: /Complete your self-assessment/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Loading Learning work")).toBeInTheDocument();
    expect(screen.getByText("Core HR work couldn't be loaded")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs you right now")).not.toBeInTheDocument();
  });
});
