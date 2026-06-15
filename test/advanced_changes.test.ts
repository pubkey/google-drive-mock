import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { getTestConfig, TestConfig } from './config';
import { DriveFile, DriveChange } from '../src/store';

describe('Advanced Drive Features (Part 1)', () => {
    let config: TestConfig;
    let req: (method: string, endpoint: string, body?: unknown) => Promise<{ status: number; body: unknown; headers: Headers }>;
    let fileIdToDeleteLater: string;

    beforeAll(async () => {
        vi.setConfig({ testTimeout: 60000 });
        config = await getTestConfig();
        req = async (method: string, endpoint: string, body?: unknown) => {
            const url = `${config.baseUrl}${endpoint}`;
            const options: RequestInit = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.token}`
                }
            };
            if (body) {
                options.body = JSON.stringify(body);
            }
            const res = await fetch(url, options);
            const text = await res.text();
            try {
                return { status: res.status, body: JSON.parse(text), headers: res.headers };
            } catch {
                return { status: res.status, body: text, headers: res.headers };
            }
        };

        if (!config.testFolderId) {
            // ensure folder
        }

        // Pre-create a file to be deleted later in the deletion test
        const createRes = await req('POST', '/drive/v3/files', {
            name: `ChangeTest-DeletePrep-${Date.now()}`,
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        fileIdToDeleteLater = (createRes.body as DriveFile).id;
    });

    // Rate Limit Mitigation for Real API
    afterEach(async () => {
        await new Promise(r => setTimeout(r, 1000));
    });

    it('should support changes feed: file creation change', async () => {
        // 1. Get Start Page Token
        const tokenRes = await req('GET', '/drive/v3/changes/startPageToken?supportsAllDrives=true');
        expect(tokenRes.status).toBe(200);
        const startToken = (tokenRes.body as { startPageToken: string }).startPageToken;
        expect(startToken).toBeDefined();

        // 2. Make a change (Create file)
        const fileName = `ChangeTest-Create-${Date.now()}`;
        const createRes = await req('POST', '/drive/v3/files', {
            name: fileName,
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const fileId = (createRes.body as DriveFile).id;

        // 3. List Changes (poll for creation)
        let found: DriveChange | undefined;
        const maxRetries = 25;
        const retryDelay = 300;

        for (let i = 0; i < maxRetries; i++) {
            const changesRes = await req('GET', `/drive/v3/changes?pageToken=${startToken}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=changes(fileId,removed,file(name))`);
            expect(changesRes.status).toBe(200);
            const changes = (changesRes.body as { changes: DriveChange[] }).changes || [];
            found = changes.find((c: DriveChange) => c.fileId === fileId);

            if (found) break;

            if (i < maxRetries - 1) {
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }

        expect(found).toBeDefined();
        if (found) {
            expect(found.removed).toBe(false);
            expect(found.file?.name).toBe(fileName);
        }

        // Clean up without waiting
        await req('DELETE', `/drive/v3/files/${fileId}`);
    }, 10000);

    it('should support changes feed: file deletion change', async () => {
        // 1. Get Start Page Token
        const tokenRes = await req('GET', '/drive/v3/changes/startPageToken?supportsAllDrives=true');
        expect(tokenRes.status).toBe(200);
        const startToken = (tokenRes.body as { startPageToken: string }).startPageToken;
        expect(startToken).toBeDefined();

        // 2. Delete the pre-created file
        await req('DELETE', `/drive/v3/files/${fileIdToDeleteLater}`);

        // 3. Poll changes feed for deletion
        let deletion: DriveChange | undefined;
        const maxRetries = 25;
        const retryDelay = 300;

        for (let i = 0; i < maxRetries; i++) {
            const changesRes2 = await req('GET', `/drive/v3/changes?pageToken=${startToken}&supportsAllDrives=true&includeItemsFromAllDrives=true`);
            expect(changesRes2.status).toBe(200);
            const changes2 = (changesRes2.body as { changes: DriveChange[] }).changes || [];
            deletion = changes2.find((c: DriveChange) => c.fileId === fileIdToDeleteLater && c.removed === true);

            if (deletion) break;

            if (i < maxRetries - 1) {
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }

        expect(deletion).toBeDefined();
        if (deletion) {
            expect(deletion.removed).toBe(true);
        }
    }, 10000);

    it('should support advanced query operators (contains, in parents)', async () => {
        const timestamp = Date.now();
        const folderName = `QueryFolder-${timestamp}`;
        const fileName = `UniqueFile-${timestamp}`;

        // Create Folder
        const folderRes = await req('POST', '/drive/v3/files', {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [config.testFolderId]
        });
        const folderId = (folderRes.body as DriveFile).id;

        // Create File in Folder
        const fileRes = await req('POST', '/drive/v3/files', {
            name: fileName,
            parents: [folderId]
        });
        const fileId = (fileRes.body as DriveFile).id;

        // Query: 'ID' in parents
        const qParents = `'${folderId}' in parents and trashed = false`;
        const searchParents = await req('GET', `/drive/v3/files?q=${encodeURIComponent(qParents)}`);
        expect(searchParents.status).toBe(200);
        const foundParent = (searchParents.body as { files: DriveFile[] }).files.find((f: DriveFile) => f.id === fileId);
        expect(foundParent).toBeDefined();

        // Query: name contains 'UniqueFile'
        const qContains = `name contains 'UniqueFile' and trashed = false`;
        const searchContains = await req('GET', `/drive/v3/files?q=${encodeURIComponent(qContains)}`);
        expect(searchContains.status).toBe(200);
        const foundContains = (searchContains.body as { files: DriveFile[] }).files.find((f: DriveFile) => f.id === fileId);
        expect(foundContains).toBeDefined();

        // Query: modifiedTime > ...
        // We just created the file, so it should be newer than 1 hour ago.
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const qTime = `modifiedTime > '${oneHourAgo}' and name = '${fileName}'`;
        const searchTime = await req('GET', `/drive/v3/files?q=${encodeURIComponent(qTime)}`);
        expect(searchTime.status).toBe(200);
        const foundTime = (searchTime.body as { files: DriveFile[] }).files.find((f: DriveFile) => f.id === fileId);
        expect(foundTime).toBeDefined();
    });
});
