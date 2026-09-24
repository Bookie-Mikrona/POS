import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inventoryCompanyOffboardingObjects,
  type CompanyObjectReference,
  type OtherCompanyObjectReference,
} from './companyOffboardingObjects';
import type { ObjectStorageService } from './objectStorage';

const companyA = '11111111-1111-4111-8111-111111111111';
const companyB = '22222222-2222-4222-8222-222222222222';
const bucketName = 'company-bucket';

function makeStorage(files: string[]) {
  const listedMetadata = vi.fn(async (name: string): Promise<[Record<string, unknown>]> => [{
    generation: name.endsWith('document.pdf') ? '17' : '23',
    size: name.endsWith('document.pdf') ? '456' : '12',
    contentType: 'application/pdf',
  }]);
  const getFiles = vi.fn(async ({ prefix }: { prefix: string }) => [
    files
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({
        name,
        metadata: {},
        getMetadata: () => listedMetadata(name),
      })),
    undefined,
  ] as [
    Array<{
      name: string;
      metadata: Record<string, unknown>;
      getMetadata(): Promise<[Record<string, unknown>]>;
    }>,
    undefined,
  ]);
  const bucket = vi.fn(() => ({
    getFiles,
    file: (name: string) => ({
      name,
      metadata: {},
      getMetadata: () => listedMetadata(name),
    }),
  }));
  const service = {
    getPrivateObjectDir: () => `/${bucketName}/private`,
    getPublicObjectSearchPaths: () => [`/${bucketName}/public`],
  } as unknown as ObjectStorageService;
  return { client: { bucket }, getFiles, listedMetadata, service };
}

const ref = (path: string, source = 'documents.objectPath'): CompanyObjectReference => ({
  path,
  source,
});

beforeEach(() => {
  vi.stubEnv('PUBLIC_OBJECT_SEARCH_PATHS', `/${bucketName}/public`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('company offboarding App Storage inventory', () => {
  it('inventories both roots and differentiates tenant references, missing files, shared objects, and orphans', async () => {
    const { client, getFiles, service } = makeStorage([
      `private/companies/${companyA}/document.pdf`,
      `private/companies/${companyA}/never-referenced.pdf`,
      `private/companies/${companyB}/shared.pdf`,
      'private/uploads/generic-upload-id',
      'public/site/logo.png',
    ]);
    const companyReferences = [
      ref(`/objects/companies/${companyA}/document.pdf`),
      ref(`/objects/companies/${companyA}/missing.pdf`, 'documents.archivedPath'),
      ref(`/objects/companies/${companyB}/shared.pdf`, 'documents.sharedPath'),
    ];
    const otherCompanyReferences: OtherCompanyObjectReference[] = [
      {
        ...ref(`/objects/companies/${companyB}/shared.pdf`, 'documents.objectPath'),
        companyId: companyB,
      },
    ];

    const result = await inventoryCompanyOffboardingObjects(
      companyA,
      companyReferences,
      otherCompanyReferences,
      { service, client },
    );

    expect(getFiles).toHaveBeenCalledTimes(2);
    expect(getFiles.mock.calls.map(([options]) => options.prefix)).toEqual([
      'private/',
      'public/',
    ]);
    expect(result.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'referenced-by-company', generation: '17', sizeBytes: 456 }),
      expect.objectContaining({ kind: 'missing' }),
      expect.objectContaining({ kind: 'cross-company', otherCompanyIds: [companyB] }),
      expect.objectContaining({ kind: 'tenant-prefix-orphan' }),
      expect.objectContaining({ kind: 'ambiguous-generic-upload-orphan' }),
      expect.objectContaining({ kind: 'ambiguous-generic-upload-orphan', path: `/${bucketName}/public/site/logo.png` }),
    ]));
    expect(result.verifiedObjects).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.blockers.map(({ code }) => code)).toContain('shared-reference');
    expect(result.blockers.map(({ code }) => code)).toContain('unowned-generic-upload');
  });

  it('blocks path traversal and duplicate references without treating them as ownership evidence', async () => {
    const { client, service } = makeStorage([
      `private/companies/${companyA}/document.pdf`,
    ]);
    const result = await inventoryCompanyOffboardingObjects(
      companyA,
      [
        ref(`/objects/companies/${companyA}/document.pdf`),
        ref(`/objects/companies/${companyA}/document.pdf`, 'otherTable.objectPath'),
        ref('/objects/../companies/secret.pdf'),
        ref('https://storage.googleapis.com/unconfigured-bucket/file.pdf'),
      ],
      [],
      { service, client },
    );

    expect(result.blockers.map(({ code }) => code)).toContain('duplicate-reference');
    expect(result.blockers.filter(({ code }) => code === 'unrecognized-object-path')).toHaveLength(2);
    expect(result.verifiedObjects).toHaveLength(1);
    expect(result.complete).toBe(false);
  });
});