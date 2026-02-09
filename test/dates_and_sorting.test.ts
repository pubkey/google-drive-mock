import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Date Updates and Sorting', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    describe('V2 API', () => {
        it('should update modifiedDate when content is updated', async () => {
            // 1. Create file
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'Initial Content'
            });
            const file = await createRes.json();
            const initialModifiedDate = new Date(file.modifiedDate).getTime();

            // Wait a bit to ensure time difference
            await new Promise(r => setTimeout(r, 1500));

            // 2. Update content
            const updateRes = await fetch(`${config.baseUrl}/upload/drive/v2/files/${file.id}?uploadType=media`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'Updated Content'
            });
            expect(updateRes.status).toBe(200);
            const updatedFile = await updateRes.json();
            const updatedModifiedDate = new Date(updatedFile.modifiedDate).getTime();

            expect(updatedModifiedDate).toBeGreaterThan(initialModifiedDate);
        });

        it('should update modifiedDate when touched', async () => {
            // 1. Create file
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'To be touched'
            });
            const file = await createRes.json();
            const initialModifiedDate = new Date(file.modifiedDate).getTime();

            // Wait a bit
            await new Promise(r => setTimeout(r, 1500));

            // 2. Touch file
            const touchRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}/touch`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.token}`
                }
            });
            expect(touchRes.status).toBe(200);
            const touchedFile = await touchRes.json();
            const touchedModifiedDate = new Date(touchedFile.modifiedDate).getTime();

            expect(touchedModifiedDate).toBeGreaterThan(initialModifiedDate);
        });

        it('should sort files by modifiedDate desc', async () => {
            // Create 3 files with delays
            const files: { id: string }[] = [];
            for (let i = 0; i < 3; i++) {
                const res = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'text/plain' },
                    body: `File ${i}`
                });
                const file = await res.json();
                files.push(file);
                // Ensure distinct modified times
                await new Promise(r => setTimeout(r, 1100));
            }

            // List with orderBy=modifiedDate desc
            const listRes = await fetch(`${config.baseUrl}/drive/v2/files?orderBy=modifiedDate desc`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            expect(listRes.status).toBe(200);
            const list = await listRes.json();
            const items = list.items.filter((f: { id: string }) => files.some(created => created.id === f.id));

            // Should be [File 2, File 1, File 0] (newest first)
            expect(items.length).toBeGreaterThanOrEqual(3);

            // Allow for other files to exist, but our created ones should appear in relative order
            const item2 = items.find((f: { id: string; modifiedDate: string }) => f.id === files[2].id);
            const item1 = items.find((f: { id: string; modifiedDate: string }) => f.id === files[1].id);
            const item0 = items.find((f: { id: string; modifiedDate: string }) => f.id === files[0].id);

            expect(item2 && item1 && item0).toBeTruthy();

            if (!item2 || !item1 || !item0) throw new Error('Items not found');

            const time2 = new Date(item2.modifiedDate).getTime();
            const time1 = new Date(item1.modifiedDate).getTime();
            const time0 = new Date(item0.modifiedDate).getTime();

            expect(time2).toBeGreaterThan(time1);
            expect(time1).toBeGreaterThan(time0);
        }, 20000);
    });

    describe('V3 API', () => {
        it('should update modifiedTime when content is updated', async () => {
            // 1. Create file. V3 default fields might not include modifiedTime? Request it explicitly.
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media&fields=id,modifiedTime`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'Initial Content V3'
            });
            const file = await createRes.json();

            // console.log('V3 Create File:', file);

            const initialModifiedTime = new Date(file.modifiedTime).getTime();

            // Wait a bit
            await new Promise(r => setTimeout(r, 1500));

            // 2. Update content
            const updateRes = await fetch(`${config.baseUrl}/upload/drive/v3/files/${file.id}?uploadType=media&fields=id,modifiedTime`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'Updated Content V3'
            });
            expect(updateRes.status).toBe(200);
            const updatedFile = await updateRes.json();

            // console.log('V3 Updated File:', updatedFile);

            const updatedModifiedTime = new Date(updatedFile.modifiedTime).getTime();

            expect(updatedModifiedTime).toBeGreaterThan(initialModifiedTime);
        });

        it('should sort files by modifiedTime desc', async () => {
            // Create 3 files with delays
            const files: { id: string }[] = [];
            for (let i = 0; i < 3; i++) {
                const res = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media&fields=id,modifiedTime`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'text/plain' },
                    body: `File V3 ${i}`
                });
                const file = await res.json();
                files.push(file);
                await new Promise(r => setTimeout(r, 1100));
            }

            // List with orderBy=modifiedTime desc
            const listRes = await fetch(`${config.baseUrl}/drive/v3/files?orderBy=modifiedTime desc&fields=files(id,modifiedTime)`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            expect(listRes.status).toBe(200);
            const list = await listRes.json();
            const items = list.files.filter((f: { id: string }) => files.some(created => created.id === f.id));

            const item2 = items.find((f: { id: string; modifiedTime: string }) => f.id === files[2].id);
            const item1 = items.find((f: { id: string; modifiedTime: string }) => f.id === files[1].id);
            const item0 = items.find((f: { id: string; modifiedTime: string }) => f.id === files[0].id);

            expect(item2 && item1 && item0).toBeTruthy();

            if (!item2 || !item1 || !item0) throw new Error('Items not found');

            const time2 = new Date(item2.modifiedTime).getTime();
            const time1 = new Date(item1.modifiedTime).getTime();
            const time0 = new Date(item0.modifiedTime).getTime();

            expect(time2).toBeGreaterThan(time1);
            expect(time1).toBeGreaterThan(time0);
        }, 20000);
    });
});
