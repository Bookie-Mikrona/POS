import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
const APP_STORAGE_ENV_KEYS = [
  'DEFAULT_OBJECT_STORAGE_BUCKET_ID',
  'PUBLIC_OBJECT_SEARCH_PATHS',
  'PRIVATE_OBJECT_DIR',
] as const;

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

function normalizeObjectStorageRoot(
  rawPath: string,
  variableName: 'PRIVATE_OBJECT_DIR' | 'PUBLIC_OBJECT_SEARCH_PATHS',
): string {
  const normalizedDir = rawPath.trim().replace(/\/+$/, '');
  const parts = normalizedDir.split('/');
  const bucketName = parts[1];
  const rootParts = parts.slice(2);
  const validBucketName =
    typeof bucketName === 'string' &&
    bucketName.length >= 3 &&
    bucketName.length <= 63 &&
    /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(bucketName) &&
    !bucketName.includes('..') &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucketName);
  const validRoot =
    rootParts.length > 0 &&
    rootParts.every(
      (part) =>
        part.length > 0 &&
        part !== '.' &&
        part !== '..' &&
        /^[a-zA-Z0-9._-]+$/.test(part),
    );
  if (
    !normalizedDir.startsWith('/') ||
    parts[0] !== '' ||
    !validBucketName ||
    !validRoot
  ) {
    throw new Error(
      `Invalid ${variableName}: expected /bucket/root with safe path segments`,
    );
  }
  return normalizedDir;
}

function normalizePrivateObjectDir(dir: string | undefined): string {
  if (!dir?.trim()) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
        'tool and set PRIVATE_OBJECT_DIR env var.',
    );
  }
  return normalizeObjectStorageRoot(dir, 'PRIVATE_OBJECT_DIR');
}

function normalizePublicObjectSearchPaths(
  pathsString: string | undefined,
): string[] {
  if (!pathsString?.trim()) {
    throw new Error(
      "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
        'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
    );
  }

  const paths = pathsString
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) =>
      normalizeObjectStorageRoot(path, 'PUBLIC_OBJECT_SEARCH_PATHS'),
    );
  return Array.from(new Set(paths));
}

