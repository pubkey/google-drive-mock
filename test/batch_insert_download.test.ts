
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestConfig, TestConfig } from './config';

describe('Batch Insert and Download Test', () => {
    let config: TestConfig;

    beforeAll(async () => {
        config = await getTestConfig();
    });

    afterAll(() => {
        if (config) config.stop();
    });

    // Helper from user request (adapted)
    async function insertDocumentFiles<RxDocType>(
        googleDriveOptions: { apiEndpoint: string, authToken: string },
        init: { docsFolderId: string },
        primaryPath: string,
        docs: RxDocType[]
    ) {
        const boundary = "batch_" + Math.random().toString(16).slice(2);



        const parts = docs.map((doc, i) => {
            const id = (doc as Record<string, unknown>)[primaryPath] as string;
            const body = JSON.stringify({
                name: id + '.json',
                mimeType: 'application/json',
                parents: [init.docsFolderId],
            });

            return (
                `--${boundary}\r\n` +
                `Content-Type: application/http\r\n` +
                `Content-ID: <item-${i}>\r\n\r\n` +
                `POST /drive/v3/files HTTP/1.1\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${body}\r\n`
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
            throw new Error(`GDR13: Batch insert failed. Status: ${res.status}. Error: ${text}`);
        }
        const text = await res.text();
        console.log('Batch Response:', text.substring(0, 1000)); // Log snippet
        return text;
    }

    it('should insert docs using batch POST and download them', async () => {
        const docCount = 3;
        const docs = [];
        for (let i = 0; i < docCount; i++) {
            docs.push({ id: `item_${Date.now()}_${i}`, data: `Data ${i}` });
        }

        console.log('Inserting docs via batch POST...');
        const batchResponse = await insertDocumentFiles(
            { apiEndpoint: config.baseUrl, authToken: config.token },
            { docsFolderId: config.testFolderId },
            'id',
            docs
        );

        // Parse IDs from batch response?
        // The user snippet returns raw text.
        // We usually rely on create returning the created file metadata (including ID).
        // Let's parse the response to get the IDs.

        const boundaryMatch = (batchResponse.match(/boundary=(.+)/) || [])[1];
        let boundary = boundaryMatch;
        // Or inspect Content-Type header from response? Ideally yes but user helper returns body text.
        // Let's try to detect boundary from body first line if not found?
        // But headers are gone.

        // Wait, the user helper receives the Response object and returns text().
        // We lose headers :(.
        // Let's assume boundary from body first line.
        const firstLine = batchResponse.trim().split(/\r?\n/)[0];
        if (firstLine.startsWith('--')) {
            boundary = firstLine.substring(2).trim();
        } else {
            // Maybe no boundary in body if empty? unlikely for batch.
        }

        if (!boundary) throw new Error('Could not detect boundary in batch response');

        const parts = batchResponse.split(`--${boundary}`);
        const createdIds: string[] = [];

        for (const part of parts) {
            if (!part.trim() || part.trim() === '--') continue;
            // Find JSON body
            const jsonStart = part.indexOf('{');
            const jsonEnd = part.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                try {
                    const jsonStr = part.substring(jsonStart, jsonEnd + 1);
                    const file = JSON.parse(jsonStr);
                    if (file.id) {
                        createdIds.push(file.id);
                    }

                } catch {
                    // ignore parse errors
                }
            }
        }

        expect(createdIds.length).toBe(docCount);
        console.log(`Created ${createdIds.length} files. Downloading...`);

        for (const fileId of createdIds) {
            const downloadUrl = `${config.baseUrl}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
            // console.log(`Downloading ${fileId} from ${downloadUrl}`);

            const res = await fetch(downloadUrl, {
                headers: { Authorization: `Bearer ${config.token}` }
            });

            if (!res.ok) {
                throw new Error(`Download failed for ${fileId}: ${res.status} ${await res.text()}`);
            }


            const text = await res.text();
            // console.log(`Content for ${fileId}:`, text);

            // Expect empty content for metadata-only insert? 
            // Or maybe Drive defaults to empty JSON object '{}'?
            // Real API behavior for empty file created via metadata POST: 0 bytes.
            expect(text).toBe('');
        }

    }, 30000);
});
