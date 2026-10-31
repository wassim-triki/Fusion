import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeAgenda, agendaEntries, orderWork, type HomeMoment, type HomeWorkItem } from "./home";

const today = new Date(2026, 9, 20); // Tuesday 20 October 2026

const selfAssessment: HomeWorkItem = {
  id: "performance:self-assessment:1",
  module: "performance",
  kind: "self-assessment",
  title: "Complete your self-assessment",
  context: "Year-end review",
  dueOn: "2026-10-23",
  href: "/performance/reviews/1",
  steps: [
    { label: "You", detail: "Due Fri 23 Oct", state: "current" },
    { label: "Mariam", detail: "Due Fri 30 Oct", state: "upcoming" },
    { label: "Calibration", detail: "HR", state: "upcoming" },
    { label: "Your result", detail: "Released by HR", state: "upcoming" },
  ],
};
const updateRequest: HomeWorkItem = {
  id: "performance:update-request:2",
  module: "performance",
  kind: "update-request",
  title: "Update progress on Ship the playbook",
  href: "/performance/cycles/c/objectives/o?mode=record",
};
const lateReviews: HomeWorkItem = {
  id: "performance:manager-assessment:3",
  module: "performance",
  kind: "manager-assessment",
  title: "Assess Omar",
  dueOn: "2026-10-19",
  href: "/performance/reviews/3",
};
const aichaPlan: HomeWorkItem = {
  id: "performance:plan-decision:4",
  module: "performance",
  kind: "plan-decision",
  title: "Review Aicha's plan",
  href: "/performance/cycles/c/plans/4",
  subject: { displayName: "Aicha" },
  waitingSince: "2026-10-17T09:00:00Z",
};
const peerInput: HomeWorkItem = {
  id: "performance:peer-input:5",
  module: "performance",
  kind: "peer-input",
  title: "Peer input for Omar",
  dueOn: "2026-10-30",
  href: "/performance/reviews/peer-requests/5",
  waitingSince: "2026-10-19T09:00:00Z",
};
const access: HomeWorkItem = { id: "core:access", module: "core", title: "12 people don't have Fusion access yet", href: "/core/workforce-access" };
const oneOnOne: HomeMoment = {
  id: "performance:one-on-one:m1",
  module: "performance",
  kind: "one-on-one",
  title: "1:1 with Mariam Gharbi",
  context: "2 on the agenda",
  date: "2026-10-22",
  at: "2026-10-22T09:00:00Z",
  href: "/performance/one-on-ones/s1",
};
const selfDue: HomeMoment = {
  id: "performance:self-assessment-due:1",
  module: "performance",
  kind: "self-assessment-due",
  title: "Your self-assessment due",
  date: "2026-10-23",
  href: "/performance/reviews/1",
  covers: ["self-assessment", "nominate-peers"],
};

const first = (work: HomeWorkItem[]) => orderWork(work, today)[0];

describe("orderWork", () => {
  it("puts overdue work first, then the earliest due, then undated work as given", () => {
    expect(orderWork([updateRequest, selfAssessment, lateReviews], today)).toEqual([lateReviews, selfAssessment, updateRequest]);
    expect(orderWork([access, updateRequest], today)).toEqual([access, updateRequest]);
  });

  it("puts work someone is waiting on ahead of the person's own work that isn't late, longest wait first", () => {
    expect(orderWork([selfAssessment, peerInput, aichaPlan], today)).toEqual([aichaPlan, peerInput, selfAssessment]);
    expect(first([access, aichaPlan])).toEqual(aichaPlan);
  });

  it("still puts the person's own late work over work someone is waiting on", () => {
    expect(first([aichaPlan, lateReviews, peerInput])).toEqual(lateReviews);
    const latePeerInput = { ...peerInput, dueOn: "2026-10-18" };
    expect(first([aichaPlan, latePeerInput])).toEqual(latePeerInput);
  });
});

describe("Coming up", () => {
  it("lists the moments of the next two weeks, earliest first", () => {
    const later = { ...oneOnOne, id: "later", title: "1:1 with Omar Mansour", date: "2026-10-29", at: "2026-10-29T09:00:00Z" };
    expect(agendaEntries({ moments: [later, selfDue, oneOnOne], today }).map((e) => e.title))
      .toEqual(["1:1 with Mariam Gharbi", "Your self-assessment due", "1:1 with Omar Mansour"]);
  });

  it("leaves out what is past or beyond two weeks", () => {
    const past = { ...selfDue, id: "past", date: "2026-10-10" };
    const far = { ...selfDue, id: "far", date: "2026-11-30" };
    expect(agendaEntries({ moments: [past, far], today })).toEqual([]);
  });

  it("shows each moment's day, what happens and its module, opening its path", () => {
    render(<HomeAgenda moments={[oneOnOne]} today={today} modules={[{ key: "performance", label: "Performance", status: "ready" }]} />);
    const link = screen.getByRole("link", { name: /1:1 with Mariam Gharbi/ });
    expect(link).toHaveAttribute("href", "/performance/one-on-ones/s1");
    expect(link).toHaveTextContent("22");
    expect(link).toHaveTextContent("Performance");
  });

  it("says nothing is scheduled and names a module that couldn't answer", () => {
    render(<HomeAgenda moments={[]} today={today} modules={[{ key: "performance", label: "Performance", status: "error" }]} />);
    expect(screen.getByText("Nothing is scheduled in the next two weeks")).toBeInTheDocument();
    expect(screen.getByText("Performance's dates couldn't be loaded")).toBeInTheDocument();
  });
});