function validatePublicObjectPath(relativePath: string): string {
  // Validate the literal storage key: decoding or removing separators could
  // make writes and public URL lookups refer to different objects.
  if (
    !relativePath ||
    /[\\%?#\u0000-\u001f\u007f]/.test(relativePath) ||
    relativePath.split('/').some(
      (part) => !part || part === '.' || part === '..',
    )
  ) {
    throw new Error('Invalid public object path');
  }
  return relativePath;
}

export type ObjectStorageReadiness =
  | {
      enabled: false;
      reason: 'app_storage_not_configured';
    }
  | {
      enabled: true;
      privateObjectDir: string;
      publicObjectSearchPaths?: string[];
    };

export function evaluateObjectStorageReadiness(
  environment: NodeJS.ProcessEnv = process.env,
): ObjectStorageReadiness {
  const enabled = APP_STORAGE_ENV_KEYS.some(
    (key) => environment[key]?.trim(),
  );
  if (!enabled) {
    return {
      enabled: false,
      reason: 'app_storage_not_configured',
    };
  }

  const publicObjectSearchPaths = environment.PUBLIC_OBJECT_SEARCH_PATHS?.trim()
    ? normalizePublicObjectSearchPaths(environment.PUBLIC_OBJECT_SEARCH_PATHS)
    : undefined;
  return {
    enabled: true,
    privateObjectDir: normalizePrivateObjectDir(
      environment.PRIVATE_OBJECT_DIR,
    ),
    ...(publicObjectSearchPaths
      ? { publicObjectSearchPaths }
      : {}),
  };
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    return normalizePublicObjectSearchPaths(
      process.env.PUBLIC_OBJECT_SEARCH_PATHS,
    );
  }

  getPrivateObjectDir(): string {
    return normalizePrivateObjectDir(process.env.PRIVATE_OBJECT_DIR);
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    const validatedPath = validatePublicObjectPath(filePath);
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${validatedPath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  /**
   * Shrani aplikacijsko ustvarjeno javno vsebino v prvi konfigurirani javni
   * prostor. Končni javni URL vedno streže naš API, zato GCS objekta ni treba
   * izpostaviti neposredno internetu.
   */
  async savePublicObject(
    relativePath: string,
    contents: Buffer,
    contentType: string,
  ): Promise<void> {
    const validatedPath = validatePublicObjectPath(relativePath);

    const [publicPath] = this.getPublicObjectSearchPaths();
    if (!publicPath) {
      throw new Error("No public object storage path configured");
    }

    const { bucketName, objectName } = parseObjectPath(
      `${publicPath}/${validatedPath}`,
    );
    await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .save(contents, {
        resumable: false,
        metadata: {
          contentType,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(relativeDir = 'uploads'): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const normalizedDir = relativeDir.replace(/^\/+|\/+$/g, '');
    if (
      !normalizedDir ||
      normalizedDir.split('/').some((part) => !part || part === '.' || part === '..' || !/^[a-zA-Z0-9_-]+$/.test(part))
    ) {
      throw new Error('Invalid object upload directory');
    }
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/${normalizedDir}/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  /**
   * Returns the actual byte size of an object entity as reported by GCS metadata.
   * Use this for server-side size enforcement — do NOT rely on client-supplied sizes.
   */
  async getObjectEntitySizeBytes(objectPath: string): Promise<number | null> {
    try {
      const file = await this.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      const raw = metadata?.size;
      if (raw == null) return null;
      return typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    } catch {
      return null;
    }
  }

  async listObjectEntityPage(
    relativePrefix: string,
    options: { pageSize: number; pageToken?: string },
  ): Promise<{
    objects: Array<{
      objectPath: string;
      timeCreated: Date | null;
    }>;
    nextPageToken: string | null;
  }> {
    const normalizedPrefix = relativePrefix.replace(/^\/+|\/+$/g, '');
    if (
      !normalizedPrefix ||
      normalizedPrefix.split('/').some((part) =>
        !part || part === '.' || part === '..' || !/^[a-zA-Z0-9_-]+$/.test(part),
      )
    ) {
      throw new Error('Invalid object listing prefix');
    }
    if (
      !Number.isInteger(options.pageSize) ||
      options.pageSize < 1 ||
      options.pageSize > 1000
    ) {
      throw new Error('Invalid object listing page size');
    }

    const privateObjectDir = this.getPrivateObjectDir().replace(/\/+$/, '');
    const { bucketName, objectName: privateObjectName } = parseObjectPath(privateObjectDir);
    const prefix = `${privateObjectName.replace(/\/+$/, '')}/${normalizedPrefix}/`;
    const [files, nextQuery] = await objectStorageClient.bucket(bucketName).getFiles({
      autoPaginate: false,
      maxResults: options.pageSize,
      pageToken: options.pageToken,
      prefix,
    });

    const objects = files.map((file) => {
      const relativePath = file.name.slice(privateObjectName.length).replace(/^\/+/, '');
      const rawTimeCreated = file.metadata.timeCreated;
      const parsedTimeCreated = rawTimeCreated ? new Date(String(rawTimeCreated)) : null;
      return {
        objectPath: `/objects/${relativePath}`,
        timeCreated: parsedTimeCreated && !Number.isNaN(parsedTimeCreated.getTime())
          ? parsedTimeCreated
          : null,
      };
    });

    return {
      objects,
      nextPageToken:
        typeof nextQuery?.pageToken === 'string' && nextQuery.pageToken
          ? nextQuery.pageToken
          : null,
    };
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    await file.delete({ ignoreNotFound: true });
  }

  async copyObjectEntityToNewPath(
    sourcePath: string,
    relativeDir: string,
  ): Promise<string> {
    const source = await this.getObjectEntityFile(sourcePath);
    const normalizedDir = relativeDir.replace(/^\/+|\/+$/g, '');
    if (
      !normalizedDir ||
      normalizedDir.split('/').some((part) => !part || part === '.' || part === '..' || !/^[a-zA-Z0-9_-]+$/.test(part))
    ) {
      throw new Error('Invalid object destination directory');
    }
    const objectId = randomUUID();
    const privateObjectDir = this.getPrivateObjectDir().replace(/\/+$/, '');
    const { bucketName, objectName } = parseObjectPath(
      `${privateObjectDir}/${normalizedDir}/${objectId}`,
    );
    await source.copy(objectStorageClient.bucket(bucketName).file(objectName));
    return `/objects/${normalizedDir}/${objectId}`;
  }

  async saveObjectEntityToNewPath(
    relativeDir: string,
    contents: Buffer,
    contentType: string,
  ): Promise<string> {
    const normalizedDir = relativeDir.replace(/^\/+|\/+$/g, '');
    if (
      !normalizedDir ||
      normalizedDir.split('/').some((part) =>
        !part || part === '.' || part === '..' || !/^[a-zA-Z0-9_-]+$/.test(part),
      )
    ) {
      throw new Error('Invalid object destination directory');
    }
    const objectId = randomUUID();
    const privateObjectDir = this.getPrivateObjectDir().replace(/\/+$/, '');
    const { bucketName, objectName } = parseObjectPath(
      `${privateObjectDir}/${normalizedDir}/${objectId}`,
    );
    await objectStorageClient.bucket(bucketName).file(objectName).save(contents, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return `/objects/${normalizedDir}/${objectId}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = await response.json() as { signed_url: string };
  return signedURL;
}
