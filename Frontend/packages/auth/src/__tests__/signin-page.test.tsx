import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { SignInPage } from "../components/signin-page";
import { AuthProvider } from "../auth-context";
import * as authService from "../auth-service";
import { makeAuthResponse, makeApiError, makeStoredAuth } from "./helpers";
import { markSessionExpired } from "@repo/api";
import { IntlTestProvider } from "@repo/ds/testing";
import dsFr from "@repo/ds/messages/fr.json";
import fr from "../messages/fr.json";

// Mock next/navigation
const mockSearchParamGet = vi.fn<(key: string) => string | null>();
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mockSearchParamGet,
  }),
}));

// Mock auth-service
vi.mock("../auth-service", async () => {
  const actual = await vi.importActual<typeof authService>("../auth-service");
  return {
    ...actual,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    persistAuth: vi.fn(),
    loadAuth: vi.fn(),
    clearAuth: vi.fn(),
  };
});

const mockedService = vi.mocked(authService);
let mockLocationAssign: ReturnType<typeof vi.spyOn>;
let mockLocationReplace: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockLocationAssign = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => undefined);
  mockLocationReplace = vi
    .spyOn(window.location, "replace")
    .mockImplementation(() => undefined);
  mockedService.loadAuth.mockReturnValue(null);
  mockSearchParamGet.mockReturnValue(null);
  window.sessionStorage.clear();
  answerDiscover({ password: true, passwordForAdministratorsOnly: false, providers: [] });
});

const fetchMock = vi.fn();

