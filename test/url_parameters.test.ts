
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('URL Parameters Test', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    it('should download file content using alt=media and supportsAllDrives=true', async () => {
        const fileName = `UrlParamTest_${Date.now()}.json`;
        const content = { msg: 'Hello World', timestamp: Date.now() };

        // 1. Upload File
        const metadata = {
            name: fileName,
            parents: [config.testFolderId],
            mimeType: 'application/json'
        };

        const multipartBoundary = '-------TestBoundary' + Date.now();
        const delimiter = '\r\n--' + multipartBoundary + '\r\n';
        const closeDelim = '\r\n--' + multipartBoundary + '--';

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(content) +
            closeDelim;

        const uploadUrl = `${config.baseUrl}/upload/drive/v3/files?uploadType=multipart&fields=id`;
        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + config.token,
                'Content-Type': 'multipart/related; boundary="' + multipartBoundary + '"'
            },
            body: body
        });

        if (!uploadRes.ok) {
            throw new Error(`Failed to upload file. Status: ${uploadRes.status} ${await uploadRes.text()}`);
        }

        const data = await uploadRes.json();
        const fileId = data.id;
        expect(fileId).toBeDefined();

        // 2. Download with specific URL parameters
        const downloadUrl = `${config.baseUrl}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
        console.log('Downloading from:', downloadUrl);

        const res = await fetch(downloadUrl, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + config.token
            }
        });

        if (!res.ok) {
            throw new Error(`Failed to download file. Status: ${res.status} ${await res.text()}`);
        }

        const downloadedContent = await res.json();
        expect(downloadedContent).toEqual(content);

    }, 30000);
});
