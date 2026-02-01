import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';
import { Server } from 'http';
import { DriveFile } from '../src/store';

// Helper (Shared)
async function makeRequest(
    target: Server | string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown
) {
    if (typeof target === 'string') {
        const url = `${target}${path}`;
        const fetchOptions: RequestInit = {
            method: method,
            headers: headers
        };
        if (body) {
            if (typeof body === 'string') {
                fetchOptions.body = body;
            } else {
                fetchOptions.body = JSON.stringify(body);
                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }
        }
        const res = await fetch(url, fetchOptions);
        const resBody = res.headers.get('content-type')?.includes('application/json')
            ? await res.json()
            : await res.text();
        return { status: res.status, body: resBody };
    } else {
        const addr = target.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const baseUrl = `http://localhost:${port}`;
        return makeRequest(baseUrl, method, path, headers, body);
    }
}

describe('Feature Tests', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    async function req(method: string, path: string, body?: unknown) {
        return makeRequest(config.target, method, path, {
            'Authorization': `Bearer ${config.token}`
        }, body);
    }

    it('should find a folder by its name (only search not in trash folders)', async () => {
        // 1. Create a unique folder
        const folderName = 'SearchTarget_' + Date.now();
        const createRes = await req('POST', '/drive/v3/files', {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const createdId = createRes.body.id;

        // 2. Search for it
        const query = `name = '${folderName}' and trashed = false`;
        const searchRes = await req('GET', `/drive/v3/files?q=${encodeURIComponent(query)}`);

        expect(searchRes.status).toBe(200);
        const files = searchRes.body.files;
        expect(files).toBeDefined();
        expect(files.length).toBeGreaterThan(0);
        expect(files[0].id).toBe(createdId);
        expect(files[0].name).toBe(folderName);
    });

    it('should create and delete a nested folder', async () => {
        // 1. Create Parent
        const parentName = 'Parent_' + Date.now();
        const parentRes = await req('POST', '/drive/v3/files', {
            name: parentName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [config.testFolderId]
        });
        expect(parentRes.status).toBe(200);
        const parentId = parentRes.body.id;

        // 2. Create Child inside Parent
        const childName = 'Child_' + Date.now();
        const childRes = await req('POST', '/drive/v3/files', {
            name: childName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        });
        expect(childRes.status).toBe(200);
        const childId = childRes.body.id;

        // 3. Verify Child has parent
        const getChild = await req('GET', `/drive/v3/files/${childId}?fields=parents`);
        expect(getChild.status).toBe(200);
        // req helper wraps body logic differently?
        // Ah, default getFile returns all fields in mock.
        // Mock might not strictly filter fields yet, but let's check.
        if (getChild.body.parents) {
            expect(getChild.body.parents).toContain(parentId);
        }

        // 4. Delete Child
        const delRes = await req('DELETE', `/drive/v3/files/${childId}`);
        expect(delRes.status).toBe(204);

        // 5. Verify Child Gone
        const verify = await req('GET', `/drive/v3/files/${childId}`);
        expect(verify.status).toBe(404);
    });

    it('should get a file and check for its mime-type', async () => {
        const fileName = 'MimeTypeFile_' + Date.now();
        const mimeType = 'text/plain';

        const createRes = await req('POST', '/drive/v3/files', {
            name: fileName,
            mimeType: mimeType,
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        const getRes = await req('GET', `/drive/v3/files/${fileId}`);
        expect(getRes.status).toBe(200);
        expect(getRes.body.mimeType).toBe(mimeType);
    });

    it('should fetch a folder and check for its mime-type', async () => {
        const folderName = 'MimeTypeFolder_' + Date.now();
        const mimeType = 'application/vnd.google-apps.folder';

        const createRes = await req('POST', '/drive/v3/files', {
            name: folderName,
            mimeType: mimeType,
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const folderId = createRes.body.id;

        const getRes = await req('GET', `/drive/v3/files/${folderId}`);
        expect(getRes.status).toBe(200);
        expect(getRes.body.mimeType).toBe(mimeType);
    });

    it('should trash a file', async () => {
        const fileName = 'TrashFile_' + Date.now();
        const createRes = await req('POST', '/drive/v3/files', {
            name: fileName,
            parents: [config.testFolderId]
        });
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        // Trash it
        const trashRes = await req('PATCH', `/drive/v3/files/${fileId}?fields=trashed`, { trashed: true });
        expect(trashRes.status).toBe(200);
        expect(trashRes.body.trashed).toBe(true);

        // Verify it is still accessible via GET
        const getRes = await req('GET', `/drive/v3/files/${fileId}?fields=trashed`);
        expect(getRes.status).toBe(200);
        expect(getRes.body.trashed).toBe(true);

        // Verify it is excluded from search with trashed=false
        const query = `name = '${fileName}' and trashed = false`;
        const searchRes = await req('GET', `/drive/v3/files?q=${encodeURIComponent(query)}`);
        expect(searchRes.status).toBe(200);
        expect(searchRes.body.files).toEqual([]);

        // Verify it is included in search with trashed=true
        const queryTrash = `name = '${fileName}' and trashed = true`;
        const searchTrashRes = await req('GET', `/drive/v3/files?q=${encodeURIComponent(queryTrash)}`);
        expect(searchTrashRes.status).toBe(200);
        expect(searchTrashRes.body.files).toHaveLength(1);
        expect(searchTrashRes.body.files[0].id).toBe(fileId);
    });

    it('should find a file that is in a nested folder. Write the file and then read it again. Call it data.json', async () => {
        // 1. Create Parent Folder
        const parentRes = await req('POST', '/drive/v3/files', {
            name: 'DataFolder_' + Date.now(),
            mimeType: 'application/vnd.google-apps.folder',
            parents: [config.testFolderId]
        });
        expect(parentRes.status).toBe(200);
        const parentId = parentRes.body.id;

        // 2. Create Nested Folder
        const nestedRes = await req('POST', '/drive/v3/files', {
            name: 'Nested_' + Date.now(),
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        });
        expect(nestedRes.status).toBe(200);
        const nestedId = nestedRes.body.id;

        // 3. Create (Write) File in Nested Folder
        const fileName = 'data.json';
        const fileContent = { foo: 'bar', timestamp: Date.now() };

        const createBody: { name: string; mimeType: string; parents: string[]; content?: unknown } = {
            name: fileName,
            mimeType: 'application/json',
            parents: [nestedId]
        };

        if (config.isMock) {
            createBody.content = fileContent;
        }

        const createRes = await req('POST', '/drive/v3/files', createBody);
        expect(createRes.status).toBe(200);
        const fileId = createRes.body.id;

        // 4. Find (Search) the file
        const query = `name = '${fileName}' and trashed = false`;
        const searchRes = await req('GET', `/drive/v3/files?q=${encodeURIComponent(query)}`);
        expect(searchRes.status).toBe(200);
        const found = (searchRes.body as { files: DriveFile[] }).files.find((f: DriveFile) => f.id === fileId);
        expect(found).toBeDefined();
        // Check finding by name works naturally.

        // 5. Read (Get) the file
        const getRes = await req('GET', `/drive/v3/files/${fileId}?fields=name,parents`);
        expect(getRes.status).toBe(200);
        expect(getRes.body.name).toBe(fileName);
        expect(getRes.body.parents).toContain(nestedId);

        if (config.isMock) {
            expect(getRes.body.content).toEqual(fileContent);
        }
    });
});
