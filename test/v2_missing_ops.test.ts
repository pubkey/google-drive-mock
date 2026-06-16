import { describe, expect, beforeAll, afterAll } from 'vitest';
import { it } from './config';
import { getTestConfig, TestConfig } from './config';

describe('Google Drive V2 Missing Operations', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    const fetchWithRetry = async (url: string, options: RequestInit, retries = 4, delay = 2000): Promise<Response> => {
        for (let i = 0; i < retries; i++) {
            const res = await fetch(url, options);
            if (res.status === 200) return res;
            if (i < retries - 1) {
                console.warn(`Request to ${url} failed with status ${res.status}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                return res;
            }
        }
        throw new Error('Unreachable');
    };

    it('should generate IDs', async () => {
        const res = await fetch(`${config.baseUrl}/drive/v2/files/generateIds?maxResults=5&space=drive`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.kind).toBe('drive#generatedIds');
        expect(data.ids.length).toBe(5);
        expect(data.space).toBe('drive');
    });

    it('should support export, watch, and parent management lifecycles', async () => {
        const folderTitle = 'Test Folder V2 Ops ' + Math.random().toString(36).substring(7);
        const fileTitle = 'Test File V2 Ops ' + Math.random().toString(36).substring(7);

        // Create a folder to test parent operations
        const folderRes = await fetch(`${config.baseUrl}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: folderTitle,
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        const folder = await folderRes.json();
        const folderId = folder.id;

        // Create a dummy file
        const fileRes = await fetch(`${config.baseUrl}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: fileTitle,
                mimeType: 'text/plain'
            })
        });
        const file = await fileRes.json();
        const fileId = file.id;

        // 1. Export file content
        await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'Hello Export World'
        });

        const resExport = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}/export?mimeType=text/plain`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });

        if (config.baseUrl.includes('googleapis')) {
            expect(resExport.status).toBe(400);
        } else {
            expect(resExport.status).toBe(200);
            const content = await resExport.text();
            expect(content).toBe('Hello Export World');
        }

        // 2. Watch file changes
        const resWatch = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}/watch`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: `channel-${Date.now()}`,
                type: 'web_hook',
                address: 'https://example.com/webhook'
            })
        });
        expect(resWatch.status).toBe(200);
        const watchData = await resWatch.json();
        expect(watchData.kind).toBe('api#channel');
        expect(watchData.resourceId).toBeDefined();

        // 3. Add parents via update (PUT)
        const resAddPut = await fetchWithRetry(`${config.baseUrl}/drive/v2/files/${fileId}?addParents=${folderId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Updated Title'
            })
        });
        expect(resAddPut.status).toBe(200);
        const addPutData = await resAddPut.json();
        expect(addPutData.parents.some((p: { id: string }) => p.id === folderId)).toBe(true);

        // 4. Remove parents via update (PUT)
        const resRemovePut = await fetchWithRetry(`${config.baseUrl}/drive/v2/files/${fileId}?removeParents=${folderId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        expect(resRemovePut.status).toBe(200);
        const removePutData = await resRemovePut.json();
        const parentsPut = removePutData.parents || [];
        expect(parentsPut.some((p: { id: string }) => p.id === folderId)).toBe(false);

        // 5. Add/remove parents via patch (PATCH)
        await new Promise(r => setTimeout(r, 1000));
        const resAddPatch = await fetchWithRetry(`${config.baseUrl}/drive/v2/files/${fileId}?addParents=${folderId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        expect(resAddPatch.status).toBe(200);
        const addPatchData = await resAddPatch.json();
        expect(addPatchData.parents.some((p: { id: string }) => p.id === folderId)).toBe(true);

        await new Promise(r => setTimeout(r, 1000));
        const resRemovePatch = await fetchWithRetry(`${config.baseUrl}/drive/v2/files/${fileId}?removeParents=${folderId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        expect(resRemovePatch.status).toBe(200);
        const removePatchData = await resRemovePatch.json();
        const parentsPatch = removePatchData.parents || [];
        expect(parentsPatch.some((p: { id: string }) => p.id === folderId)).toBe(false);
    });
});
