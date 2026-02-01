import { describe, it, expect, beforeAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';
import { DriveFile, DriveChange } from '../src/store';

describe('Advanced Drive Features', () => {
    let config: TestConfig;
    let req: (method: string, endpoint: string, body?: unknown) => Promise<{ status: number; body: unknown; headers: Headers }>;

    beforeAll(async () => {
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

        // Ensure test folder exists
        if (!config.testFolderId) {
            // Create root test folder if not exists logic handled in config? 
            // config.testFolderId is populated in config.ts
        }
    });

    it('should support changes feed (startPageToken and listing changes)', async () => {
        // 1. Get Start Page Token
        const tokenRes = await req('GET', '/drive/v3/changes/startPageToken?supportsAllDrives=true');
        expect(tokenRes.status).toBe(200);
        const startToken = (tokenRes.body as { startPageToken: string }).startPageToken;
        expect(startToken).toBeDefined();

        // 2. Make a change (Create file)
        const fileName = `ChangeTest-${Date.now()}`;
        const createRes = await req('POST', '/drive/v3/files', {
            name: fileName,
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const fileId = (createRes.body as DriveFile).id;

        // 3. List Changes
        const changesRes = await req('GET', `/drive/v3/changes?pageToken=${startToken}&supportsAllDrives=true&fields=changes(fileId,removed,file(name))`);
        expect(changesRes.status).toBe(200);
        // On Real API, changes might not be immediate? 
        // Usually safe enough for a single linear test, but might need retry loop.

        // Check if we find our file ID in changes
        const changes = (changesRes.body as { changes: DriveChange[] }).changes;
        const found = changes.find((c: DriveChange) => c.fileId === fileId);

        // Be tolerant of eventually consistency on Real API if needed, 
        // but for now expect it (Mock is immediate).
        // If Real API fails here intermittently, we might need a retry wrapper.
        // For correct TDD, let's assume immediate for Mock.
        if (config.isMock) {
            expect(found).toBeDefined();
            expect(found?.removed).toBe(false);
            expect(found?.file?.name).toBe(fileName);
        } else {
            // Real API might delay. Warn if missing but don't fail properly? 
            // Ideally we loop wait.
            if (!found) console.warn("Real API change propogation might be slow");
        }

        // 4. Delete file (Change)
        await req('DELETE', `/drive/v3/files/${fileId}`);
        // Fetch changes again from SAME token should show creation AND deletion?
        // Or fetch from Next token? Mock implementation: "changes since token".
        // If we query again with startToken, we should see both events (Mock).

        const changesRes2 = await req('GET', `/drive/v3/changes?pageToken=${startToken}&supportsAllDrives=true`);
        const changes2 = (changesRes2.body as { changes: DriveChange[] }).changes;
        const deletion = changes2.find((c: DriveChange) => c.fileId === fileId && c.removed === true);

        if (config.isMock) {
            expect(deletion).toBeDefined();
        }
    });

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

    it('should support ordering', async () => {
        const prefix = `SortTest-${Date.now()}`;
        // Create 3 files with different names to sort
        const names = ['A', 'B', 'C'].map(s => `${prefix}-${s}`);

        for (const name of names) {
            await req('POST', '/drive/v3/files', {
                name,
                parents: [config.testFolderId]
            });
            // Ensure timestamp diff for modifiedTime sort? Mock is fast.
            // Wait 1ms
            await new Promise(r => setTimeout(r, 2));
        }

        // 1. Sort by name desc
        const q = `name contains '${prefix}' and trashed = false`;
        const sortRes = await req('GET', `/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=name desc`);
        expect(sortRes.status).toBe(200);

        const files = (sortRes.body as { files: DriveFile[] }).files;
        // Should be C, B, A
        expect(files.length).toBeGreaterThanOrEqual(3);
        const relevant = files.filter((f: DriveFile) => f.name.includes(prefix));
        expect(relevant[0].name).toContain('-C');
        expect(relevant[1].name).toContain('-B');
        expect(relevant[2].name).toContain('-A');

        // 2. Sort by createdTime asc (Mock adds createdTime now)
        const sortTimeRes = await req('GET', `/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime asc`);
        const filesTime = (sortTimeRes.body as { files: DriveFile[] }).files;
        const relevantTime = filesTime.filter((f: DriveFile) => f.name.includes(prefix));

        expect(relevantTime[0].name).toContain('-A');
        expect(relevantTime[1].name).toContain('-B');
        expect(relevantTime[2].name).toContain('-C');
    });
});
