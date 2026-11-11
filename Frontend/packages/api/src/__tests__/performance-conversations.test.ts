import { describe, expect, it, vi } from "vitest";
import { conversationQueryKeys, createConversationsApi, newClientId } from "../performance-conversations";
import type { ApiClient } from "../types";

function client() {
  const calls = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) };
  return { calls, api: createConversationsApi(calls as unknown as ApiClient) };
}

describe("1:1 contracts", () => {
  it("starts a series and makes a calendar feed link", async () => {
    const { calls, api } = client();
    await api.startOneOnOne({ withEmployeeId: "e1", cadence: null, firstMeetingAt: "2026-10-20T10:00:00Z" });
    await api.createCalendarFeed();
    expect(calls.post).toHaveBeenCalledWith("/performance/one-on-ones", {
      withEmployeeId: "e1",
      cadence: null,
      firstMeetingAt: "2026-10-20T10:00:00Z",
    });
    expect(calls.post).toHaveBeenCalledWith("/performance/one-on-ones/calendar-feed", {});
  });

  it("saves an item's note and private notes against their own revisions", async () => {
    const { calls, api } = client();
    await api.setAgendaNote("m1", "i1", "Agreed", 2);
    await api.setPrivateNotes("m1", "Mine", 0);
    expect(calls.put).toHaveBeenCalledWith("/performance/one-on-ones/meetings/m1/agenda/i1/note", { text: "Agreed", expectedRevision: 2 });
    expect(calls.put).toHaveBeenCalledWith("/performance/one-on-ones/meetings/m1/notes/private", { text: "Mine", expectedRevision: 0 });
  });

  it("adds a suggestion by its source and toggles an action", async () => {
    const { calls, api } = client();
    await api.addAgendaItem("m1", { id: "a1", sourceKind: "Objective", sourceId: "o1" });
    await api.setActionDone("s1", "x1", true);
    expect(calls.post).toHaveBeenCalledWith("/performance/one-on-ones/meetings/m1/agenda", { id: "a1", sourceKind: "Objective", sourceId: "o1" });
    expect(calls.put).toHaveBeenCalledWith("/performance/one-on-ones/s1/actions/x1/done", { done: true });
  });
});

describe("feedback, request and praise contracts", () => {
  it("gives feedback with a client id and lists a view", async () => {
    const { calls, api } = client();
    const id = newClientId();
    await api.giveFeedback({ id, receiverEmployeeId: "e2", visibility: "ManagerOnly", message: "Thanks" });
    await api.listFeedback({ view: "team", limit: 20 });
    expect(calls.post).toHaveBeenCalledWith("/performance/feedback", { id, receiverEmployeeId: "e2", visibility: "ManagerOnly", message: "Thanks" });
    expect(calls.get).toHaveBeenCalledWith("/performance/feedback", {
      params: { view: "team", cycleId: undefined, objectiveId: undefined, before: undefined, limit: 20 },
      signal: undefined,
    });
  });

  it("answers, declines and closes a request", async () => {
    const { calls, api } = client();
    await api.answerFeedbackRequest("r1", "f1", "Clear");
    await api.declineFeedbackRequest("r1", null);
    await api.closeFeedbackRequest("r1");
    expect(calls.post).toHaveBeenCalledWith("/performance/feedback/requests/r1/answer", { feedbackId: "f1", message: "Clear" });
    expect(calls.post).toHaveBeenCalledWith("/performance/feedback/requests/r1/decline", { reason: null });
    expect(calls.post).toHaveBeenCalledWith("/performance/feedback/requests/r1/close", {});
  });

  it("reacts, unreacts and deletes praise", async () => {
    const { calls, api } = client();
    await api.react("p1", "Celebrate", true);
    await api.react("p1", "Celebrate", false);
    await api.deletePraise("p1");
    expect(calls.put).toHaveBeenCalledWith("/performance/praise/p1/reactions/Celebrate", {});
    expect(calls.delete).toHaveBeenCalledWith("/performance/praise/p1/reactions/Celebrate");
    expect(calls.delete).toHaveBeenCalledWith("/performance/praise/p1");
  });

  it("keys praise lists by query under one praise root", () => {
    const forMe = conversationQueryKeys.praiseList({ scope: "forMe" });
    expect(forMe.slice(0, 3)).toEqual(conversationQueryKeys.praise());
    expect(forMe).not.toEqual(conversationQueryKeys.praiseList({ scope: "all" }));
  });

  it("makes a distinct client id each time", () => {
    expect(newClientId()).not.toEqual(newClientId());
  });
});
