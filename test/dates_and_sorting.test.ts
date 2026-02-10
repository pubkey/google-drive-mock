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

            // Check if modifiedDate is older or equal to server time (Date header)
            // Strict check: serverTime >= modifiedDate
            // Use subsequent request after 1s delay
            await new Promise(r => setTimeout(r, 1000));
            const headRes1 = await fetch(`${config.baseUrl}/drive/v2/about`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            if (!headRes1.ok) throw new Error(`Head request failed: ${headRes1.status}`);
            const dateHeader = headRes1.headers.get('date');
            if (!dateHeader) throw new Error('Date header missing from response');
            const serverTimeCreate = new Date(dateHeader).getTime();
            expect(serverTimeCreate).toBeGreaterThanOrEqual(initialModifiedDate);

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
        }, 60000);

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
        }, 60000);

        it('should update modifiedDate when metadata is updated', async () => {
            // 1. Create file
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v2/files?uploadType=media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'Metadata Test V2'
            });
            const file = await createRes.json();
            const initialModifiedDate = new Date(file.modifiedDate).getTime();

            // Wait a bit
            await new Promise(r => setTimeout(r, 1500));

            // 2. Update metadata
            const updateRes = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: 'Updated Title V2' })
            });
            expect(updateRes.status).toBe(200);
            const updatedFile = await updateRes.json();
            const updatedModifiedDate = new Date(updatedFile.modifiedDate).getTime();

            expect(updatedModifiedDate).toBeGreaterThan(initialModifiedDate);
        });
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
        }, 60000);

        it('should return a valid Date header', async () => {
            const res = await fetch(`${config.baseUrl}/drive/v3/files`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            expect(res.status).toBe(200);

            const dateHeader = res.headers.get('date');
            expect(dateHeader).toBeTruthy();

            const date = new Date(dateHeader!);
            expect(date.toString()).not.toBe('Invalid Date');

            // Optional: Check if date is recent (within 5 minutes to account for skew)
            const now = Date.now();
            const diff = Math.abs(now - date.getTime());
            expect(diff).toBeLessThan(5 * 60 * 1000);
        });

        it('should increase the Date header time over time', async () => {
            const res1 = await fetch(`${config.baseUrl}/drive/v3/files`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const date1 = new Date(res1.headers.get('date')!).getTime();

            await new Promise(r => setTimeout(r, 1500));

            const res2 = await fetch(`${config.baseUrl}/drive/v3/files`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const date2 = new Date(res2.headers.get('date')!).getTime();

            expect(date2).toBeGreaterThan(date1);
        });

        it('should update modifiedTime when metadata is updated', async () => {
            // 1. Create file
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media&fields=id,modifiedTime`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain'
                },
                body: 'Metadata Test V3'
            });
            const file = await createRes.json();
            const initialModifiedTime = new Date(file.modifiedTime).getTime();

            // Wait a bit
            await new Promise(r => setTimeout(r, 1500));

            // 2. Update metadata
            const updateRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=id,modifiedTime`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'Updated Name V3' })
            });
            expect(updateRes.status).toBe(200);
            const updatedFile = await updateRes.json();
            const updatedModifiedTime = new Date(updatedFile.modifiedTime).getTime();

            expect(updatedModifiedTime).toBeGreaterThan(initialModifiedTime);
        });

        it('should have modifiedTime <= Date header', async () => {
            // 1. Create
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media&fields=id,modifiedTime`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'text/plain' },
                body: 'Time Check'
            });
            if (!createRes.ok) {
                const text = await createRes.text();
                throw new Error(`Create failed: ${createRes.status} ${text}`);
            }
            const file = await createRes.json();
            console.log('Explicit Time Check File:', JSON.stringify(file, null, 2));
            if (!file.modifiedTime) throw new Error('modifiedTime missing from response');
            const modifiedTimeCreate = new Date(file.modifiedTime).getTime();

            // Strict check: serverTime >= modifiedTime
            // Use subsequent HEAD request after 1s delay
            await new Promise(r => setTimeout(r, 1000));
            const headRes1 = await fetch(`${config.baseUrl}/drive/v3/files?pageSize=1&fields=kind`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });

            if (!headRes1.ok) throw new Error(`Head request failed: ${headRes1.status}`);
            const dateHeader1 = headRes1.headers.get('date');
            if (!dateHeader1) throw new Error('Date header missing');
            const serverTimeCreate = new Date(dateHeader1).getTime();
            expect(serverTimeCreate).toBeGreaterThanOrEqual(modifiedTimeCreate);

            // 2. Update
            await new Promise(r => setTimeout(r, 1500));
            const updateRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=id,modifiedTime`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Updated Name Time Check' })
            });
            const updatedFile = await updateRes.json();
            const modifiedTimeUpdate = new Date(updatedFile.modifiedTime).getTime();

            // Strict check
            await new Promise(r => setTimeout(r, 1000));
            const headRes2 = await fetch(`${config.baseUrl}/drive/v3/files?pageSize=1&fields=kind`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const dateHeader2 = headRes2.headers.get('date');
            if (!dateHeader2) throw new Error('Date header missing');
            const serverTimeUpdate = new Date(dateHeader2).getTime();
            expect(serverTimeUpdate).toBeGreaterThanOrEqual(modifiedTimeUpdate);

            // 3. Explicit check on specific endpoint as requested
            // Already waited > 1s above.
            const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=modifiedTime`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const getFile = await getRes.json();
            const getResDateHeader = getRes.headers.get('date');
            if (!getResDateHeader) throw new Error('Date header missing');
            const getResServerTime = new Date(getResDateHeader).getTime();
            const getResModifiedTime = new Date(getFile.modifiedTime).getTime();

            expect(getResServerTime).toBeGreaterThanOrEqual(getResModifiedTime);
        }, 60000);

        it('should update modifiedTime and enforce strict server time check when updating with If-Match', async () => {
            // 1. Create file
            // Make sure to request 'etag' field explicitly if V3 doesn't return it by default
            // ERROR: "Invalid field selection etag". configured fields: id,modifiedTime,name
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media&fields=id,modifiedTime,name`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'text/plain' },
                body: 'Etags Test'
            });
            const file = await createRes.json();
            const initialModifiedTime = new Date(file.modifiedTime).getTime();
            // console.log('V3 Create File for If-Match:', JSON.stringify(file, null, 2)); 

            // ETag might be in header or body (if not restricted by fields)
            // But since strict fields are used, it might be missing from body.
            // Check header explicitly. If not found, do a GET request (HEAD might be flaky or stripped?)
            let etag = createRes.headers.get('etag') || file.etag;

            if (!etag) {
                // console.log('ETag missing from create response. Fetching via GET (fields=*)...');
                const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=*`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${config.token}` }
                });
                if (!getRes.ok) {
                    console.error(`GET ETag failed: ${getRes.status} ${await getRes.text()}`);
                } else {
                    if (!etag) {
                        const getFile = await getRes.json();
                        if (getFile.etag) etag = getFile.etag;
                    }
                }
            }

            // Last resort: Try V2 API
            if (!etag) {
                // console.log('V3 ETag missing. Trying V2...');
                const v2Res = await fetch(`${config.baseUrl}/drive/v2/files/${file.id}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${config.token}` }
                });
                if (v2Res.ok) {
                    const v2File = await v2Res.json();
                    etag = v2File.etag || v2Res.headers.get('etag');
                }
            }

            // console.log('V3 ETag:', etag);
            expect(etag).toBeDefined();
            expect(etag).toBeTruthy();

            // Wait to ensure time difference
            await new Promise(r => setTimeout(r, 1500));

            // 2. Update with If-Match
            const updateRes = await fetch(`${config.baseUrl}/upload/drive/v3/files/${file.id}?uploadType=media&fields=id,modifiedTime,name`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'Content-Type': 'text/plain',
                    'If-Match': etag
                },
                body: 'Updated Content with Etag'
            });
            expect(updateRes.status).toBe(200);
            const updatedFile = await updateRes.json();
            const updatedModifiedTime = new Date(updatedFile.modifiedTime).getTime();

            // Check modifiedTime increased
            expect(updatedModifiedTime).toBeGreaterThan(initialModifiedTime);

            // Strict check: serverTime >= modifiedTime
            // Since response Date header has only seconds precision, and modifiedTime has ms,
            // we wait 1s and check against a fresh server time to strictly satisfy checking without "tolerance" math.
            await new Promise(r => setTimeout(r, 1000));
            const headRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}`, {
                method: 'HEAD',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const headDate = headRes.headers.get('date');
            if (!headDate) throw new Error('Date header missing');
            const headServerTime = new Date(headDate).getTime();

            expect(headServerTime).toBeGreaterThanOrEqual(updatedModifiedTime);
        }, 60000);
    });

    describe('Explicit Modified Time Check', () => {
        it('should have modifiedTime <= Date header when fetching with fields', async () => {
            // 1. Create file first
            const createRes = await fetch(`${config.baseUrl}/upload/drive/v3/files?uploadType=media&fields=id,modifiedTime`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'text/plain' },
                body: 'Time Check Separate'
            });
            const file = await createRes.json();
            console.log('Explicit Time Check File:', JSON.stringify(file, null, 2));
            if (!file.modifiedTime) throw new Error('modifiedTime missing from response');
            const modifiedTimeCreate = new Date(file.modifiedTime).getTime();

            // Strict check: serverTime >= modifiedTime
            // Use list endpoint to ensure Date header presence
            await new Promise(r => setTimeout(r, 1000));
            const headRes0 = await fetch(`${config.baseUrl}/drive/v3/files?pageSize=1&fields=kind`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const dateHeaderCreate = headRes0.headers.get('date');
            console.log('Date Header Create:', dateHeaderCreate);
            if (!dateHeaderCreate) throw new Error('Date header missing');
            const serverTimeCreate = new Date(dateHeaderCreate).getTime();
            expect(serverTimeCreate).toBeGreaterThanOrEqual(modifiedTimeCreate);

            // 2. Explicit check on specific endpoint
            // Wait to ensure server time (Date header) advances to the next second
            // so strict comparison serverTime >= modifiedTime passes despite precision difference.
            await new Promise(r => setTimeout(r, 1000));
            const getRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=modifiedTime`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const getFile = await getRes.json();
            const getResDateHeader = getRes.headers.get('date');
            if (!getResDateHeader) throw new Error('Date header missing');
            const getResServerTime = new Date(getResDateHeader).getTime();
            const getResModifiedTime = new Date(getFile.modifiedTime).getTime();

            expect(getResServerTime).toBeGreaterThanOrEqual(getResModifiedTime);

            // 3. Modify the file
            await new Promise(r => setTimeout(r, 1500)); // Ensure time diff
            const updateRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=modifiedTime`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Updated Name Separate' })
            });
            const updatedFile = await updateRes.json();
            const updateResModifiedTime = new Date(updatedFile.modifiedTime).getTime();

            // Strict check: serverTime >= modifiedTime
            await new Promise(r => setTimeout(r, 1000));
            const headRes1 = await fetch(`${config.baseUrl}/drive/v3/files?pageSize=1&fields=kind`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const updateResDateHeader = headRes1.headers.get('date');
            if (!updateResDateHeader) throw new Error('Date header missing');
            const updateResServerTime = new Date(updateResDateHeader).getTime();

            expect(updateResServerTime).toBeGreaterThanOrEqual(updateResModifiedTime);
            expect(updateResModifiedTime).toBeGreaterThan(getResModifiedTime);

            // 4. Trash the file
            await new Promise(r => setTimeout(r, 1500)); // Ensure time diff
            const trashRes = await fetch(`${config.baseUrl}/drive/v3/files/${file.id}?fields=modifiedTime,trashed`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ trashed: true })
            });
            const trashedFile = await trashRes.json();
            const trashResModifiedTime = new Date(trashedFile.modifiedTime).getTime();

            // Strict check: serverTime >= modifiedTime
            await new Promise(r => setTimeout(r, 1000));
            const headRes2 = await fetch(`${config.baseUrl}/drive/v3/files?pageSize=1&fields=kind`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            const trashResDateHeader = headRes2.headers.get('date');
            if (!trashResDateHeader) throw new Error('Date header missing');
            const trashResServerTime = new Date(trashResDateHeader).getTime();

            expect(trashResServerTime).toBeGreaterThanOrEqual(trashResModifiedTime);
            expect(trashResModifiedTime).toBeGreaterThanOrEqual(updateResModifiedTime);
            expect(trashedFile.trashed).toBe(true);
        }, 60000);
    });
});
