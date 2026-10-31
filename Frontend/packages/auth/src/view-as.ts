"use client";

import { useEffect, useState } from "react";
import {
  beginViewAs,
  createPlatformApiClient,
  finishViewAs,
  readViewAs,
  viewAsPaths,
  type ViewAsMarker,
  type ViewAsSessionDto,
} from "@repo/api";
import { AUTH_STORAGE_EVENT } from "./auth-service";

/** Stands for the Administrators role among a person's roles; the bar says it in the reader's language. */
export const ADMINISTRATORS_ROLE = "@administrators";

/**
 * Starts seeing Fusion as someone (administrators only; the server decides). Their read-only session replaces this
 * browser's, the administrator's own is kept aside, and Fusion opens on their Home.
 */
export async function startViewAs(userId: string, returnTo: string): Promise<void> {
  const view = await createPlatformApiClient().post<ViewAsSessionDto>(viewAsPaths.start(), { userId });
  beginViewAs(view.session, {
    sessionId: view.sessionId,
    viewerName: view.viewerName,
    personName: view.personName,
    roles: view.roles.map((role) => (role.isAdministrators ? ADMINISTRATORS_ROLE : role.name)),
    returnTo,
    expiresAt: view.expiresAt,
  });
  window.location.assign("/");
}

/** Ends the view (recorded on the server when it's still open) and returns to where it started. */
export async function endViewAs(): Promise<void> {
  const viewing = readViewAs();
  if (viewing && new Date(viewing.expiresAt).getTime() > Date.now()) {
    try {
      await createPlatformApiClient().post(viewAsPaths.end(), {});
    } catch {
      // The view ends in this browser either way; an expired or ended one is already closed on the server.
    }
  }
  const returnTo = finishViewAs();
  window.location.assign(returnTo ?? "/");
}

/** The view this browser is in, or null; null on the server and on first paint, so the frame hydrates the same. */
export function useViewAs(): ViewAsMarker | null {
  const [viewing, setViewing] = useState<ViewAsMarker | null>(null);
  useEffect(() => {
    const sync = () => setViewing(readViewAs());
    sync();
    window.addEventListener(AUTH_STORAGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTH_STORAGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return viewing;
}
