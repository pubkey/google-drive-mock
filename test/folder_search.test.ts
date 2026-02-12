import { describe, it, expect, beforeAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

const randomString = () => Math.random().toString(36).substring(7);

describe('Folder Search Parity', () => {
    let config: TestConfig;
    let headers: Record<string, string>;

    beforeAll(async () => {
        config = await getTestConfig();
        headers = {
            Authorization: `Bearer ${config.token}`
        };
    });

    it('should return only id for folder search with fields=files(id)', async () => {
        const folderName = 'SearchTest_' + randomString();
        const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

        // 1. Create a parent folder
        const parentRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Parent_' + randomString(),
                mimeType: FOLDER_MIME_TYPE
            })
        });
        expect(parentRes.status).toBe(200);
        const parentId = (await parentRes.json()).id;

        // 2. Create the target folder inside parent
        const targetRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: folderName,
                mimeType: FOLDER_MIME_TYPE,
                parents: [parentId]
            })
        });
        expect(targetRes.status).toBe(200);
        const targetId = (await targetRes.json()).id;

        // Wait for consistency
        await new Promise(r => setTimeout(r, 2000));

        // 3. User's Query
        const query = `name = '${folderName}' and '${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME_TYPE}'`;

        const params = new URLSearchParams({
            q: query,
            fields: 'files(id,mimeType)',
            orderBy: 'createdTime asc'
        });

        const url = `${config.baseUrl}/drive/v3/files?${params.toString()}`;
        console.log('Requesting URL:', url);

        const res = await fetch(url, { headers });
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.files).toBeDefined();
        expect(data.files.length).toBeGreaterThan(0);

        const foundFolder = data.files[0];
        expect(foundFolder.id).toBe(targetId);
        expect(foundFolder.mimeType).toBe(FOLDER_MIME_TYPE);

        // Strict Key Check
        const actualKeys = Object.keys(foundFolder).sort();
        const expectedKeys = ['id', 'mimeType'].sort(); // User requested only id

        if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
            console.log('Keys mismatch! Actual:', actualKeys);
        }
        expect(actualKeys).toEqual(expectedKeys);
    }, 60000);
});
