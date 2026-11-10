"use client";

import { useState } from "react";
import { LogOut, LogIn, User, Settings, ChevronUp, ChevronDown, Home } from "@repo/ds/icons";
import { useAuth } from "../auth-context";
import { getSidebarAccountLabel } from "../account-label";
import {
  canAccessOwnCoreProfile,
  canSeeCoreSettingsNavigation,
} from "../roles";

interface SidebarUserPanelProps {
  collapsed: boolean;
}

// Defined beside the auth context, which also needs it for the Fusion sidebar's viewer.
export { getSidebarAccountLabel };

export function SidebarUserPanel({ collapsed }: SidebarUserPanelProps) {
  const { isAuthenticated, user, logout, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-1">
        <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    const initial = user.fullName?.charAt(0)?.toUpperCase() || "U";
    const role = getSidebarAccountLabel(user);
    const canOpenProfile = canAccessOwnCoreProfile(user);
    const canOpenSettings = canSeeCoreSettingsNavigation(user);

    if (collapsed) {
      return (
        <div className="flex flex-col items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background dark:bg-secondary dark:text-secondary-foreground"
            title={user.fullName}
          >
            {initial}
          </div>
          <a
            href="/"
            className="flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Home"
            aria-label="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={async () => {
              await logout();
              window.location.href = "/auth/signin";
            }}
            className="flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }

    return (
      <div className="relative">
        {/* Dropdown menu — rendered above the trigger */}
        {menuOpen && (
          <>
            {/* Invisible backdrop to close the menu */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute bottom-full inset-s-0 inset-e-0 z-50 mb-2 rounded-surface border border-border bg-popover py-1 text-popover-foreground shadow-lg">
              {canOpenProfile ? (
                <a
                  href="/profile"
                  className="flex items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <User className="h-4 w-4 text-muted-foreground" />
                  My Profile
                </a>
              ) : null}
              {canOpenSettings ? (
                <a
                  href="/settings"
                  className="flex items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Settings
                </a>
              ) : null}
              <a
                href="/"
                className="flex items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Home className="h-4 w-4 text-muted-foreground" />
                Home
              </a>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  await logout();
                  window.location.href = "/auth/signin";
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" />
                Logout
              </button>
            </div>
          </>
        )}

        {/* Trigger — user info row */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-control px-2 py-2 hover:bg-accent transition-colors"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background dark:bg-secondary dark:text-secondary-foreground">
            {initial}
          </div>
          <div className="flex-1 min-w-0 text-start">
            <p className="truncate text-sm font-medium text-foreground">
              {user.fullName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {role}
            </p>
          </div>
          {menuOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </div>
    );
  }

  // Not authenticated
  if (collapsed) {
    return (
      <a
        href="/auth/signin"
        className="flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors mx-auto"
        title="Sign in"
      >
        <LogIn className="h-3.5 w-3.5" />
      </a>
    );
  }

  return (
    <a
      href="/auth/signin"
      className="flex items-center gap-3 rounded-control px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
    >
      <LogIn className="h-4 w-4 shrink-0" />
      <span>Sign In</span>
    </a>
  );
}
