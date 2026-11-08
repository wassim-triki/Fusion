// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackDto, FeedbackRequestDto, PraiseDto } from "@repo/api";
import { FeedbackComposer } from "./composers";
import { PraiseDrawer } from "./drawers";
import { FeedbackWorkspace } from "./feedback-workspace";
import { RequestRecord } from "./request-record";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  feedback: [] as unknown[],
  requests: { toAnswer: [], mine: [] } as unknown,
  request: null as unknown,
  praiseDetail: null as unknown,
  summary: undefined as unknown,
  give: { mutateAsync: vi.fn(async () => ({})), isLoading: false, error: null },
  answer: { mutate: vi.fn(), isLoading: false, error: null },
  decline: { mutate: vi.fn(), isLoading: false, error: null },
  close: { mutate: vi.fn(), isLoading: false, error: null },
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => state.params,
  usePathname: () => "/feedback",
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
}));
vi.mock("@repo/auth", () => ({ useAuth: () => ({ user: { employeeId: "me", fullName: "Rim Mahjoub" } }) }));
vi.mock("../../api/use-performance", () => ({ usePersonSummary: () => ({ data: undefined, isLoading: false, error: null }) }));
vi.mock("@repo/api/query", () => ({ useReactToPraise: () => ({ mutate: vi.fn(), isLoading: false }), useCompanyValues: () => ({ data: [{ id: "v1", name: "Collaboration" }] }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../api/use-conversations", () => ({
  useOneOnOnes: () => ({ data: { reports: [{ with: { employeeId: "x" } }], startWithReports: [], withManager: null } }),
  useOneOnOne: () => ({ data: undefined }),
  useOneOnOneCommands: () => ({ addAgendaItem: { mutateAsync: vi.fn(), isLoading: false } }),
  useFeedbackSummary: () => ({ data: state.summary }),
  usePraiseSummary: () => ({ data: { windowDays: 90, values: [], received: 0, given: 0 } }),
  useFeedbackList: () => ({ data: { items: state.feedback, next: null }, isLoading: false, error: null, refetch: vi.fn() }),
  useFeedbackItem: () => ({ data: state.feedback[0], error: null }),
  useFeedbackRequests: () => ({ data: state.requests, error: null, refetch: vi.fn() }),
  useFeedbackRequest: () => ({ data: state.request, error: null, refetch: vi.fn() }),
  useFeedbackRequestCommands: () => ({ answer: state.answer, decline: state.decline, close: state.close }),
  usePraisePage: () => ({ data: { items: [], next: null }, error: null, refetch: vi.fn() }),
  usePraiseItem: () => ({ data: state.praiseDetail, error: null }),
  useDeletePraise: () => ({ mutateAsync: vi.fn(), isLoading: false }),
  useGiveFeedback: () => state.give,
  useAskForFeedback: () => ({ mutateAsync: vi.fn(), isLoading: false, error: null }),
  useGivePraise: () => ({ mutateAsync: vi.fn(), isLoading: false, error: null }),
  useCompanyValues: () => ({ data: [{ id: "v1", name: "Collaboration" }] }),
  useDirectory: () => ({ data: [], isLoading: false, error: null }),
}));

function feedback(overrides: Partial<FeedbackDto> = {}): FeedbackDto {
  return {
    id: "f1", author: { id: "leila", name: "Leila Baccouche" }, receiver: { id: "me", name: "Rim Mahjoub" }, visibility: "Shared",
    addressedManager: null, subject: null, message: "Your API review comments were specific and kind.", requestId: null,
    requestQuestion: null, sentAt: "2026-10-03T08:00:00Z", ...overrides,
  };
}

function request(overrides: Partial<FeedbackRequestDto> = {}): FeedbackRequestDto {
  return {
    id: "r1", version: 1, requester: { id: "leila", name: "Leila Baccouche" }, question: "How did the launch go?", subject: null,
    dueDate: "2026-10-01", state: "Open", requestedAt: "2026-09-20T08:00:00Z", closedAt: null, closeReason: null, overdue: true,
    viewerRole: "Invitee", invitees: null, answers: null, mine: { person: { id: "me", name: "Rim" }, status: "Waiting", respondedAt: null, declineReason: null },
    myAnswer: null, can: { answer: true, decline: true, close: false }, ...overrides,
  };
}

const praise: PraiseDto = {
  id: "p1", author: { id: "amine", name: "Amine Jaziri" }, recipients: [{ id: "nour", name: "Nour Trabelsi" }], value: { id: "v", name: "Ownership" },
  message: "Zero downtime.", givenAt: "2026-10-17T08:00:00Z", reactions: [], canDelete: false,
};

beforeEach(() => {
  state.params = new URLSearchParams();
  state.feedback = [];
  state.summary = undefined;
  state.give.mutateAsync.mockClear();
  state.answer.mutate.mockClear();
  state.replace.mockClear();
});

describe("Feedback workspace", () => {
  it("opens on Received with one action to ask when nothing has arrived", () => {
    state.summary = {
      received: 0, fromCount: 0, from: [], subjects: [], given: 0, toAnswer: 0,
      askAbout: [{ cycleId: "c1", objectiveId: "o1", title: "Ship the gateway", status: null, feedback: 0 }],
    };
    render(<FeedbackWorkspace />);
    expect(screen.getByRole("link", { name: "Received" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("No feedback yet")).toBeTruthy();
    expect(screen.getByText("Ask about Ship the gateway")).toBeTruthy();
  });

  it("leads Received with the year in feedback and what waits on the caller", () => {
    state.feedback = [feedback({ subject: { kind: "Competency", cycleId: null, objectiveId: null, competencyId: "v1", label: "Collaboration", href: null } })];
    state.summary = {
      received: 1, fromCount: 1, from: [{ id: "leila", name: "Leila Baccouche" }],
      subjects: [{ kind: "Competency", objectiveId: null, competencyId: "v1", label: "Collaboration", count: 1 }],
      given: 2, toAnswer: 1, askAbout: [],
    };
    render(<FeedbackWorkspace />);
    expect(screen.getByLabelText("Your feedback at a glance").textContent).toContain("from 1 colleague");
    expect(screen.getByRole("button", { name: /1 to answer/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Requests 1" })).toBeTruthy();
    expect(screen.getAllByText("Collaboration").length).toBeGreaterThan(0);
  });

  it("marks manager-only feedback in the team view and opens the drawer from a deep link", () => {
    state.params = new URLSearchParams("tab=team&feedback=f1");
    state.feedback = [feedback({ visibility: "ManagerOnly", addressedManager: { id: "me", name: "Karim Haddad" } })];
    render(<FeedbackWorkspace />);
    expect(screen.getAllByText(/Manager only/).length).toBeGreaterThan(0);
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Your API review comments were specific and kind.")).toBeTruthy();
  });

  it("keeps the tab in the address", () => {
    state.params = new URLSearchParams("tab=requests");
    render(<FeedbackWorkspace />);
    expect(screen.getByRole("heading", { name: "Asked of you" })).toBeTruthy();
    expect(screen.getByText("Nothing to answer")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Requests" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Praise" }).getAttribute("href")).toBe("/feedback?tab=praise");
    expect(screen.getByRole("link", { name: "Received" }).getAttribute("href")).toBe("/feedback");
  });

  it("opens one of your requests beside the list, with who was asked and the answers", () => {
    state.params = new URLSearchParams("tab=requests");
    const mine = {
      id: "r2", question: "How did the onboarding sessions land?", requester: { id: "me", name: "Rim Mahjoub" }, dueDate: "2026-10-30",
      state: "Open" as const, overdue: false, answered: 1, declined: 0, invited: 2, myStatus: null, requestedAt: "2026-10-20T08:00:00Z", subject: null,
      invitees: [{ person: { id: "khaled", name: "Khaled Sassi" }, status: "Answered" as const }, { person: { id: "aicha", name: "Aicha Bouazizi" }, status: "Waiting" as const }],
      latestAnswer: null,
    };
    state.requests = { toAnswer: [], mine: [mine] } as never;
    state.request = request({
      id: "r2", question: mine.question, requester: mine.requester, viewerRole: "Requester", mine: null,
      invitees: [
        { person: { id: "khaled", name: "Khaled Sassi" }, status: "Answered", respondedAt: "2026-10-22T08:00:00Z", declineReason: null },
        { person: { id: "aicha", name: "Aicha Bouazizi" }, status: "Waiting", respondedAt: null, declineReason: null },
      ],
      answers: [feedback({ id: "a1", author: { id: "khaled", name: "Khaled Sassi" }, message: "They were short and useful." })],
    });
    render(<FeedbackWorkspace />);
    expect(screen.getByRole("heading", { name: "Yours" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /How did the onboarding sessions land/ }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Aicha Bouazizi")).toBeTruthy();
    expect(within(drawer).getByText("Not yet")).toBeTruthy();
    expect(within(drawer).getByText("They were short and useful.")).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "Open the request" }).getAttribute("href")).toBe("/feedback/requests/r2");
  });
});

describe("feedback composer", () => {
  it("sends once a person and a message are set, with one id across retries", async () => {
    render(<FeedbackComposer receiver={{ employeeId: "rim", displayName: "Rim Mahjoub", subtitle: null }} onClose={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Send to Rim" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Feedback"), { target: { value: "Clear and kind." } });
    fireEvent.click(screen.getByRole("radio", { name: /Manager only/ }));
    expect(screen.getByRole("radio", { name: /Manager only/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Collaboration/ }));
    fireEvent.click(send);
    fireEvent.click(send);
    const calls = state.give.mutateAsync.mock.calls as unknown as [{ id: string; visibility: string; competencyId: string | null }][];
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map(([args]) => args.id)).size).toBe(1);
    expect(calls[0]![0].visibility).toBe("ManagerOnly");
    expect(calls[0]![0].competencyId).toBe("v1");
  });
});

describe("praise drawer", () => {
  it("offers Delete only to those allowed and says when praise was removed", () => {
    state.praiseDetail = { removed: false, praise };
    const { rerender } = render(<PraiseDrawer praiseId="p1" onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete praise" })).toBeNull();
    state.praiseDetail = { removed: false, praise: { ...praise, canDelete: true } };
    rerender(<PraiseDrawer praiseId="p1" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete praise" })).toBeTruthy();
    state.praiseDetail = { removed: true, praise: null };
    rerender(<PraiseDrawer praiseId="p1" onClose={vi.fn()} />);
    expect(screen.getByText("This praise was removed.")).toBeTruthy();
  });
});

describe("request record", () => {
  it("lets an invitee answer an overdue request without seeing anyone else", () => {
    state.request = request();
    render(<RequestRecord requestId="r1" />);
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Answers/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Your feedback for/), { target: { value: "It landed well." } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(state.answer.mutate).toHaveBeenCalledWith(expect.objectContaining({ message: "It landed well." }));
  });

  it("shows the requester every invitee and answer, and hides the composer once closed", () => {
    state.request = request({
      viewerRole: "Requester", mine: null, can: { answer: false, decline: false, close: true },
      invitees: [
        { person: { id: "rim", name: "Rim" }, status: "Answered", respondedAt: null, declineReason: null },
        { person: { id: "khaled", name: "Khaled" }, status: "Declined", respondedAt: null, declineReason: "Not close enough" },
      ],
      answers: [feedback({ id: "a1", message: "It landed well." })],
    });
    render(<RequestRecord requestId="r1" />);
    expect(screen.getByText("It landed well.")).toBeTruthy();
    expect(screen.getByText(/Khaled declined/)).toBeTruthy();
    expect(screen.queryByLabelText(/Your feedback for/)).toBeNull();
    expect(screen.getByRole("button", { name: "Close request" })).toBeTruthy();
  });
});
