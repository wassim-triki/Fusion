// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { HomePeerInput } from "./home-peer-input";

const m = vi.hoisted(() => ({ send: vi.fn(), decline: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: m.invalidate }) }));
vi.mock("@repo/api", async (original) => ({
  ...(await original<object>()),
  createPlatformApiClient: () => ({}),
  createReviewsApi: () => ({ getPeerRequest: vi.fn(), sendPeerAnswers: m.send, declinePeerRequest: m.decline }),
}));
vi.mock("@repo/api/query", () => ({
  useApiQuery: () => ({
    data: {
      id: "11111111-2222-3333-4444-555555555555", subjectEmployeeId: "aicha", subjectDisplayName: "Aicha Bouazizi", reviewRoundName: "FY2027",
      dueDate: "2099-03-15", daysLate: 0, state: "Open", declineNote: null, respondedAt: null, canAnswer: true, version: 1,
      reviewerEmployeeId: "mariam", reviewerDisplayName: "Mariam Gharbi", requestedAt: "2099-03-01T08:00:00Z",
      reasons: [{ kind: "goal", title: "Cut production incidents by 40%", at: null, excerpt: null }],
      questions: [{ questionId: "q1", sortOrder: 0, text: "What should Aicha keep doing?", answer: null }],
    },
    error: null,
  }),
}));

const item = {
  id: "performance:peer-input:11111111-2222-3333-4444-555555555555", module: "performance", title: "Your view on Aicha Bouazizi",
  href: "/performance/reviews/peer-requests/11111111-2222-3333-4444-555555555555", subject: { displayName: "Aicha Bouazizi" }, actionLabel: "Answer",
};
const view = (open: boolean) => render(
  <NextIntlClientProvider locale="en" messages={messages}><HomePeerInput item={item} initiallyOpen={open} /></NextIntlClientProvider>,
);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.send.mockResolvedValue(undefined);
  m.decline.mockResolvedValue(undefined);
});

describe("Peer input answered from Home (D-74)", () => {
  it("says who asked and why, who reads it with the peer's name, and sends once every question is answered", async () => {
    view(false);
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(screen.getByText("Cut production incidents by 40%")).toBeTruthy();
    expect(screen.getByText("Mariam and Aicha both read it with your name")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send to Mariam" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/What should Aicha keep doing/), { target: { value: "Calm in release week." } });
    fireEvent.click(send);
    await waitFor(() => expect(m.send).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555", [{ questionId: "q1", text: "Calm in release week." }]));
    expect(m.invalidate).toHaveBeenCalled();
  });

  it("declines with I didn't work with them enough", async () => {
    view(true);
    fireEvent.click(screen.getByRole("button", { name: "I didn't work with Aicha enough" }));
    await waitFor(() => expect(m.decline).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555", null));
  });
});
