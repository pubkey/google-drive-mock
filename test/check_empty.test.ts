import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Check Mock Drive Empty', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should be empty (no files left except possibly google-drive-mock root)', async () => {
        const headers = { 'Authorization': `Bearer ${config.token}` };
        const res = await fetch(`${config.baseUrl}/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers });
        expect(res.status).toBe(200);
        const data = await res.json();
        
        const files = data.files || [];
        
        if (!config.baseUrl.includes('googleapis')) {
            const nonRootFiles = files.filter((f: { name: string; id: string }) => f.name !== 'google-drive-mock');
            if (nonRootFiles.length > 0) {
                console.error('LOCKED/LEAKED FILES FOUND:', JSON.stringify(nonRootFiles, null, 2));
                expect(nonRootFiles.length).toBe(0);
            }
            // Clean up the google-drive-mock folder if it exists
            const rootFolder = files.find((f: { name: string; id: string }) => f.name === 'google-drive-mock');
            if (rootFolder) {
                const delRes = await fetch(`${config.baseUrl}/drive/v3/files/${rootFolder.id}`, {
                    method: 'DELETE',
                    headers
                });
                expect([204, 404]).toContain(delRes.status);
                
                // Verify absolutely no files exist now
                const checkRes = await fetch(`${config.baseUrl}/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers });
                expect(checkRes.status).toBe(200);
                const checkData = await checkRes.json();
                expect(checkData.files || []).toEqual([]);
            }
        } else {
            const q = `'${config.testFolderId}' in parents and trashed = false`;
            const childrenRes = await fetch(`${config.baseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers });
            expect(childrenRes.status).toBe(200);
            const childrenData = await childrenRes.json();
            const children = childrenData.files || [];
            expect(children.length).toBe(0);

            // Delete the test folder itself on the real API
            const delRes = await fetch(`${config.baseUrl}/drive/v3/files/${config.testFolderId}`, {
                method: 'DELETE',
                headers
            });
            expect([204, 404]).toContain(delRes.status);
        }
    });
});
