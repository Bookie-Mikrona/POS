import {
  objectStorageClient,
  ObjectStorageService,
} from './objectStorage';

export type CompanyObjectReference = {
  path: string;
  source: string;
};

export type OtherCompanyObjectReference = CompanyObjectReference & {
  companyId: string;
};

export type CompanyOffboardingObjectKind =
  | 'referenced-by-company'
  | 'missing'
  | 'cross-company'
  | 'tenant-prefix-orphan'
  | 'ambiguous-generic-upload-orphan';

export type CompanyOffboardingObject = {
  path: string;
  bucket: string;
  objectName: string;
  kind: CompanyOffboardingObjectKind;
  generation: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown>;
  sources: string[];
  otherCompanyIds: string[];
};

export type CompanyOffboardingBlocker = {
  code:
    | 'invalid-company-id'
    | 'invalid-reference'
    | 'duplicate-reference'
    | 'shared-reference'
    | 'unrecognized-object-path'
    | 'storage-list-failed'
    | 'storage-metadata-failed'
    | 'inventory-limit-exceeded'
    | 'unowned-generic-upload';
  message: string;
  path?: string;
};

export type CompanyOffboardingInventory = {
  companyId: string;
  objects: CompanyOffboardingObject[];
  verifiedObjects: CompanyOffboardingObject[];
  blockers: CompanyOffboardingBlocker[];
  complete: boolean;
};

type StorageFile = {
  name: string;
  metadata?: Record<string, unknown>;
  getMetadata(): Promise<[Record<string, unknown>]>;
};

type StorageBucket = {
  file(name: string): StorageFile;
  getFiles(options: {
    autoPaginate: false;
    maxResults: number;
    pageToken?: string;
    prefix: string;
  }): Promise<[StorageFile[], { pageToken?: string }?]>;
};

type StorageClient = {
  bucket(name: string): StorageBucket;
};

type Root = {
  bucket: string;
  prefix: string;
  type: 'private' | 'public';
};

type CanonicalObject = {
  bucket: string;
  objectName: string;
};

const DEFAULT_MAX_OBJECTS = 1000;
const PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRoot(raw: string, type: Root['type']): Root {
  const value = raw.trim().replace(/\/+$/, '');
  const segments = value.split('/');
  if (
    !value.startsWith('/') ||
    segments.length < 3 ||
    segments[0] !== '' ||
    !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(segments[1]) ||
    segments.slice(2).some((part) => !isSafeSegment(part))
  ) {
    throw new Error(`Invalid configured ${type} App Storage root`);
  }
  return { bucket: segments[1], prefix: segments.slice(2).join('/'), type };
}

function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(segment)
  );
}

function validateObjectName(name: string): boolean {
  return name.split('/').every(isSafeSegment);
}

function canonicalKey(object: CanonicalObject): string {
  return `${object.bucket}/${object.objectName}`;
}

function parseReferencePath(path: string, roots: Root[]): CanonicalObject {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 2048 ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('%')
  ) {
    throw new Error('Unsafe or malformed object path');
  }

  let raw = path;
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      throw new Error('Malformed object URL');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'storage.googleapis.com' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error('Unrecognized object URL');
    }
    raw = url.pathname;
  }

  let candidates: CanonicalObject[] = [];
  if (raw.startsWith('/objects/')) {
    const relative = raw.slice('/objects/'.length);
    if (!validateObjectName(relative)) throw new Error('Unsafe object path');
    const privateRoot = roots.find((root) => root.type === 'private');
    if (!privateRoot) throw new Error('Private App Storage root is unavailable');
    candidates = [{
      bucket: privateRoot.bucket,
      objectName: `${privateRoot.prefix}/${relative}`,
    }];
  } else if (raw.startsWith('/')) {
    const segments = raw.slice(1).split('/');
    if (segments.length < 2 || segments.some((part) => !isSafeSegment(part))) {
      throw new Error('Unrecognized or unsafe object path');
    }
    const bucket = segments[0];
    const objectName = segments.slice(1).join('/');
    candidates = roots
      .filter((root) =>
        root.bucket === bucket &&
        (objectName === root.prefix || objectName.startsWith(`${root.prefix}/`)),
      )
      .map(() => ({ bucket, objectName }));
  } else {
    throw new Error('Unrecognized object path; expected /objects/, configured bucket path, or GCS URL');
  }

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length > 1
        ? 'Object path matches multiple configured storage roots'
        : 'Object path is outside configured storage roots',
    );
  }
  if (
    !validateObjectName(candidates[0].objectName) ||
    !roots.some((root) =>
      root.bucket === candidates[0].bucket &&
      candidates[0].objectName.startsWith(`${root.prefix}/`),
    )
  ) {
    throw new Error('Object path is outside configured storage roots');
  }
  return candidates[0];
}

