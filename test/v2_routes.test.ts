import { startServer } from '../src/index';
import { driveStore } from '../src/store';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'assert';
import { Server } from 'http';

const TEST_PORT = 3303; // distinct port
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Google Drive V2 Routes', () => {
    let server: Server;

    beforeAll(async () => {
        server = await startServer(TEST_PORT);
    });

    afterAll(async () => {
        server.close();
    });

    beforeEach(async () => {
        driveStore.clear();
        await fetch(`${BASE_URL}/debug/clear`, { method: 'POST' });
    });

    // Helper to create a file
    async function createFile(name: string, mimeType: string = 'text/plain') {
        const res = await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer valid-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: name, mimeType })
        });
        return res.json();
    }

    it('should list files (V2)', async () => {
        // Create a file first via V2
        const createRes = await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer valid-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: 'Test File List', mimeType: 'text/plain' })
        });
        assert.strictEqual(createRes.status, 200);

        const listRes = await fetch(`${BASE_URL}/drive/v2/files`, {
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(listRes.status, 200);
        const listData = await listRes.json();
        assert.strictEqual(listData.kind, 'drive#fileList');
        assert.ok(Array.isArray(listData.items));
        assert.strictEqual(listData.items.length, 1);
        assert.strictEqual(listData.items[0].title, 'Test File List');
    });

    it('should get about info (V2)', async () => {
        const res = await fetch(`${BASE_URL}/drive/v2/about`, {
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.kind, 'drive#about');
        assert.ok(data.user);
        assert.strictEqual(data.user.displayName, 'Mock User');
    });

    it('should upload file via multipart (V2)', async () => {
        const metadata = { title: 'Multipart Upload', mimeType: 'application/json' };
        const content = { foo: 'bar' };

        const boundary = 'foo_bar_baz';
        const body = `
--${boundary}
Content-Type: application/json; charset=UTF-8

${JSON.stringify(metadata)}
--${boundary}
Content-Type: application/json

${JSON.stringify(content)}
--${boundary}--`;

        const res = await fetch(`${BASE_URL}/upload/drive/v2/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer valid-token',
                'Content-Type': `multipart/related; boundary="${boundary}"`
            },
            body: body
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.title, 'Multipart Upload');

        // Verify content matches by fetching via ID with alt=media
        const contentRes = await fetch(`${BASE_URL}/drive/v2/files/${data.id}?alt=media`, {
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(contentRes.status, 200);

        // Content-Type might be set? Mock currently doesn't strictly set it based on file.mimeType for download.
        // But body should be the content.
        const contentBody = await contentRes.json();
        assert.deepStrictEqual(contentBody, content);
    });

    it('should trash file (V2)', async () => {
        const createRes = await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'To Trash' })
        });
        const file = await createRes.json();
        const fileId = file.id;

        const trashRes = await fetch(`${BASE_URL}/drive/v2/files/${fileId}/trash`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(trashRes.status, 200);
        const trashedFile = await trashRes.json();
        assert.strictEqual(trashedFile.labels.trashed, true);

        // Verify in list
        const fileInStore = driveStore.getFile(fileId);
        assert.strictEqual(fileInStore?.trashed, true);
    });

    it('should copy file (V2)', async () => {
        const createRes = await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'To Copy' })
        });
        const file = await createRes.json();

        const copyRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/copy`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Copied File' })
        });

        assert.strictEqual(copyRes.status, 200);
        const copied = await copyRes.json();
        assert.strictEqual(copied.title, 'Copied File');
        assert.notStrictEqual(copied.id, file.id);
    });

    it('should touch file (V2)', async () => {
        const createRes = await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'To Touch' })
        });
        const file = await createRes.json();
        const oldModTime = file.modifiedDate;

        // Wait a bit to ensure time difference
        await new Promise(r => setTimeout(r, 10));

        const touchRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/touch`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(touchRes.status, 200);
        const touched = await touchRes.json();
        assert.notStrictEqual(touched.modifiedDate, oldModTime);
    });

    it('should list changes (V2)', async () => {
        await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Change Trigger' })
        });

        const res = await fetch(`${BASE_URL}/drive/v2/changes`, {
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.items.length > 0);
    });

    it('should untrash file (V2)', async () => {
        const file = await createFile('Untrash Me');
        // Trash it
        await fetch(`${BASE_URL}/drive/v2/files/${file.id}/trash`, { method: 'POST', headers: { 'Authorization': 'Bearer valid-token' } });

        // Untrash it
        const res = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/untrash`, { method: 'POST', headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(res.status, 200);
        const updated = await res.json();
        assert.strictEqual(updated.labels.trashed, false);
    });

    it('should empty trash (V2)', async () => {
        const file1 = await createFile('Trash 1');
        const file2 = await createFile('Trash 2');
        await fetch(`${BASE_URL}/drive/v2/files/${file1.id}/trash`, { method: 'POST', headers: { 'Authorization': 'Bearer valid-token' } });
        await fetch(`${BASE_URL}/drive/v2/files/${file2.id}/trash`, { method: 'POST', headers: { 'Authorization': 'Bearer valid-token' } });

        const res = await fetch(`${BASE_URL}/drive/v2/files/trash`, { method: 'DELETE', headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(res.status, 204);

        const check1 = driveStore.getFile(file1.id);
        const check2 = driveStore.getFile(file2.id);
        assert.strictEqual(check1, null);
        assert.strictEqual(check2, null);
    });

    it('should get start page token (V2)', async () => {
        const res = await fetch(`${BASE_URL}/drive/v2/changes/startPageToken`, { headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.kind, 'drive#startPageToken');
        assert.ok(data.startPageToken);
    });

    it('should manage parents (V2)', async () => {
        const file = await createFile('Child File');
        const folder = await createFile('Parent Folder', 'application/vnd.google-apps.folder');

        // Insert Parent
        const insertRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/parents`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: folder.id })
        });
        assert.strictEqual(insertRes.status, 200);
        const parentRef = await insertRes.json();
        assert.strictEqual(parentRef.id, folder.id);

        // List Parents
        const listRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/parents`, { headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(listRes.status, 200);
        const listData = await listRes.json();
        assert.ok(listData.items.some((p: { id: string }) => p.id === folder.id));

        // Get Parent
        const getRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/parents/${folder.id}`, { headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(getRes.status, 200);

        // Delete Parent
        const delRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/parents/${folder.id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(delRes.status, 204);

        // Verify Deletion
        const checkRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/parents/${folder.id}`, { headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(checkRes.status, 404);
    });

    it('should get revisions (V2)', async () => {
        const file = await createFile('Revision File');

        // List Revisions
        const listRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/revisions`, { headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(listRes.status, 200);
        const listData = await listRes.json();
        assert.strictEqual(listData.items[0].id, 'head');

        // Get Revision
        const getRes = await fetch(`${BASE_URL}/drive/v2/files/${file.id}/revisions/head`, { headers: { 'Authorization': 'Bearer valid-token' } });
        assert.strictEqual(getRes.status, 200);
        const revData = await getRes.json();
        assert.strictEqual(revData.id, 'head');
    });
});
