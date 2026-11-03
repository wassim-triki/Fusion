import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { corePeopleQueryKeys } from "@repo/api";
import { useWithdrawInvite } from "./use-workforce-access";

const mocks = vi.hoisted(() => ({ state: "Invited", post: vi.fn() }));
vi.mock("@repo/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPlatformApiClient: () => ({ post: mocks.post }),
}));

afterEach(cleanup);

it("refreshes the displayed People row and person access state after withdrawal", async () => {
  mocks.state = "Invited";
  mocks.post.mockImplementation(async () => {
    mocks.state = "Withdrawn";
    return { employeeId: "person", outcome: "Ok" };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  function People() {
    const row = useQuery({
      queryKey: corePeopleQueryKeys.list({}),
      queryFn: async () => mocks.state,
    });
    const access = useQuery({
      queryKey: corePeopleQueryKeys.accessStatus("person"),
      queryFn: async () => mocks.state,
    });
    const withdraw = useWithdrawInvite();
    return (
      <>
        <p>Row: {row.data}</p>
        <p>Access: {access.data}</p>
        <button onClick={() => withdraw.mutate({ employeeId: "person" })}>
          Withdraw invitation
        </button>
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <People />
    </QueryClientProvider>
  );
  await screen.findByText("Row: Invited");
  await screen.findByText("Access: Invited");
  fireEvent.click(screen.getByRole("button", { name: "Withdraw invitation" }));
  await waitFor(() => {
    expect(screen.getByText("Row: Withdrawn")).toBeTruthy();
    expect(screen.getByText("Access: Withdrawn")).toBeTruthy();
  });
  expect(mocks.post).toHaveBeenCalledWith(
    "/corehr/workforce/access-subjects/person/withdraw",
    {}
  );
  client.clear();
});
