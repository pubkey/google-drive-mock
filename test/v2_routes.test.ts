import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Google Drive V2 Routes', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(async () => {
        if (config) config.stop();
    });

    function getBaseUrl() {
        if (typeof config.target === 'string') {
            return config.target;
        } else {
            const addr = config.target.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            return `http://localhost:${port}`;
        }
    }

    // Helper to request
    async function req(method: string, path: string, body?: unknown) {
        const baseUrl = getBaseUrl();
        const url = `${baseUrl}${path}`;
        const fetchOptions: RequestInit = {
            method: method,
            headers: {
                'Authorization': `Bearer ${config.token}`
            }
        };

        if (body) {
            fetchOptions.body = JSON.stringify(body);
            fetchOptions.headers = {
                ...fetchOptions.headers,
                'Content-Type': 'application/json'
            };
        }

        const res = await fetch(url, fetchOptions);
        return res;
    }

    // Helper to create a file
    async function createFile(name: string, mimeType: string = 'text/plain') {
        const res = await req('POST', '/drive/v2/files', { title: name, mimeType });
        return res.json();
    }

    it('should list files (V2)', async () => {
        const title = 'Test File List ' + Math.random().toString(36).substring(7);
        const createRes = await req('POST', '/drive/v2/files', { title, mimeType: 'text/plain' });
        expect(createRes.status).toBe(200);

        const listRes = await req('GET', '/drive/v2/files');
        expect(listRes.status).toBe(200);
        const listData = await listRes.json();

        expect(listData.items).toBeDefined();
        expect(Array.isArray(listData.items)).toBe(true);
        expect(listData.items.length).toBeGreaterThan(0);
        expect(listData.items.find((f: { title: string }) => f.title === title)).toBeDefined();
    });

    it('should get about info (V2)', async () => {
        const res = await req('GET', '/drive/v2/about');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.kind).toBe('drive#about');
        expect(data.user).toBeDefined();
        expect(data.quotaBytesTotal).toBeDefined();
    });

    it('should upload file via multipart (V2)', async () => {
        const title = 'Multipart V2 ' + Math.random().toString(36).substring(7);
        const metadata = { title, mimeType: 'text/plain' };
        const content = { foo: 'bar' };

        const boundary = '-------314159265358979323846';
        const delimiter = '\r\n--' + boundary + '\r\n';
        const closeDelim = '\r\n--' + boundary + '--';

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(content) +
            closeDelim;

        const baseUrl = getBaseUrl();
        const url = `${baseUrl}/upload/drive/v2/files?uploadType=multipart`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + config.token,
                'Content-Type': 'multipart/related; boundary="' + boundary + '"'
            },
            body: body
        });

        expect(res.status).toBe(200);
        const file = await res.json();
        expect(file.title).toBe(title);
    });

    it('should trash file (V2)', async () => {
        const title = 'Trash Me ' + Math.random().toString(36).substring(7);
        const file = await createFile(title);
        const trashRes = await req('POST', `/drive/v2/files/${file.id}/trash`);
        expect(trashRes.status).toBe(200);
        const trashedFile = await trashRes.json();
        expect(trashedFile.labels.trashed).toBe(true);
    });

    it('should copy file (V2)', async () => {
        const title = 'Copy Me ' + Math.random().toString(36).substring(7);
        const copyTitle = 'Copied File ' + Math.random().toString(36).substring(7);
        const file = await createFile(title);
        const copyRes = await req('POST', `/drive/v2/files/${file.id}/copy`, { title: copyTitle });
        expect(copyRes.status).toBe(200);
        const copiedFile = await copyRes.json();
        expect(copiedFile.title).toBe(copyTitle);
        expect(copiedFile.id).not.toBe(file.id);
    });

    it('should touch file (V2)', async () => {
        const title = 'Touch Me ' + Math.random().toString(36).substring(7);
        const file = await createFile(title);
        const touchRes = await req('POST', `/drive/v2/files/${file.id}/touch`);
        expect(touchRes.status).toBe(200);
        const touchedFile = await touchRes.json();
        expect(new Date(touchedFile.modifiedDate).getTime()).toBeGreaterThanOrEqual(new Date(file.modifiedDate).getTime());
    });

    it('should list changes (V2)', async () => {
        const title = 'Change Me ' + Math.random().toString(36).substring(7);
        await createFile(title);
        const changesRes = await req('GET', '/drive/v2/changes');
        expect(changesRes.status).toBe(200);
        const changesData = await changesRes.json();
        expect(changesData.items.length).toBeGreaterThan(0);
        expect(changesData.kind).toBe('drive#changeList');
    });

    it('should untrash file (V2)', async () => {
        const title = 'Untrash Me ' + Math.random().toString(36).substring(7);
        const file = await createFile(title);
        await req('POST', `/drive/v2/files/${file.id}/trash`);

        const untrashRes = await req('POST', `/drive/v2/files/${file.id}/untrash`);
        expect(untrashRes.status).toBe(200);
        const untrashedFile = await untrashRes.json();
        expect(untrashedFile.labels.trashed).toBe(false);
    });

    it('should empty trash (V2)', async () => {
        const title1 = 'Trash 1 ' + Math.random().toString(36).substring(7);
        const title2 = 'Trash 2 ' + Math.random().toString(36).substring(7);
        const file1 = await createFile(title1);
        const file2 = await createFile(title2);
        await req('POST', `/drive/v2/files/${file1.id}/trash`);
        await req('POST', `/drive/v2/files/${file2.id}/trash`);

        const emptyRes = await req('DELETE', '/drive/v2/files/trash');
        expect(emptyRes.status).toBe(204);

        // Verify files are gone - eventually consistent
        const verifyDeleted = async (fileId: string) => {
            let deleted = false;
            // Retry for up to 10 seconds
            const maxRetries = 20;
            for (let i = 0; i < maxRetries; i++) {
                const res = await req('GET', `/drive/v2/files/${fileId}`);
                if (res.status === 404) {
                    deleted = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }
            return deleted;
        };

        const deleted1 = await verifyDeleted(file1.id);
        const deleted2 = await verifyDeleted(file2.id);

        expect(deleted1).toBe(true);
        expect(deleted2).toBe(true);
    }, 15000);

    it('should get start page token (V2)', async () => {
        const res = await req('GET', '/drive/v2/changes/startPageToken');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.startPageToken).toBeDefined();
        expect(data.kind).toBe('drive#startPageToken');
    });

    it('should manage parents (V2)', async () => {
        // Create folder
        const folderTitle = 'Parent Folder ' + Math.random().toString(36).substring(7);
        const childTitle = 'Child File ' + Math.random().toString(36).substring(7);
        const folder = await createFile(folderTitle, 'application/vnd.google-apps.folder');
        const file = await createFile(childTitle);

        // Insert parent
        const insertRes = await req('POST', `/drive/v2/files/${file.id}/parents`, { id: folder.id });
        expect(insertRes.status).toBe(200);

        // List parents
        const listRes = await req('GET', `/drive/v2/files/${file.id}/parents`);
        expect(listRes.status).toBe(200);
        const listData = await listRes.json();
        expect(listData.items.some((p: { id: string }) => p.id === folder.id)).toBe(true);

        // Get specific parent
        const getParentRes = await req('GET', `/drive/v2/files/${file.id}/parents/${folder.id}`);
        expect(getParentRes.status).toBe(200);

        // Delete parent
        const deleteRes = await req('DELETE', `/drive/v2/files/${file.id}/parents/${folder.id}`);
        expect(deleteRes.status).toBe(204);

        // Verify deleted
        const checkRes = await req('GET', `/drive/v2/files/${file.id}/parents/${folder.id}`);
        expect(checkRes.status).toBe(404);
    });

    it('should get revisions (V2)', async () => {
        const title = 'Revision File ' + Math.random().toString(36).substring(7);
        const file = await createFile(title);
        const listRes = await req('GET', `/drive/v2/files/${file.id}/revisions`);
        expect(listRes.status).toBe(200);
        const listData = await listRes.json();
        // expect(listData.items.length).toBe(1); // Real API might show multiple if new? Usually 1 for new file.
        expect(listData.items.length).toBeGreaterThan(0);
        const revId = listData.items[0].id;
        expect(revId).toBeDefined();

        const getRes = await req('GET', `/drive/v2/files/${file.id}/revisions/${revId}`);
        expect(getRes.status).toBe(200);
        const revision = await getRes.json();
        expect(revision.id).toBe(revId);
    });

});
