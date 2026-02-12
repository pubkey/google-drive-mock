import { describe, it, expect, beforeAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

const randomString = () => Math.random().toString(36).substring(7);

describe('Folder Query Investigation', () => {
    let config: TestConfig;
    let headers: Record<string, string>;

    beforeAll(async () => {
        config = await getTestConfig();
        headers = {
            Authorization: `Bearer ${config.token}`
        };
    });

    it('should return files in a folder with specific query parameters', async () => {
        // 1. Create a parent folder
        const parentRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'QueryTestParams_' + randomString(),
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        expect(parentRes.status).toBe(200);
        const parentId = (await parentRes.json()).id;

        // 2. Create a few files in the folder
        const file1 = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'file1',
                parents: [parentId]
            })
        }).then(res => res.json());

        const file2 = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'file2',
                parents: [parentId]
            })
        }).then(res => res.json());

        // Wait for consistency
        await new Promise(r => setTimeout(r, 2000));

        // 3. Run the user's specific query
        const queryParts = [
            `'${parentId}' in parents`,
            `and trashed = false`
        ];

        // Optional: Add modifiedTime check if needed, but let's start with basic structure
        // const checkpoint = { modifiedTime: '...' };
        // if (checkpoint) {
        //     queryParts.push(`and modifiedTime >= '${checkpoint.modifiedTime}'`);
        // }

        const batchSize = 10;
        const params = new URLSearchParams({
            q: queryParts.join(' '),
            pageSize: (batchSize + 10) + '',
            orderBy: "modifiedTime asc,name asc",
            fields: "files(id,name,mimeType,parents,modifiedTime,size)",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
        });

        const url =
            config.baseUrl +
            "/drive/v3/files?" +
            params.toString();

        console.log('Requesting URL:', url);

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${config.token}`,
            },
        });

        if (res.status !== 200) {
            console.error('Error response:', await res.text());
        }
        expect(res.status).toBe(200);
        const data = await res.json();

        console.log('Found files:', data.files.length);
        const ids = data.files.map((f: { id: string }) => f.id);
        expect(ids).toContain(file1.id);
        expect(ids).toContain(file2.id);

        // Check if fields are returned
        const f1 = data.files.find((f: { id: string }) => f.id === file1.id) as Record<string, unknown>;
        expect(f1.name).toBeDefined();
        expect(f1.modifiedTime).toBeDefined();
        expect(f1.parents).toBeDefined();
        expect(f1.parents).toContain(parentId);

        // Strict key check
        const expectedKeys = ['id', 'name', 'mimeType', 'parents', 'modifiedTime', 'size'].sort();
        const actualKeys = Object.keys(f1).sort();

        // Log for debugging if they don't match (Vitest will show diff)
        if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
            console.log('Keys mismatch! Actual:', actualKeys);
        }
        expect(actualKeys).toEqual(expectedKeys);

    }, 60000);

    it('should return files with modifiedTime filter', async () => {
        const parentRes = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'QueryTestTime_' + randomString(),
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        const parentId = (await parentRes.json()).id;

        // Create file 1 (Old)
        const file1 = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'file1_old', parents: [parentId] })
        }).then(res => res.json());

        // Wait to ensure distinct modifiedTime
        await new Promise(r => setTimeout(r, 1500));

        // Checkpoint time
        const checkpointTime = new Date().toISOString();

        await new Promise(r => setTimeout(r, 1500));

        // Create file 2 (New)
        const file2 = await fetch(`${config.baseUrl}/drive/v3/files`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'file2_new', parents: [parentId] })
        }).then(res => res.json());

        // Query: parent + trashed + modifiedTime >= checkpoint
        const queryParts = [
            `'${parentId}' in parents`,
            `and trashed = false`,
            `and modifiedTime >= '${checkpointTime}'`
        ];

        const params = new URLSearchParams({
            q: queryParts.join(' '),
            pageSize: '10',
            orderBy: "modifiedTime asc,name asc",
            fields: "files(id,name,mimeType,parents,modifiedTime,size)",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
        });

        const url = `${config.baseUrl}/drive/v3/files?${params.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } });
        expect(res.status).toBe(200);
        const data = await res.json();

        const ids = data.files.map((f: { id: string }) => f.id);

        // Should contain file2 (New), but NOT file1 (Old)
        expect(ids).toContain(file2.id);
        expect(ids).not.toContain(file1.id);
    }, 60000);
});
