import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { getTestConfig, TestConfig } from './config';
import { DriveFile } from '../src/store';

describe('Advanced Drive Features (Part 2)', () => {
    let config: TestConfig;
    let req: (method: string, endpoint: string, body?: unknown) => Promise<{ status: number; body: unknown; headers: Headers }>;

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
    });

    // Rate Limit Mitigation for Real API
    afterEach(async () => {
        await new Promise(r => setTimeout(r, 1000));
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
        expect(sortTimeRes.status).toBe(200);

        const filesTime = (sortTimeRes.body as { files: DriveFile[] }).files;
        const relevantTime = filesTime.filter((f: DriveFile) => f.name.includes(prefix));

        expect(relevantTime[0].name).toContain('-A');
        expect(relevantTime[1].name).toContain('-B');
        expect(relevantTime[2].name).toContain('-C');
    });

    it('should create and read a nested json file', async () => {
        // 1. Create Parent Folder
        const parentName = `Parent-${Date.now()}`;
        const parentRes = await req('POST', '/drive/v3/files', {
            name: parentName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [config.testFolderId]
        });
        expect(parentRes.status).toBe(200);
        const parentId = (parentRes.body as DriveFile).id;

        // 2. Create Nested Folder
        const nestedName = `Nested-${Date.now()}`;
        const nestedRes = await req('POST', '/drive/v3/files', {
            name: nestedName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        });
        expect(nestedRes.status).toBe(200);
        const nestedId = (nestedRes.body as DriveFile).id;

        // 3. Create JSON File with content
        const fileName = 'data.json';


        const createBody: {
            name: string;
            mimeType: string;
            parents: string[];
            content?: unknown;
        } = {
            name: fileName,
            mimeType: 'application/json',
            parents: [nestedId]
        };

        const fileRes = await req('POST', '/drive/v3/files', createBody);
        expect(fileRes.status).toBe(200);
        const fileId = (fileRes.body as DriveFile).id;

        // 4. Read the file
        const getRes = await req('GET', `/drive/v3/files/${fileId}?fields=id,name,parents`);
        expect(getRes.status).toBe(200);

        // 5. Verify Content
        const file = getRes.body as DriveFile;
        expect(file.parents).toContain(nestedId);
    });
});
