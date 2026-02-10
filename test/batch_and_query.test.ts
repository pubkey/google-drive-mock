
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Batch and Complex Query Operations', () => {
    let config: TestConfig;
    let createdFileIds: string[] = [];

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(async () => {
        // Cleanup if needed
        if (config) config.stop();
    });

    it('should perform bulk insert using batch API', async () => {
        const docs = [
            { id: 'bulk1', content: '{"foo":1}' },
            { id: 'bulk2', content: '{"bar":2}' }
        ];
        const boundary = "batch_" + Math.random().toString(16).slice(2);

        // Ensure we have a valid folder ID. Using root or a test folder from config.
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

        // Verify operations succeeded
        expect(text).toContain('HTTP/1.1 200 OK');

        // Extract IDs for later use in update tests
        // This is a bit hacky parsing but sufficient for test
        // Responses are JSON inside multipart
        // We can list files to get IDs reliably
        const listRes = await fetch(config.baseUrl + `/drive/v3/files?q='${targetFolderId}'+in+parents`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const listData = await listRes.json();
        const files = listData.files.filter((f: { name: string; id: string }) => f.name === 'bulk1.json' || f.name === 'bulk2.json');
        expect(files.length).toBe(2);
        createdFileIds = files.map((f: { id: string }) => f.id);
    });

    it('should perform bulk find using complex query', async () => {
        // Ensure the files exist from previous test
        expect(createdFileIds.length).toBe(2);
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
        const url = config.baseUrl + '/drive/v3/files?' + params.toString();
        const res = await fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${config.token}`,
            },
        });

        expect(res.status).toBe(200);
        const data = await res.json();

        // Should find both files
        expect(data.files).toBeDefined();
        // Depending on query parsing logic, it might find one or both or none if logic is broken
        // The expectation is that this query works "like" finding specific files in a folder
        const foundNames = data.files.map((f: { name: string }) => f.name);
        expect(foundNames).toContain('bulk1.json');
        expect(foundNames).toContain('bulk2.json');
        expect(data.files.length).toBeGreaterThanOrEqual(2);
    });

    it('should perform bulk update using batch API', async () => {
        expect(createdFileIds.length).toBe(2);

        interface DocUpdate {
            id: string;
            newName: string;
        }
        const docs: DocUpdate[] = [
            { id: 'bulk1', newName: 'bulk1_updated' },
            { id: 'bulk2', newName: 'bulk2_updated' }
        ];

        // Map doc ID to file ID (assuming order or searching)
        // For simplicity, we'll fetch IDs again or use stored ones knowing names match
        // Let's assume createdFileIds corresponds to 'bulk1.json' and 'bulk2.json' somehow
        // But better to use exact mapping.

        // Re-fetch to be sure of mapping
        const listRes = await fetch(config.baseUrl + `/drive/v3/files?q='${config.testFolderId}'+in+parents`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const listData = await listRes.json();
        const fileIdByDocId: Record<string, string> = {};
        for (const f of listData.files) {
            if (f.name === 'bulk1.json') fileIdByDocId['bulk1'] = f.id;
            if (f.name === 'bulk2.json') fileIdByDocId['bulk2'] = f.id;
        }

        const boundary = "batch_" + Math.random().toString(16).slice(2);

        const parts = docs.map((doc, i) => {
            const id = doc.id;
            const fileId = fileIdByDocId[id];
            if (!fileId) throw new Error(`File ID not found for ${id}`);

            const body = JSON.stringify({
                name: doc.newName + '.json',
                mimeType: "application/json",
                // parents: [config.testFolderId], // Optional in update usually
            });

            return (
                `--${boundary}\r\n` +
                `Content-Type: application/http\r\n` +
                `Content-ID: <item-${i}>\r\n\r\n` +
                `PATCH /drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,parents HTTP/1.1\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${body}\r\n`
            );
        });

        const batchBody = parts.join("") + `--${boundary}--`;

        const url = config.baseUrl + "/batch/drive/v3";
        console.log('Sending batch update request to:', url);

        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.token}`,
                "Content-Type": `multipart/mixed; boundary=${boundary}`,
            },
            body: batchBody,
        });

        expect(res.status).toBe(200);
        const text = await res.text();
        console.log('Batch Update Response:', text);

        expect(text).toContain('HTTP/1.1 200 OK');

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
