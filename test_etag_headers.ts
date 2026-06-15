/* eslint-disable */
import { getTestConfig } from './test/config';

async function run() {
    const config = await getTestConfig();
    const token = config.token;
    const baseUrl = config.baseUrl;

    const req = async (method: string, path: string, body?: any, headers: any = {}) => {
        const url = `${baseUrl}${path}`;
        const fetchOptions: RequestInit = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                ...headers
            }
        };
        if (body) {
            if (typeof body === 'string') {
                fetchOptions.body = body;
            } else {
                fetchOptions.body = JSON.stringify(body);
                fetchOptions.headers = {
                    ...fetchOptions.headers,
                    'Content-Type': 'application/json'
                };
            }
        }
        const res = await fetch(url, fetchOptions);
        const resBody = res.headers.get('content-type')?.includes('application/json')
            ? await res.json()
            : await res.text();
        return { status: res.status, headers: res.headers, body: resBody };
    };

    console.log('--- TESTING V2 ---');

    // 1. Create file (POST metadata)
    const createRes = await req('POST', '/drive/v2/files', {
        title: 'ETag Test V2 Real',
        parents: [{ id: config.testFolderId }]
    });
    console.log('1. POST /drive/v2/files status:', createRes.status);
    console.log('1. POST /drive/v2/files ETag Header:', createRes.headers.get('etag'));
    console.log('1. POST /drive/v2/files Body etag:', createRes.body.etag);

    const fileId = createRes.body.id;

    // 2. GET file metadata
    const getRes = await req('GET', `/drive/v2/files/${fileId}`);
    console.log('2. GET /drive/v2/files/:id status:', getRes.status);
    console.log('2. GET /drive/v2/files/:id ETag Header:', getRes.headers.get('etag'));
    console.log('2. GET /drive/v2/files/:id Body etag:', getRes.body.etag);

    // 3. PUT file metadata (V2 uses PUT for metadata update)
    const putRes = await req('PUT', `/drive/v2/files/${fileId}`, {
        title: 'ETag Test V2 Real Patched'
    });
    console.log('3. PUT /drive/v2/files/:id status:', putRes.status);
    console.log('3. PUT /drive/v2/files/:id ETag Header:', putRes.headers.get('etag'));
    console.log('3. PUT /drive/v2/files/:id Body etag:', putRes.body.etag);

    // 4. POST media upload (create content)
    // In V2, media upload is POST /upload/drive/v2/files
    const uploadCreateRes = await req('POST', `/upload/drive/v2/files?uploadType=media`, 'initial content v2', {
        'Content-Type': 'text/plain'
    });
    console.log('4. POST /upload/drive/v2/files status:', uploadCreateRes.status);
    console.log('4. POST /upload/drive/v2/files ETag Header:', uploadCreateRes.headers.get('etag'));
    console.log('4. POST /upload/drive/v2/files Body etag:', uploadCreateRes.body.etag);
    
    const uploadedFileId = uploadCreateRes.body.id;

    // 5. PUT media upload (update content)
    const uploadUpdateRes = await req('PUT', `/upload/drive/v2/files/${uploadedFileId}?uploadType=media`, 'updated content v2', {
        'Content-Type': 'text/plain'
    });
    console.log('5. PUT /upload/drive/v2/files/:id status:', uploadUpdateRes.status);
    console.log('5. PUT /upload/drive/v2/files/:id ETag Header:', uploadUpdateRes.headers.get('etag'));
    console.log('5. PUT /upload/drive/v2/files/:id Body etag:', uploadUpdateRes.body.etag);

    // 6. GET content (alt=media)
    const getContentRes = await req('GET', `/drive/v2/files/${uploadedFileId}?alt=media`);
    console.log('6. GET /drive/v2/files/:id?alt=media status:', getContentRes.status);
    console.log('6. GET /drive/v2/files/:id?alt=media ETag Header:', getContentRes.headers.get('etag'));

    // Cleanup
    if (fileId) await req('DELETE', `/drive/v2/files/${fileId}`);
    if (uploadedFileId) await req('DELETE', `/drive/v2/files/${uploadedFileId}`);
}

run().catch(console.error);
