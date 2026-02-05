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
        // Create 2 files
        await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Change 1' })
        });
        await fetch(`${BASE_URL}/drive/v2/files`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Change 2' })
        });

        const changesRes = await fetch(`${BASE_URL}/drive/v2/changes`, {
            headers: { 'Authorization': 'Bearer valid-token' }
        });
        assert.strictEqual(changesRes.status, 200);
        const changesData = await changesRes.json();

        assert.strictEqual(changesData.kind, 'drive#changeList');
        assert.ok(changesData.items.length >= 2);
        assert.ok(changesData.items[0].file);
    });
});
