import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Google Drive V2 Missing Operations', () => {
    let config: TestConfig;
    let fileId: string;
    let folderId: string;

    beforeAll(async () => {
        config = await getTestConfig();

        // Create a folder to test parent operations
        const folderRes = await fetch(`${config.baseUrl}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Test Folder V2 Ops',
                mimeType: 'application/vnd.google-apps.folder'
            })
        });
        const folder = await folderRes.json();
        folderId = folder.id;

        // Create a dummy file
        const fileRes = await fetch(`${config.baseUrl}/drive/v2/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Test File V2 Ops',
                mimeType: 'text/plain'
            })
        });
        const file = await fileRes.json();
        fileId = file.id;
    });

    afterAll(async () => {
        if (folderId) {
            await fetch(`${config.baseUrl}/drive/v2/files/${folderId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
        }
        if (fileId) {
            await fetch(`${config.baseUrl}/drive/v2/files/${fileId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
        }
    });

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

    it('should export file content', async () => {
        // For mock, export just returns content effectively.
        // First set some content
        await fetch(`${config.baseUrl}/upload/drive/v2/files/${fileId}?uploadType=media`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'text/plain'
            },
            body: 'Hello Export World'
        });

        const res = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}/export?mimeType=text/plain`, {
            headers: { 'Authorization': `Bearer ${config.token}` }
        });

        // Real API returns 400 for non-Google Docs. Mock returns 200.
        if (config.baseUrl.includes('googleapis')) {
            expect(res.status).toBe(400);
        } else {
            expect(res.status).toBe(200);
            const content = await res.text();
            expect(content).toBe('Hello Export World');
        }
    });

    it('should watch file changes', async () => {
        const res = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}/watch`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: `channel-${Date.now()}`, // Unique ID for real API
                type: 'web_hook',
                address: 'https://example.com/webhook'
            })
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.kind).toBe('api#channel');
        // Real API returns a different opaque ID, Mock returns fileId.
        expect(data.resourceId).toBeDefined();
    });

    it('should add parents via update (PUT)', async () => {
        const res = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?addParents=${folderId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Updated Title'
            })
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.parents.some((p: { id: string }) => p.id === folderId)).toBe(true);
    });

    it('should remove parents via update (PUT)', async () => {
        const res = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?removeParents=${folderId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        const parents = data.parents || [];
        expect(parents.some((p: { id: string }) => p.id === folderId)).toBe(false);
    });

    it('should add/remove parents via patch (PATCH)', async () => {
        // Add
        let res = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?addParents=${folderId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        let data = await res.json();
        expect(data.parents.some((p: { id: string }) => p.id === folderId)).toBe(true);

        // Remove
        res = await fetch(`${config.baseUrl}/drive/v2/files/${fileId}?removeParents=${folderId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        data = await res.json();
        const parents = data.parents || [];
        expect(parents.some((p: { id: string }) => p.id === folderId)).toBe(false);
    });
});
