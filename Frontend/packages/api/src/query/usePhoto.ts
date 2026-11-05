"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPlatformApiClient } from "../platform";
import { corePeopleQueryKeys, createCorePeopleApi } from "../core-people";

/**
 * A person's photo, ready for `<img src>`: the API needs the bearer token, so the photo loads as a blob through
 * the client. Cached per versioned `photoUrl` for the session (a new upload is a new address); null while it
 * loads, without a photo, or when it fails, so the initials stay in place.
 */
export function usePhoto(photoUrl: string | null | undefined): string | null {
  const api = useMemo(() => createCorePeopleApi(createPlatformApiClient()), []);
  const { data } = useQuery({
    queryKey: corePeopleQueryKeys.photo(photoUrl ?? ""),
    queryFn: ({ signal }) => api.photo(photoUrl!, signal),
    enabled: Boolean(photoUrl),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!photoUrl || !(data instanceof Blob)) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [data, photoUrl]);
  return src;
}

/**
 * Photos for faces in a list, by the `photoUrl` the server gave each person (null for someone without one, who is
 * never asked for): photoUrl → displayable address, absent while loading or when it fails. Shares `usePhoto`'s cache.
 */
export function usePhotos(photoUrls: readonly (string | null | undefined)[]): ReadonlyMap<string, string> {
  const api = useMemo(() => createCorePeopleApi(createPlatformApiClient()), []);
  const ids = [...new Set(photoUrls.filter((url): url is string => Boolean(url)))].sort();
  const results = useQueries({
    queries: ids.map((url) => ({
      queryKey: corePeopleQueryKeys.photo(url),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.photo(url, signal),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: false,
    })),
  });
  const blobs = results.map((result) => (result.data instanceof Blob ? result.data : null));
  const [photos, setPhotos] = useState<ReadonlyMap<string, string>>(new Map());
  const signature = ids.map((id, index) => `${id}:${blobs[index] ? results[index]!.dataUpdatedAt : 0}`).join(",");
  useEffect(() => {
    const next = new Map<string, string>();
    ids.forEach((id, index) => {
      const blob = blobs[index];
      if (blob) next.set(id, URL.createObjectURL(blob));
    });
    setPhotos(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
    // The signature names every address and when its photo arrived.
  }, [signature]);
  return photos;
}
