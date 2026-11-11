import { describe, expect, it, vi } from "vitest";
import { createReviewsApi, reviewQueryKeys } from "../performance-reviews";
import { createPerformanceApi } from "../performance";
import type { ApiClient } from "../types";

function client() {
  const calls = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) };
  return { calls, api: createReviewsApi(calls as unknown as ApiClient), performance: createPerformanceApi(calls as unknown as ApiClient) };
}

describe("review workspace and question library", () => {
  it("reads the workspace for a cycle, or the default one", async () => {
    const { calls, api } = client();
    await api.getWorkspace("c1");
    await api.getWorkspace(null);
    expect(calls.get).toHaveBeenCalledWith("/performance/reviews/workspace", { params: { cycle: "c1" }, signal: undefined });
    expect(calls.get).toHaveBeenCalledWith("/performance/reviews/workspace", { params: undefined, signal: undefined });
    expect(reviewQueryKeys.workspace("c1")).toEqual(["performance", "reviews", "workspace", "c1"]);
  });

  it("edits, reorders, archives and deletes library questions with their versions", async () => {
    const { calls, api } = client();
    await api.createQuestion("What did a setback teach you?", "Person");
    await api.updateQuestion("q1", "What did you learn?", 2);
    await api.reorderQuestions("Peer", ["q3", "q2"]);
    await api.archiveQuestion("q1", 3);
    await api.deleteQuestion("q2", 1);
    expect(calls.post).toHaveBeenCalledWith("/performance/settings/review-questions", { text: "What did a setback teach you?", audience: "Person" });
    expect(calls.put).toHaveBeenCalledWith("/performance/settings/review-questions/q1", { text: "What did you learn?", expectedVersion: 2 });
    expect(calls.put).toHaveBeenCalledWith("/performance/settings/review-questions/order", { audience: "Peer", questionIds: ["q3", "q2"] });
    expect(calls.post).toHaveBeenCalledWith("/performance/settings/review-questions/q1/archive", { expectedVersion: 3 });
    expect(calls.delete).toHaveBeenCalledWith("/performance/settings/review-questions/q2", { body: { expectedVersion: 1 } });
  });
});

describe("schedule, release and peer input", () => {
  it("moves due dates for a round and for one review, with a reason", async () => {
    const { calls, api } = client();
    await api.moveRoundDueDate("r1", { expectedVersion: 4, stage: "SelfAssessment", dueDate: "2027-09-17", reason: "Release freeze" });
    await api.moveReviewDueDate("v1", { expectedVersion: 2, dueDate: "2027-09-20", reason: "Back from leave" });
    expect(calls.post).toHaveBeenCalledWith("/performance/review-rounds/r1/due-dates",
      { expectedVersion: 4, stage: "SelfAssessment", dueDate: "2027-09-17", reason: "Release freeze" });
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/due-date", { expectedVersion: 2, dueDate: "2027-09-20", reason: "Back from leave" });
  });

  it("acknowledges and downloads the PDF as a file", async () => {
    const { calls, api } = client();
    await api.acknowledge("v1", null);
    await api.downloadPdf("v1");
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/acknowledge", { comment: null });
    expect(calls.get).toHaveBeenCalledWith("/performance/reviews/v1/pdf", { responseType: "blob" });
  });

  it("changes who is asked, answers and declines peer input", async () => {
    const { calls, api } = client();
    await api.changePeers("v1", ["e1", "e2"], 5);
    await api.savePeerAnswers("p1", [{ questionId: "q1", text: "Kind and direct" }]);
    await api.sendPeerAnswers("p1", [{ questionId: "q1", text: "Kind and direct" }]);
    await api.declinePeerRequest("p2", "Haven't worked together");
    expect(calls.put).toHaveBeenCalledWith("/performance/reviews/v1/peers", { employeeIds: ["e1", "e2"], expectedVersion: 5 });
    expect(calls.put).toHaveBeenCalledWith("/performance/peer-requests/p1", { answers: [{ questionId: "q1", text: "Kind and direct" }] });
    expect(calls.post).toHaveBeenCalledWith("/performance/peer-requests/p1/send", { answers: [{ questionId: "q1", text: "Kind and direct" }] });
    expect(calls.post).toHaveBeenCalledWith("/performance/peer-requests/p2/decline", { note: "Haven't worked together" });
  });

  it("reads the review's year and acts on it: take back, nudge, talk it over, comment", async () => {
    const { calls, api } = client();
    await api.getYear("v1");
    await api.takeBack("v1");
    await api.nudge("v1", "peers");
    await api.talkItOver("v1");
    await api.commentOnAcknowledgement("v1", "Thanks");
    expect(calls.get).toHaveBeenCalledWith("/performance/reviews/v1/year", { signal: undefined });
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/self-assessment/take-back", {});
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/nudge", { who: "peers" });
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/talk-it-over", {});
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/acknowledgement-comment", { comment: "Thanks" });
  });

  it("sends the self overall rating, answers and potential with the assessments", async () => {
    const { calls, performance } = client();
    await performance.submitSelfAssessment("v1", { expectedVersion: 1, summary: "Done", overallRating: 4, answers: [{ questionId: "q1", text: "Proud" }] });
    await performance.submitManagerAssessment("v1", { expectedVersion: 2, summary: "Strong", overallRating: 4, potential: "High" });
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/self-assessment",
      { expectedVersion: 1, summary: "Done", overallRating: 4, answers: [{ questionId: "q1", text: "Proud" }] });
    expect(calls.post).toHaveBeenCalledWith("/performance/reviews/v1/manager-assessment",
      { expectedVersion: 2, summary: "Strong", overallRating: 4, potential: "High" });
  });
});