/** What Identity answers for the address's domain, and to a request to start a provider round trip. */
function answerDiscover(ways: unknown, flow: { status: number; body: unknown } = { status: 200, body: { authorizeUrl: "https://login.example/authorize?state=x" } }) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const envelope = (status: number, data: unknown) =>
      new Response(JSON.stringify(status < 300 ? { isSuccess: true, data, errors: [] } : { isSuccess: false, data: null, errors: ["No"], details: data }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/identity/sso/discover")) return envelope(200, ways);
    if (url.includes("/identity/sso/flows")) return envelope(flow.status, flow.body);
    return envelope(404, null);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Step 1: the address, then Continue. */
async function continueAs(email: string, labels = { email: /email/i, next: "Continue" }) {
  await userEvent.type(screen.getByLabelText(labels.email), email);
  await userEvent.click(screen.getByRole("button", { name: labels.next }));
}

function renderSignInPage(props = {}) {
  return render(
    <AuthProvider>
      <SignInPage {...props} />
    </AuthProvider>
  );
}

describe("SignInPage", () => {
  describe("rendering", () => {
    it("asks for the email first, then the ways in for it", async () => {
      renderSignInPage();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/password/i)).toBeNull();

      await continueAs("test@example.com");

      expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
      expect(screen.getByText("test@example.com")).toBeInTheDocument();
      expect(screen.queryByText(/remember me/i)).toBeNull();
      expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
        "href",
        "/auth/forgot-password?email=test%40example.com"
      );
    });

    it("does not expose self-service signup", () => {
      renderSignInPage();

      expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /sign up/i })).toBeNull();
    });
  });

  describe("a session that ended on its own", () => {
    it("says so, only then, and keeps the way back", async () => {
      mockSearchParamGet.mockImplementation((key) => (key === "callbackUrl" ? "/core/people" : null));
      markSessionExpired();
      renderSignInPage();
      expect(await screen.findByRole("heading", { name: "You've been signed out" })).toBeInTheDocument();
      expect(screen.getByText("Sign in again to go back to where you were.")).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    it("is a normal sign-in on a first visit", async () => {
      renderSignInPage();
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });

    it("is marked when a stored session can't be restored", async () => {
      mockedService.loadAuth.mockReturnValue(makeStoredAuth({ accessTokenExpiration: new Date(Date.now() - 5_000).toISOString() }));
      mockedService.refreshToken.mockRejectedValue(makeApiError(401));
      renderSignInPage();
      expect(await screen.findByRole("heading", { name: "You've been signed out" })).toBeInTheDocument();
    });
  });

  describe("form submission", () => {
    it("calls login with email and password", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockedService.login).toHaveBeenCalledWith({
          email: "test@example.com",
          password: "password123",
        });
      });
    });

    it("redirects to / on successful login by default", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith("/");
      });
    });

    it("routes a Tenant Administrator to Getting Started without an intended destination", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      mockedService.loadAuth
        .mockReturnValueOnce(null)
        .mockReturnValue(makeStoredAuth({
          user: {
            ...makeStoredAuth().user,
            effectivePermissions: [{
              permissionKey: "access.assignments.view",
              scope: "Tenant",
              label: "View administrator access",
              group: "Access",
              helperText: null,
              allowedScopes: ["Tenant"],
            }],
          },
        }));
      renderSignInPage();

      await continueAs("admin@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => expect(mockLocationAssign).toHaveBeenCalledWith("/"));
    });

    it("ignores an unsafe callback and uses the product fallback", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      mockedService.loadAuth
        .mockReturnValueOnce(null)
        .mockReturnValue(makeStoredAuth({
          user: {
            ...makeStoredAuth().user,
            effectivePermissions: [{
              permissionKey: "access.assignments.view",
              scope: "Tenant",
              label: "View administrator access",
              group: "Access",
              helperText: null,
              allowedScopes: ["Tenant"],
            }],
          },
        }));
      mockSearchParamGet.mockImplementation((key) =>
        key === "callbackUrl" ? "/\\evil.example" : null
      );
      renderSignInPage();

      await continueAs("admin@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => expect(mockLocationAssign).toHaveBeenCalledWith("/"));
    });

    it("redirects to callbackUrl on successful login when provided", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      mockSearchParamGet.mockImplementation((key) =>
        key === "callbackUrl" ? "/core/welcome?activation=1" : null
      );
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith("/core/welcome?activation=1");
      });
    });

    it("uses next when callbackUrl is not present", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      mockSearchParamGet.mockImplementation((key) =>
        key === "next" ? "/core/welcome?activation=1" : null
      );
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith("/core/welcome?activation=1");
      });
    });

    it("calls onSuccess callback on successful login", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      const onSuccess = vi.fn();
      renderSignInPage({ onSuccess });

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
        expect(mockLocationAssign).not.toHaveBeenCalled();
      });
    });

    it("displays errors on login failure", async () => {
      mockedService.login.mockRejectedValue(
        makeApiError(["Invalid email or password"])
      );
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "wrongpassword");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      });
    });

    it("names wrong credentials in the catalogue's words", async () => {
      mockedService.login.mockRejectedValue(makeApiError(["Invalid credentials."], 401));
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "wrongpassword");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      expect(await screen.findByText("Invalid credentials.")).toBeInTheDocument();
    });

    it("says a failed sign-in in French, never with the server's English", async () => {
      mockedService.login.mockRejectedValueOnce(makeApiError(["Invalid credentials."], 401));
      render(
        <IntlTestProvider locale="fr" messages={{ ...dsFr, ...fr }}>
          <AuthProvider>
            <SignInPage />
          </AuthProvider>
        </IntlTestProvider>
      );

      expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Conditions d’utilisation" })).toBeInTheDocument();
      await continueAs("test@example.com", { email: "Adresse e-mail", next: "Continuer" });
      await userEvent.type(await screen.findByLabelText("Mot de passe"), "wrongpassword");
      await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
      expect(await screen.findByText("Adresse e-mail ou mot de passe incorrect.")).toBeInTheDocument();

      mockedService.login.mockRejectedValueOnce(makeApiError(["Something exploded"], 500));
      await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
      expect(await screen.findByText("Impossible de vous connecter. Réessayez.")).toBeInTheDocument();
      expect(screen.queryByText("Something exploded")).not.toBeInTheDocument();

    });

    it("resets isSubmitting after submission", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      renderSignInPage();

      await continueAs("test@example.com");
      await userEvent.type(await screen.findByLabelText(/password/i), "password123");
      
      const submitButton = screen.getByRole("button", { name: "Sign in" });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });
    });
  });

  describe("already authenticated redirect", () => {
    it("redirects to / when already authenticated", async () => {
      mockedService.loadAuth.mockReturnValue(makeStoredAuth());
      renderSignInPage();

      await waitFor(() => {
        expect(mockLocationReplace).toHaveBeenCalledWith("/");
      });
    });

    it("redirects to callbackUrl when already authenticated", async () => {
      mockedService.loadAuth.mockReturnValue(makeStoredAuth());
      mockSearchParamGet.mockImplementation((key) =>
        key === "callbackUrl" ? "/core/welcome?activation=1" : null
      );
      renderSignInPage();

      await waitFor(() => {
        expect(mockLocationReplace).toHaveBeenCalledWith("/core/welcome?activation=1");
      });
    });

    it("calls onSuccess when already authenticated", async () => {
      mockedService.loadAuth.mockReturnValue(makeStoredAuth());
      const onSuccess = vi.fn();
      renderSignInPage({ onSuccess });

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
        expect(mockLocationReplace).not.toHaveBeenCalled();
      });
    });
  });

  describe("single sign-on", () => {
    it("leads with the company's provider, then Microsoft and Google, then the password", async () => {
      answerDiscover({
        password: true,
        passwordForAdministratorsOnly: false,
        providers: [
          { key: "company", label: "Carthage Digital" },
          { key: "microsoft", label: "Microsoft" },
          { key: "google", label: "Google" },
        ],
      });
      renderSignInPage();
      await continueAs("aicha@carthagedigital.tn");

      const buttons = await screen.findAllByRole("button", { name: /^Continue with/ });
      expect(buttons.map((button) => button.textContent)).toEqual([
        "CContinue with Carthage Digital",
        "Continue with Microsoft",
        "Continue with Google",
      ]);
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("offers only the company's provider where it is required, with the password for administrators", async () => {
      answerDiscover({ password: false, passwordForAdministratorsOnly: true, providers: [{ key: "company", label: "Carthage Digital" }] });
      renderSignInPage();
      await continueAs("aicha@carthagedigital.tn");

      expect(await screen.findByRole("button", { name: /Continue with Carthage Digital/ })).toBeInTheDocument();
      expect(screen.queryByLabelText(/password/i)).toBeNull();
      expect(screen.queryByRole("button", { name: /Microsoft/ })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Use your password" }));
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("leaves for the provider and remembers where the person meant to go", async () => {
      answerDiscover({ password: true, passwordForAdministratorsOnly: false, providers: [{ key: "google", label: "Google" }] });
      mockSearchParamGet.mockImplementation((key) => (key === "callbackUrl" ? "/core/people" : null));
      renderSignInPage();
      await continueAs("nour@gmail.com");

      await userEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));

      await waitFor(() => expect(mockLocationAssign).toHaveBeenCalledWith("https://login.example/authorize?state=x"));
      const started = fetchMock.mock.calls.find(([url]) => String(url).includes("/identity/sso/flows"));
      expect(JSON.parse(String((started?.[1] as RequestInit).body))).toEqual({ purpose: "signIn", provider: "google", email: "nour@gmail.com" });
      expect(window.sessionStorage.getItem("fusion_sso_next")).toBe("/core/people");
    });

    it("says why a provider sign-in was refused, back on step 2 for the same address", async () => {
      window.sessionStorage.setItem("fusion_sso_refusal", JSON.stringify({
        code: "no_account", provider: "company", company: "Carthage Digital", email: "sami@carthagedigital.tn",
      }));
      renderSignInPage();

      expect(await screen.findByText("There's no Fusion account for sami@carthagedigital.tn.")).toBeInTheDocument();
      expect(screen.getByText("If you were invited, open the link in your invitation email.")).toBeInTheDocument();
      expect(screen.getByText("sami@carthagedigital.tn")).toBeInTheDocument();
      expect(window.sessionStorage.getItem("fusion_sso_refusal")).toBeNull();
    });
  });
});