function storageRoots(service: ObjectStorageService): Root[] {
  const roots = [parseRoot(service.getPrivateObjectDir(), 'private')];
  if (process.env.PUBLIC_OBJECT_SEARCH_PATHS?.trim()) {
    roots.push(...service.getPublicObjectSearchPaths().map((path) => parseRoot(path, 'public')));
  }
  return roots;
}

/**
 * Read-only, bounded inventory of a company's explicitly-referenced App Storage
 * objects. Orphan paths are never treated as owned solely because of a filename.
 */
export async function inventoryCompanyOffboardingObjects(
  companyId: string,
  companyReferences: CompanyObjectReference[],
  otherCompanyReferences: OtherCompanyObjectReference[],
  options: {
    maxObjects?: number;
    service?: ObjectStorageService;
    client?: StorageClient;
  } = {},
): Promise<CompanyOffboardingInventory> {
  const result: CompanyOffboardingInventory = {
    companyId,
    objects: [],
    verifiedObjects: [],
    blockers: [],
    complete: true,
  };
  const addBlocker = (blocker: CompanyOffboardingBlocker) => {
    result.blockers.push(blocker);
    result.complete = false;
  };
  if (!UUID_PATTERN.test(companyId)) {
    addBlocker({ code: 'invalid-company-id', message: 'Company ID must be a UUID.' });
    return result;
  }

  const service = options.service ?? new ObjectStorageService();
  const client = options.client ?? (objectStorageClient as unknown as StorageClient);
  const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 10000) {
    addBlocker({
      code: 'inventory-limit-exceeded',
      message: 'maxObjects must be an integer between 1 and 10000.',
    });
    return result;
  }
  if (companyReferences.length + otherCompanyReferences.length > maxObjects) {
    addBlocker({
      code: 'inventory-limit-exceeded',
      message: `Reference input exceeded the configured ${maxObjects}-reference bound.`,
    });
    return result;
  }

  let roots: Root[];
  try {
    roots = storageRoots(service);
  } catch (error) {
    addBlocker({
      code: 'storage-list-failed',
      message: `Cannot enumerate configured App Storage roots: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return result;
  }

  const companyRefs = new Map<string, { canonical: CanonicalObject; refs: CompanyObjectReference[] }>();
  const otherRefs = new Map<string, { canonical: CanonicalObject; companyIds: Set<string>; refs: OtherCompanyObjectReference[] }>();
  // Keep the other-company index distinct so cross-tenant ownership is explicit.
  for (const ref of companyReferences) {
    try {
      if (!ref || typeof ref.source !== 'string' || !ref.source.trim()) {
        throw new Error('Reference source is required');
      }
      const canonical = parseReferencePath(ref.path, roots);
      const key = canonicalKey(canonical);
      const existing = companyRefs.get(key);
      if (existing) {
        addBlocker({ code: 'duplicate-reference', message: 'Multiple company database references resolve to the same object.', path: ref.path });
        existing.refs.push(ref);
      } else companyRefs.set(key, { canonical, refs: [ref] });
    } catch (error) {
      addBlocker({ code: 'unrecognized-object-path', message: error instanceof Error ? error.message : 'Invalid object reference', path: ref?.path });
    }
  }
  for (const ref of otherCompanyReferences) {
    try {
      if (!ref || !UUID_PATTERN.test(ref.companyId) || ref.companyId.toLowerCase() === companyId.toLowerCase() || typeof ref.source !== 'string' || !ref.source.trim()) {
        throw new Error('Other-company reference requires a different valid company UUID and a source');
      }
      const canonical = parseReferencePath(ref.path, roots);
      const key = canonicalKey(canonical);
      const existing = otherRefs.get(key);
      if (existing) {
        existing.refs.push(ref);
        existing.companyIds.add(ref.companyId);
        addBlocker({ code: 'duplicate-reference', message: 'Multiple database references resolve to the same object.', path: ref.path });
      } else otherRefs.set(key, { canonical, companyIds: new Set([ref.companyId]), refs: [ref] });
    } catch (error) {
      addBlocker({ code: 'unrecognized-object-path', message: error instanceof Error ? error.message : 'Invalid object reference', path: ref?.path });
    }
  }

  const listed = new Map<string, { canonical: CanonicalObject; roots: Root[] }>();
  let total = 0;
  for (const root of roots) {
    let pageToken: string | undefined;
    do {
      try {
        const [files, next] = await client.bucket(root.bucket).getFiles({
          autoPaginate: false,
          maxResults: PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
          prefix: `${root.prefix}/`,
        });
        for (const file of files) {
          const objectName = file.name;
          if (
            !objectName.startsWith(`${root.prefix}/`) ||
            !validateObjectName(objectName)
          ) {
            addBlocker({
              code: 'unrecognized-object-path',
              message: 'Storage listing returned an unsafe or out-of-root object name.',
              path: objectName,
            });
            continue;
          }
          const key = `${root.bucket}/${objectName}`;
          const previous = listed.get(key);
          if (previous) {
            // Overlapping configured roots do not duplicate inventory records.
            previous.roots.push(root);
          } else {
            listed.set(key, { canonical: { bucket: root.bucket, objectName }, roots: [root] });
            total += 1;
          }
          if (total > maxObjects) {
            addBlocker({
              code: 'inventory-limit-exceeded',
              message: `Storage inventory exceeded the configured ${maxObjects}-object bound.`,
            });
            break;
          }
        }
        if (total > maxObjects) break;
        pageToken = typeof next?.pageToken === 'string' && next.pageToken ? next.pageToken : undefined;
      } catch (error) {
        addBlocker({
          code: 'storage-list-failed',
          message: `Failed to list configured App Storage root: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
        pageToken = undefined;
        break;
      }
    } while (pageToken);
    if (total > maxObjects) break;
  }

  const keys = new Set([...listed.keys(), ...companyRefs.keys(), ...otherRefs.keys()]);
  for (const key of keys) {
    const listedObject = listed.get(key);
    const companyEntry = companyRefs.get(key);
    const otherEntry = otherRefs.get(key);
    const canonical = listedObject?.canonical ?? companyEntry?.canonical ?? otherEntry?.canonical;
    if (!canonical) continue;
    const relativePrivatePath = roots
      .filter((root) => root.type === 'private' && root.bucket === canonical.bucket)
      .map((root) => canonical.objectName.startsWith(`${root.prefix}/`)
        ? canonical.objectName.slice(root.prefix.length + 1)
        : '')
      .find(Boolean);
    const tenantPrefix = relativePrivatePath
      ?.toLowerCase()
      .startsWith(`companies/${companyId.toLowerCase()}/`) ?? false;
    let kind: CompanyOffboardingObjectKind;
    if (otherEntry) {
      kind = 'cross-company';
      addBlocker({
        code: 'shared-reference',
        message: 'Object is referenced by another company; ownership is shared or conflicting.',
        path: companyEntry?.refs[0]?.path ?? otherEntry.refs[0]?.path,
      });
    } else if (companyEntry) {
      kind = listedObject ? 'referenced-by-company' : 'missing';
    } else if (tenantPrefix) {
      kind = 'tenant-prefix-orphan';
    } else {
      kind = 'ambiguous-generic-upload-orphan';
      if (listedObject) {
        addBlocker({
          code: 'unowned-generic-upload',
          message: 'Unreferenced object has no explicit company ownership; filename/path alone cannot establish ownership.',
          path: `/objects/${relativePrivatePath ?? canonical.objectName}`,
        });
      }
    }

    let generation: string | null = null;
    let sizeBytes: number | null = null;
    let metadata: Record<string, unknown> = {};
    if (listedObject) {
      try {
        const file = client.bucket(canonical.bucket).file(canonical.objectName);
        const [rawMetadata] = await file.getMetadata();
        metadata = { ...rawMetadata };
        generation = rawMetadata.generation == null ? null : String(rawMetadata.generation);
        if (generation === null || generation.length === 0) {
          throw new Error('Object generation metadata is unavailable');
        }
        if (rawMetadata.size == null) throw new Error('Object size metadata is unavailable');
        const parsedSize = Number(rawMetadata.size);
        if (Number.isSafeInteger(parsedSize) && parsedSize >= 0) sizeBytes = parsedSize;
        else throw new Error('Object size metadata is not a safe integer');
      } catch (error) {
        addBlocker({
          code: 'storage-metadata-failed',
          message: `Could not verify object generation and size: ${error instanceof Error ? error.message : 'unknown error'}`,
          path: `/objects/${relativePrivatePath ?? canonical.objectName}`,
        });
      }
    }
    const inventoryObject: CompanyOffboardingObject = {
      path: relativePrivatePath
        ? `/objects/${relativePrivatePath}`
        : `/${canonical.bucket}/${canonical.objectName}`,
      bucket: canonical.bucket,
      objectName: canonical.objectName,
      kind,
      generation,
      sizeBytes,
      metadata,
      sources: companyEntry?.refs.map((ref) => ref.source) ?? [],
      otherCompanyIds: otherEntry ? Array.from(otherEntry.companyIds) : [],
    };
    result.objects.push(inventoryObject);
    if (listedObject && companyEntry && !otherEntry && generation !== null && sizeBytes !== null) {
      result.verifiedObjects.push(inventoryObject);
    }
  }

  return result;
}