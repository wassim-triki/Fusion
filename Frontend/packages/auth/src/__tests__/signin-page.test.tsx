import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { SignInPage } from "../components/signin-page";
import { AuthProvider } from "../auth-context";
import * as authService from "../auth-service";
import { makeAuthResponse, makeApiError, makeStoredAuth } from "./helpers";
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
});

function renderSignInPage(props = {}) {
  return render(
    <AuthProvider>
      <SignInPage {...props} />
    </AuthProvider>
  );
}

describe("SignInPage", () => {
  describe("rendering", () => {
    it("renders email and password fields", () => {
      renderSignInPage();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("renders sign in button", () => {
      renderSignInPage();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    });

    it("does not expose self-service signup", () => {
      renderSignInPage();

      expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /sign up/i })).toBeNull();
    });
  });

  describe("form submission", () => {
    it("calls login with email and password", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      renderSignInPage();

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
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

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
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

      await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
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

      await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => expect(mockLocationAssign).toHaveBeenCalledWith("/"));
    });

    it("redirects to callbackUrl on successful login when provided", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      mockSearchParamGet.mockImplementation((key) =>
        key === "callbackUrl" ? "/core/welcome?activation=1" : null
      );
      renderSignInPage();

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
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

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith("/core/welcome?activation=1");
      });
    });

    it("calls onSuccess callback on successful login", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      const onSuccess = vi.fn();
      renderSignInPage({ onSuccess });

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
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

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "wrongpassword");
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      });
    });

    it("names wrong credentials in the catalogue's words", async () => {
      mockedService.login.mockRejectedValue(makeApiError(["Invalid credentials."], 401));
      renderSignInPage();

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "wrongpassword");
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
      await userEvent.type(screen.getByLabelText("Adresse e-mail"), "test@example.com");
      await userEvent.type(screen.getByLabelText("Mot de passe"), "wrongpassword");
      await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
      expect(await screen.findByText("Adresse e-mail ou mot de passe incorrect.")).toBeInTheDocument();

      mockedService.login.mockRejectedValueOnce(makeApiError(["Something exploded"], 500));
      await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
      expect(await screen.findByText("Connexion impossible. Réessayez.")).toBeInTheDocument();
      expect(screen.queryByText("Something exploded")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Conditions d’utilisation" })).toBeInTheDocument();
    });

    it("resets isSubmitting after submission", async () => {
      mockedService.login.mockResolvedValue(makeAuthResponse());
      renderSignInPage();

      await userEvent.type(screen.getByLabelText(/email/i), "test@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "password123");
      
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
});
