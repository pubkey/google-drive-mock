import { describe, expect, beforeAll, afterAll } from 'vitest';
import { it } from './config';
import { getTestConfig, TestConfig } from './config';

describe('Batch and Complex Query Operations', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(async () => {
        if (config) config.stop();
    });

    it('should perform bulk insert, find, and update operations using batch and complex queries', async () => {
        const docs = [
            { id: 'bulk1', content: '{"foo":1}' },
            { id: 'bulk2', content: '{"bar":2}' }
        ];
        const boundary = "batch_" + Math.random().toString(16).slice(2);
        const targetFolderId = config.testFolderId;

        const parts = docs.map((doc, i) => {
            const id = doc.id;
            const body = JSON.stringify({
                name: id + '.json',
                mimeType: 'application/json',
                parents: [targetFolderId],
            });

            return (
                `--${boundary}\r\n` +
                `Content-Type: application/http\r\n` +
                `Content-ID: <item-${i}>\r\n\r\n` +
                `POST /drive/v3/files HTTP/1.1\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${body}\r\n`
            );
        });

        const batchBody = parts.join("") + `--${boundary}--`;
        const url = config.baseUrl + "/batch/drive/v3";
        console.log('Sending batch insert request to:', url);

        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.token}`,
                "Content-Type": `multipart/mixed; boundary=${boundary}`,
            },
            body: batchBody,
        });

        expect(res.status).toBe(200);

        const contentType = res.headers.get('content-type');
        expect(contentType).toContain('multipart/mixed');

        const text = await res.text();
        console.log('Batch Insert Response:', text);
        expect(text).toContain('HTTP/1.1 200 OK');

        // Extract IDs for later use
        const listRes = await fetch(config.baseUrl + `/drive/v3/files?q='${targetFolderId}'+in+parents`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const listData = await listRes.json();
        const files = listData.files.filter((f: { name: string; id: string }) => f.name === 'bulk1.json' || f.name === 'bulk2.json');
        expect(files.length).toBe(2);

        // 2. Perform bulk find using complex query
        const docIds = ['bulk1', 'bulk2'];
        const fileNames = docIds.map(id => id + '.json');
        let q = fileNames
            .map(name => `name = '${name.replace("'", "\\'")}'`)
            .join(' or ');
        q += ' and trashed = false';
        q += ' and \'' + config.testFolderId + '\' in parents';

        console.log('Bulk Find Query:', q);

        const params = new URLSearchParams({
            q,
            fields: "nextPageToken, files(id,name,mimeType,parents,modifiedTime,size)",
            includeItemsFromAllDrives: "true",
            supportsAllDrives: "true",
        });
        const findUrl = config.baseUrl + '/drive/v3/files?' + params.toString();
        const findRes = await fetch(findUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${config.token}`,
            },
        });

        expect(findRes.status).toBe(200);
        const findData = await findRes.json();

        expect(findData.files).toBeDefined();
        const foundNames = findData.files.map((f: { name: string }) => f.name);
        expect(foundNames).toContain('bulk1.json');
        expect(foundNames).toContain('bulk2.json');
        expect(findData.files.length).toBeGreaterThanOrEqual(2);

        // 3. Perform bulk update using batch API
        interface DocUpdate {
            id: string;
            newName: string;
        }
        const docUpdates: DocUpdate[] = [
            { id: 'bulk1', newName: 'bulk1_updated' },
            { id: 'bulk2', newName: 'bulk2_updated' }
        ];

        const fileIdByDocId: Record<string, string> = {};
        for (const f of findData.files) {
            if (f.name === 'bulk1.json') fileIdByDocId['bulk1'] = f.id;
            if (f.name === 'bulk2.json') fileIdByDocId['bulk2'] = f.id;
        }

        const updateBoundary = "batch_" + Math.random().toString(16).slice(2);

        const updateParts = docUpdates.map((doc, i) => {
            const id = doc.id;
            const fileId = fileIdByDocId[id];
            if (!fileId) throw new Error(`File ID not found for ${id}`);

            const body = JSON.stringify({
                name: doc.newName + '.json',
                mimeType: "application/json",
            });

            return (
                `--${updateBoundary}\r\n` +
                `Content-Type: application/http\r\n` +
                `Content-ID: <item-${i}>\r\n\r\n` +
                `PATCH /drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,parents HTTP/1.1\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${body}\r\n`
            );
        });

        const updateBatchBody = updateParts.join("") + `--${updateBoundary}--`;
        const updateUrl = config.baseUrl + "/batch/drive/v3";
        console.log('Sending batch update request to:', updateUrl);

        const updateRes = await fetch(updateUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.token}`,
                "Content-Type": `multipart/mixed; boundary=${updateBoundary}`,
            },
            body: updateBatchBody,
        });

        expect(updateRes.status).toBe(200);
        const updateText = await updateRes.text();
        console.log('Batch Update Response:', updateText);
        expect(updateText).toContain('HTTP/1.1 200 OK');

        // Verify updates
        const verifyRes = await fetch(config.baseUrl + `/drive/v3/files?q='${config.testFolderId}'+in+parents`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const verifyData = await verifyRes.json();
        const names = verifyData.files.map((f: { name: string }) => f.name);
        expect(names).toContain('bulk1_updated.json');
        expect(names).toContain('bulk2_updated.json');
        expect(names).not.toContain('bulk1.json');
    });
});
