
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

// --- User's Logic (Batch Fetch) ---

interface GoogleDriveOptionsWithDefaults {
    apiEndpoint: string;
    authToken: string;
}

export async function batchFetchDocumentContentsRaw(
    googleDriveOptions: GoogleDriveOptionsWithDefaults,
    fileIds: string[]
) {
    const boundary = "batch_" + Math.random().toString(16).slice(2);

    const parts = fileIds.map((id, i) => {
        return (
            `--${boundary}\r\n` +
            `Content-Type: application/http\r\n` +
            `Content-ID: <item-${i}>\r\n\r\n` +
            `GET /drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true HTTP/1.1\r\n\r\n`
        );
    });

    const batchBody = parts.join("") + `--${boundary}--`;

    const res = await fetch(googleDriveOptions.apiEndpoint + "/batch/drive/v3", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${googleDriveOptions.authToken}`,
            "Content-Type": `multipart/mixed; boundary=${boundary}`,
        },
        body: batchBody,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GDR19: Failed to fetch batch. Status: ${res.status}. Error: ${text}`);
    }

    // This will be a multipart/mixed body that you must parse yourself.
    return await res.text();
}

/**
 * Parses a multipart/mixed response body from Google Drive Batch API.
 * Returns an array of objects containing { status, headers, body }.
 */
function parseBatchResponse(body: string, contentTypeHeader: string): { status: number, headers: Record<string, string>, body: any }[] {
    const boundaryMatch = contentTypeHeader.match(/boundary=(.+)/);
    if (!boundaryMatch) {
        throw new Error('Multipart boundary missing in response header');
    }
    let boundary = boundaryMatch[1];
    if (boundary.startsWith('"') && boundary.endsWith('"')) {
        boundary = boundary.substring(1, boundary.length - 1);
    }

    const parts = body.split(`--${boundary}`);
    const results: { status: number, headers: Record<string, string>, body: any }[] = [];

    for (const part of parts) {
        const trimmedPart = part.trim();
        if (!trimmedPart || trimmedPart === '--') continue;

        const outerBodyStart = findDoubleNewline(trimmedPart);
        if (outerBodyStart === -1) continue;

        const outerBody = trimmedPart.substring(outerBodyStart).trim();

        const lines = outerBody.split(/\r?\n/);
        const statusLine = lines[0];
        const statusCode = parseInt(statusLine.split(' ')[1], 10);

        // Parse inner headers
        const innerHeaders: Record<string, string> = {};
        let headerEndIndex = 0;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') {
                headerEndIndex = i;
                break;
            }
            const [key, ...val] = line.split(':');
            if (key) innerHeaders[key.toLowerCase().trim()] = val.join(':').trim();
        }

        const innerBodyStart = findDoubleNewline(outerBody);
        let contentBody = '';
        let parsedBody = null;

        if (innerBodyStart !== -1) {
            contentBody = outerBody.substring(innerBodyStart).trim();
            if (contentBody) {
                try {
                    parsedBody = JSON.parse(contentBody);
                } catch (e) {
                    parsedBody = contentBody;
                }
            }
        }

        results.push({
            status: statusCode,
            headers: innerHeaders,
            body: parsedBody
        });
    }

    return results;
}

function findDoubleNewline(str: string): number {
    const crlf = str.indexOf('\r\n\r\n');
    if (crlf !== -1) return crlf + 4;
    const lf = str.indexOf('\n\n');
    if (lf !== -1) return lf + 2;
    return -1;
}


// --- Test Suite ---

describe('Batch Fetch Test', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    async function uploadJsonFile(name: string, content: any): Promise<string> {
        const metadata = {
            name: name,
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

        const url = `${config.baseUrl}/upload/drive/v3/files?uploadType=multipart&fields=id`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + config.token,
                'Content-Type': 'multipart/related; boundary="' + multipartBoundary + '"'
            },
            body: body
        });

        if (!res.ok) {
            throw new Error(`Failed to upload file. Status: ${res.status} ${await res.text()}`);
        }

        const data = await res.json();
        return data.id;
    }

    it('should fetch content of many files in a single batch request', async () => {
        const fileCount = 5;
        const fileIds: string[] = [];
        const expectedContents: Record<string, any> = {};

        console.log(`Creating ${fileCount} files...`);

        for (let i = 0; i < fileCount; i++) {
            const fileName = `BatchFile_${i}_${Date.now()}.json`;
            const content = { index: i, timestamp: Date.now(), msg: `Hello World ${i}`, random: Math.random() };

            const id = await uploadJsonFile(fileName, content);
            fileIds.push(id);
            expectedContents[id] = content;
        }


        const rawBatchResponse = await batchFetchDocumentContentsRaw({
            apiEndpoint: config.baseUrl,
            authToken: config.token
        }, fileIds);

        // Detect boundary
        let boundary = '';
        const firstLine = rawBatchResponse.trim().split(/\r?\n/)[0];
        if (firstLine.startsWith('--')) {
            boundary = firstLine.substring(2).trim();
        } else {
            throw new Error('Could not detect boundary from response body: ' + rawBatchResponse.substring(0, 100));
        }


        // We can synthesize a content-type header for our parser
        const mockContentType = `multipart/mixed; boundary="${boundary}"`;

        // console.log('Raw Batch Response (snippet):', rawBatchResponse.substring(0, 500));

        const parsedResults = parseBatchResponse(rawBatchResponse, mockContentType);


        expect(parsedResults.length).toBe(fileCount);

        for (const result of parsedResults) {
            let content = result.body;


            // All environments (Mock and Real) must return 302 Redirect for alt=media in batch
            if (result.status !== 302) {
                throw new Error(`Expected 302 Redirect, got ${result.status}: ${JSON.stringify(content)}`);
            }

            const location = result.headers['location'];
            if (!location) {
                throw new Error('302 response missing Location header');
            }
            // console.log('Following redirect to:', location.substring(0, 50) + '...');

            const res = await fetch(location, {
                headers: {
                    Authorization: 'Bearer ' + config.token
                }
            });

            if (!res.ok) throw new Error(`Failed to follow redirect: ${res.status} ${await res.text()}`);
            content = await res.json();


            const expected = Object.values(expectedContents).find(c => c.index === content.index);
            expect(expected).toBeDefined();
            expect(content).toEqual(expected);
        }

    }, 60000);
});
