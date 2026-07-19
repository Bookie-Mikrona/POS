import { Readable } from 'stream';
import { eq, and } from 'drizzle-orm';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { db, documentsTable, accountingRolesTable } from '@workspace/db';
import { requireAuth, type AuthenticatedRequest } from '../middlewares/requireAuth';

import { ObjectPermission } from '../lib/objectAcl';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires Clerk auth so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    const { name, size, contentType } = parsed.data;

    // Allowlist MIME types (server-side, before minting a write URL)
    const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!ALLOWED_MIME.includes(contentType)) {
      res.status(400).json({ error: 'Dovoljeni tipi: PDF, JPG, PNG, WEBP' });
      return;
    }

    // Hard size limit before minting a write URL
    const MAX_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? String(20 * 1024 * 1024), 10);
    if (size > MAX_BYTES) {
      res.status(400).json({ error: `Datoteka je prevelika (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve private object entities from PRIVATE_OBJECT_DIR.
 * Requires authentication and company-level ownership check via the documents table.
 */
router.get('/storage/objects/*path', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
  const objectPath = `/objects/${wildcardPath}`;

  // Lookup which company owns this object via the documents table
  const [doc] = await db
    .select({ companyId: documentsTable.companyId })
    .from(documentsTable)
    .where(eq(documentsTable.objectPath, objectPath))
    .limit(1);

  if (!doc) {
    res.status(404).json({ error: 'Object not found' });
    return;
  }

  // Verify caller has a role in the specific company that owns this object
  const [role] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(
      eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
      eq(accountingRolesTable.companyId, doc.companyId),
    ))
    .limit(1);

  if (!role) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
