import { describe, expect, it, vi } from "vitest";
import {
  cleanupAbandonedPublicProfileImages,
  PUBLIC_PROFILE_IMAGE_CLEANUP_CYCLE_WARNING_MS,
  PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
  PUBLIC_PROFILE_IMAGE_CLEANUP_WARNING_COOLDOWN_MS,
  PUBLIC_PROFILE_STAGING_RETENTION_MS,
  runPublicProfileImageCleanup,
  runScheduledPublicProfileImageCleanup,
  tryAcquirePublicProfileImageCleanupLock,
} from "./publicProfileImageRetention";

const companyId = "11111111-1111-4111-8111-111111111111";
const unitId = 7;
const oldOrphan =
  `/objects/uploads/public-profile-staging/${companyId}/${unitId}/22222222-2222-4222-8222-222222222222`;
const recentOrphan =
  `/objects/uploads/public-profile-staging/${companyId}/${unitId}/33333333-3333-4333-8333-333333333333`;
const referencedStaging =
  `/objects/uploads/public-profile-staging/${companyId}/${unitId}/44444444-4444-4444-8444-444444444444`;
const publishedImage =
  `/objects/uploads/public-profile/${companyId}/${unitId}/55555555-5555-4555-8555-555555555555`;
const unrelatedDocument =
  "/objects/uploads/documents/66666666-6666-4666-8666-666666666666";

