import { useCallback, useEffect, useRef } from "react";
import { deleteJavniProfilImage } from "@workspace/api-client-react";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const STAGING_PATH = new RegExp(
  `^/objects/uploads/public-profile-staging/${UUID_V4}/[1-9][0-9]*/(${UUID_V4})$`,
  "i",
);

export function publicProfileStagingObjectId(value: string | null | undefined): string | null {
  return value?.match(STAGING_PATH)?.[1] ?? null;
}

function deleteStagingImageBestEffort(objectPath: string): void {
  const objectId = publicProfileStagingObjectId(objectPath);
  if (objectId) void deleteJavniProfilImage(objectId, { keepalive: true }).catch(() => {});
}

export function usePublicProfileStagingImages() {
  const stagedPathsRef = useRef(new Set<string>());
  const disposedRef = useRef(false);

  const track = useCallback((objectPath: string) => {
    if (!publicProfileStagingObjectId(objectPath)) return;
    if (disposedRef.current) {
      deleteStagingImageBestEffort(objectPath);
      return;
    }
    stagedPathsRef.current.add(objectPath);
  }, []);

  const forget = useCallback((objectPath: string | null | undefined) => {
    if (objectPath) stagedPathsRef.current.delete(objectPath);
  }, []);

  const markSaved = useCallback((objectPaths: Iterable<string | null | undefined>) => {
    for (const objectPath of objectPaths) forget(objectPath);
  }, [forget]);

  const discard = useCallback((objectPath: string | null | undefined) => {
    if (!objectPath || !publicProfileStagingObjectId(objectPath)) return;
    stagedPathsRef.current.delete(objectPath);
    deleteStagingImageBestEffort(objectPath);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const abandonedPaths = [...stagedPathsRef.current];
      stagedPathsRef.current.clear();
      abandonedPaths.forEach(deleteStagingImageBestEffort);
    };
  }, []);

  return { track, forget, markSaved, discard };
}