describe("čiščenje opuščenih slik javnega profila", () => {
  it("odstrani le dovolj staro in neuporabljeno začasno sliko", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const old = new Date(now.getTime() - PUBLIC_PROFILE_STAGING_RETENTION_MS - 1);
    const recent = new Date(now.getTime() - PUBLIC_PROFILE_STAGING_RETENTION_MS + 1);
    const deleteObjectEntity = vi.fn().mockResolvedValue(undefined);
    const onDeleteError = vi.fn();

    const result = await cleanupAbandonedPublicProfileImages(now, {
      storage: {
        listObjectEntityPage: vi.fn().mockResolvedValue({
          objects: [
            { objectPath: oldOrphan, timeCreated: old },
            { objectPath: recentOrphan, timeCreated: recent },
            { objectPath: referencedStaging, timeCreated: old },
            { objectPath: publishedImage, timeCreated: old },
            { objectPath: unrelatedDocument, timeCreated: old },
            {
              objectPath: `/objects/uploads/public-profile-staging/${companyId}/${unitId}/ni-uuid`,
              timeCreated: old,
            },
            { objectPath: oldOrphan.replace(companyId, "not-a-company-id"), timeCreated: old },
            { objectPath: oldOrphan.replace(`/${unitId}/`, "/0/"), timeCreated: old },
            { objectPath: oldOrphan, timeCreated: null },
          ],
          nextPageToken: null,
        }),
        deleteObjectEntity,
      },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set([referencedStaging])),
      onDeleteError,
    });

    expect(deleteObjectEntity).toHaveBeenCalledOnce();
    expect(deleteObjectEntity).toHaveBeenCalledWith(oldOrphan);
    expect(onDeleteError).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 9, deleted: 1, failed: 0, nextPageToken: null });
  });

  it("napaka enega izbrisa ne prepreči čiščenja naslednje slike", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const old = new Date(now.getTime() - PUBLIC_PROFILE_STAGING_RETENTION_MS - 1);
    const secondOrphan =
      `/objects/uploads/public-profile-staging/${companyId}/${unitId}/77777777-7777-4777-8777-777777777777`;
    const failure = new Error("temporary storage error");
    const deleteObjectEntity = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const onDeleteError = vi.fn();

    const result = await cleanupAbandonedPublicProfileImages(now, {
      storage: {
        listObjectEntityPage: vi.fn().mockResolvedValue({
          objects: [
            { objectPath: oldOrphan, timeCreated: old },
            { objectPath: secondOrphan, timeCreated: old },
          ],
          nextPageToken: null,
        }),
        deleteObjectEntity,
      },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set()),
      onDeleteError,
    });

    expect(deleteObjectEntity).toHaveBeenCalledTimes(2);
    expect(onDeleteError).toHaveBeenCalledWith(oldOrphan, failure);
    expect(result).toEqual({ scanned: 2, deleted: 1, failed: 1, nextPageToken: null });
  });

  it("omeji prehod na tri strani in naslednjič varno nadaljuje", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const old = new Date(now.getTime() - PUBLIC_PROFILE_STAGING_RETENTION_MS - 1);
    const objects = Array.from({ length: 350 }, (_, index) => ({
      objectPath:
        `/objects/uploads/public-profile-staging/${companyId}/${unitId}/` +
        `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`,
      timeCreated: old,
    }));
    const listObjectEntityPage = vi.fn()
      .mockResolvedValueOnce({
        objects: objects.slice(0, 100),
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        objects: objects.slice(100, 200),
        nextPageToken: "page-3",
      })
      .mockResolvedValueOnce({
        objects: objects.slice(200, 300),
        nextPageToken: "page-4",
      })
      .mockResolvedValueOnce({
        objects: objects.slice(300),
        nextPageToken: null,
      });
    const deleteObjectEntity = vi.fn().mockResolvedValue(undefined);
    const dependencies = {
      storage: { listObjectEntityPage, deleteObjectEntity },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set<string>()),
    };

    const first = await cleanupAbandonedPublicProfileImages(now, dependencies);

    expect(first).toEqual({
      scanned: 300,
      deleted: 300,
      failed: 0,
      nextPageToken: "page-4",
    });
    expect(listObjectEntityPage).toHaveBeenCalledTimes(3);
    expect(listObjectEntityPage.mock.calls).toEqual([
      ["uploads/public-profile-staging", {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: undefined,
      }],
      ["uploads/public-profile-staging", {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: "page-2",
      }],
      ["uploads/public-profile-staging", {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: "page-3",
      }],
    ]);

    const second = await cleanupAbandonedPublicProfileImages(
      now,
      dependencies,
      { pageToken: first.nextPageToken ?? undefined },
    );

    expect(second).toEqual({
      scanned: 50,
      deleted: 50,
      failed: 0,
      nextPageToken: null,
    });
    expect(listObjectEntityPage).toHaveBeenLastCalledWith(
      "uploads/public-profile-staging",
      {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: "page-4",
      },
    );
    expect(deleteObjectEntity).toHaveBeenCalledTimes(350);
  });

  it("po ponovnem zagonu nadaljuje s trajno shranjenega položaja", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const listObjectEntityPage = vi.fn()
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: "page-3",
      })
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: "page-4",
      })
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: null,
      });
    let persistedState:
      | { pageToken: string; cycleStartedAtMs?: number; lastWarningAtMs?: number }
      | undefined;
    const cursorStore = {
      load: vi.fn(async () => persistedState),
      save: vi.fn(async (state: typeof persistedState | null) => {
        persistedState = state ?? undefined;
      }),
    };
    const firstProcessDependencies = {
      storage: {
        listObjectEntityPage,
        deleteObjectEntity: vi.fn(),
      },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set<string>()),
    };

    const first = await runPublicProfileImageCleanup(
      now,
      firstProcessDependencies,
      cursorStore,
    );

    expect(first.nextPageToken).toBe("page-4");
    expect(persistedState?.pageToken).toBe("page-4");
    expect(persistedState?.cycleStartedAtMs).toBe(now.getTime());

    const restartedProcessDependencies = {
      storage: {
        listObjectEntityPage,
        deleteObjectEntity: vi.fn(),
      },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set<string>()),
    };
    const second = await runPublicProfileImageCleanup(
      now,
      restartedProcessDependencies,
      cursorStore,
    );

    expect(listObjectEntityPage).toHaveBeenLastCalledWith(
      "uploads/public-profile-staging",
      {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: "page-4",
      },
    );
    expect(second.nextPageToken).toBeNull();
    expect(persistedState).toBeUndefined();
    expect(cursorStore.load).toHaveBeenCalledTimes(2);
  });

  it("zastarel trajni položaj izbriše in varno začne nov cikel", async () => {
    const stalePageTokenError = Object.assign(
      new Error("Invalid page token."),
      { code: 400 },
    );
    const listObjectEntityPage = vi.fn()
      .mockRejectedValueOnce(stalePageTokenError)
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: null,
      });
    const cursorStore = {
      load: vi.fn().mockResolvedValue({
        pageToken: "stale-page-token",
        cycleStartedAtMs: new Date("2026-09-19T12:00:00.000Z").getTime(),
      }),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runPublicProfileImageCleanup(
      new Date("2026-09-20T12:00:00.000Z"),
      {
        storage: {
          listObjectEntityPage,
          deleteObjectEntity: vi.fn(),
        },
        loadReferencedPaths: vi.fn().mockResolvedValue(new Set<string>()),
      },
      cursorStore,
    );

    expect(result.nextPageToken).toBeNull();
    expect(listObjectEntityPage.mock.calls).toEqual([
      ["uploads/public-profile-staging", {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: "stale-page-token",
      }],
      ["uploads/public-profile-staging", {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: undefined,
      }],
    ]);
    expect(cursorStore.save).toHaveBeenCalledOnce();
    expect(cursorStore.save).toHaveBeenCalledWith(null);
  });

  it("po varnem pragu omejeno opozori in ob koncu ponastavi čas cikla", async () => {
    const startedAt = new Date("2026-09-20T12:00:00.000Z");
    let completeCycle = false;
    let page = 0;
    const listObjectEntityPage = vi.fn(async () => {
      if (completeCycle) {
        return { objects: [], nextPageToken: null };
      }
      page += 1;
      return { objects: [], nextPageToken: `page-${page}` };
    });
    let persistedState:
      | { pageToken: string; cycleStartedAtMs?: number; lastWarningAtMs?: number }
      | undefined;
    const cursorStore = {
      load: vi.fn(async () => persistedState),
      save: vi.fn(async (state: typeof persistedState | null) => {
        persistedState = state ?? undefined;
      }),
    };
    const onCycleOverdue = vi.fn();
    const dependencies = {
      storage: {
        listObjectEntityPage,
        deleteObjectEntity: vi.fn(),
      },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set<string>()),
    };

    await runPublicProfileImageCleanup(
      startedAt,
      dependencies,
      cursorStore,
      { onCycleOverdue },
    );
    expect(persistedState).toMatchObject({
      pageToken: "page-3",
      cycleStartedAtMs: startedAt.getTime(),
    });
    expect(persistedState?.lastWarningAtMs).toBeUndefined();
    expect(onCycleOverdue).not.toHaveBeenCalled();

    const warningAt = new Date(
      startedAt.getTime() + PUBLIC_PROFILE_IMAGE_CLEANUP_CYCLE_WARNING_MS,
    );
    await runPublicProfileImageCleanup(
      warningAt,
      dependencies,
      cursorStore,
      { onCycleOverdue },
    );
    expect(onCycleOverdue).toHaveBeenCalledOnce();
    expect(onCycleOverdue).toHaveBeenCalledWith({
      cycleAgeMs: PUBLIC_PROFILE_IMAGE_CLEANUP_CYCLE_WARNING_MS,
      warningCooldownMs: PUBLIC_PROFILE_IMAGE_CLEANUP_WARNING_COOLDOWN_MS,
      scanned: 0,
      deleted: 0,
      failed: 0,
    });
    expect(persistedState?.lastWarningAtMs).toBe(warningAt.getTime());

    await runPublicProfileImageCleanup(
      new Date(warningAt.getTime() + 60 * 60 * 1000),
      dependencies,
      cursorStore,
      { onCycleOverdue },
    );
    expect(onCycleOverdue).toHaveBeenCalledOnce();
    expect(persistedState?.cycleStartedAtMs).toBe(startedAt.getTime());

    completeCycle = true;
    await runPublicProfileImageCleanup(
      new Date(warningAt.getTime() + 2 * 60 * 60 * 1000),
      dependencies,
      cursorStore,
      { onCycleOverdue },
    );
    expect(persistedState).toBeUndefined();
    expect(cursorStore.save).toHaveBeenLastCalledWith(null);
  });

  it("izpusti prekrivajoči interval in naslednjič nadaljuje s shranjenega položaja", async () => {
    let resolveFirstPage!: (value: {
      objects: [];
      nextPageToken: string;
    }) => void;
    const firstPage = new Promise<{
      objects: [];
      nextPageToken: string;
    }>((resolve) => {
      resolveFirstPage = resolve;
    });
    const listObjectEntityPage = vi.fn()
      .mockReturnValueOnce(firstPage)
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: "page-3",
      })
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: "page-4",
      })
      .mockResolvedValueOnce({
        objects: [],
        nextPageToken: null,
      });
    let persistedState:
      | { pageToken: string; cycleStartedAtMs?: number; lastWarningAtMs?: number }
      | undefined;
    const cursorStore = {
      load: vi.fn(async () => persistedState),
      save: vi.fn(async (state: typeof persistedState | null) => {
        persistedState = state ?? undefined;
      }),
    };
    const cleanupDependencies = {
      storage: {
        listObjectEntityPage,
        deleteObjectEntity: vi.fn(),
      },
      loadReferencedPaths: vi.fn().mockResolvedValue(new Set<string>()),
    };
    const onCompleted = vi.fn();
    const onError = vi.fn();
    const onSkipped = vi.fn();
    const releaseLock = vi.fn().mockResolvedValue(undefined);
    const acquireLock = vi.fn(async () => releaseLock);
    const scheduledDependencies = {
      execute: () => runPublicProfileImageCleanup(
        new Date("2026-09-20T12:00:00.000Z"),
        cleanupDependencies,
        cursorStore,
      ),
      acquireLock,
      onCompleted,
      onError,
      onSkipped,
    };

    const slowRun = runScheduledPublicProfileImageCleanup(
      scheduledDependencies,
    );
    await vi.waitFor(() => {
      expect(listObjectEntityPage).toHaveBeenCalledOnce();
    });

    const overlappingRun = await runScheduledPublicProfileImageCleanup(
      scheduledDependencies,
    );

    expect(overlappingRun).toBe("skipped");
    expect(onSkipped).toHaveBeenCalledWith("process_already_running");
    expect(cursorStore.save).not.toHaveBeenCalled();
    expect(listObjectEntityPage).toHaveBeenCalledOnce();

    resolveFirstPage({
      objects: [],
      nextPageToken: "page-2",
    });
    await expect(slowRun).resolves.toBe("completed");
    expect(persistedState?.pageToken).toBe("page-4");
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();

    await expect(
      runScheduledPublicProfileImageCleanup(scheduledDependencies),
    ).resolves.toBe("completed");
    expect(listObjectEntityPage).toHaveBeenLastCalledWith(
      "uploads/public-profile-staging",
      {
        pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
        pageToken: "page-4",
      },
    );
    expect(persistedState).toBeUndefined();
    expect(onCompleted).toHaveBeenCalledTimes(2);
    expect(onSkipped).toHaveBeenCalledOnce();
    expect(acquireLock).toHaveBeenCalledTimes(2);
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });

  it("PostgreSQL zaklep dovoli samo en aktiven prehod med dvema povezavama", async () => {
    const releaseFirst = await tryAcquirePublicProfileImageCleanupLock();
    expect(releaseFirst).toBeTypeOf("function");
    const execute = vi.fn();
    const onSkipped = vi.fn();

    try {
      const secondResult = await runScheduledPublicProfileImageCleanup({
        execute,
        acquireLock: tryAcquirePublicProfileImageCleanupLock,
        onCompleted: vi.fn(),
        onError: vi.fn(),
        onSkipped,
      });
      expect(secondResult).toBe("skipped");
      expect(execute).not.toHaveBeenCalled();
      expect(onSkipped).toHaveBeenCalledWith("distributed_lock_held");
    } finally {
      await releaseFirst?.();
    }

    const releaseAfterFirst = await tryAcquirePublicProfileImageCleanupLock();
    expect(releaseAfterFirst).toBeTypeOf("function");
    await releaseAfterFirst?.();
  });

  it("PostgreSQL zaklep sprosti tudi po napaki čistilnega prehoda", async () => {
    const failure = new Error("Nadzorovana napaka čiščenja.");
    const releaseLock = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const result = await runScheduledPublicProfileImageCleanup({
      execute: vi.fn().mockRejectedValue(failure),
      acquireLock: vi.fn(async () => releaseLock),
      onCompleted: vi.fn(),
      onError,
      onSkipped: vi.fn(),
    });

    expect(result).toBe("failed");
    expect(onError).toHaveBeenCalledWith(failure);
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});