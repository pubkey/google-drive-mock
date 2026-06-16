import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const envPath = path.resolve(__dirname, '../.ENV');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const token = process.env.GDRIVE_TOKEN;

if (!token) {
    console.error('❌ Error: GDRIVE_TOKEN not found in environment or .ENV file.');
    process.exit(1);
}

function makeRequest(options: https.RequestOptions, postData?: string): Promise<{ statusCode?: number; data: string }> {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function cleanTestFolder(token: string) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'node-script'
    };

    // 1. Search for the google-drive-mock folder
    const folderName = 'google-drive-mock';
    const query = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
    const searchOptions: https.RequestOptions = {
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files?q=${encodeURIComponent(query)}`,
        method: 'GET',
        headers
    };

    const searchRes = await makeRequest(searchOptions);
    if (searchRes.statusCode !== 200) {
        console.error('❌ Failed to search for test folder:', searchRes.data);
        return;
    }

    const searchData = JSON.parse(searchRes.data);
    if (!searchData.files || searchData.files.length === 0) {
        console.log('ℹ️ No google-drive-mock test folder exists yet.');
        return;
    }

    const folderId = searchData.files[0].id;

    // 2. List all files inside the test folder
    const listQuery = `'${folderId}' in parents and trashed=false`;
    const listOptions: https.RequestOptions = {
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files?q=${encodeURIComponent(listQuery)}`,
        method: 'GET',
        headers
    };

    const listRes = await makeRequest(listOptions);
    if (listRes.statusCode !== 200) {
        console.error('❌ Failed to list files in test folder:', listRes.data);
        return;
    }

    const listData = JSON.parse(listRes.data);
    const files = listData.files || [];
    if (files.length === 0) {
        console.log('ℹ️ google-drive-mock test folder is already empty.');
        return;
    }

    console.log(`🧹 Found ${files.length} leftover files/folders. Deleting...`);

    // 3. Delete each file/folder
    for (const file of files) {
        const deleteOptions: https.RequestOptions = {
            hostname: 'www.googleapis.com',
            path: `/drive/v3/files/${file.id}`,
            method: 'DELETE',
            headers
        };
        const deleteRes = await makeRequest(deleteOptions);
        if (deleteRes.statusCode === 204 || deleteRes.statusCode === 200) {
            console.log(`   Deleted: ${file.name} (${file.id})`);
        } else {
            console.warn(`   ⚠️ Failed to delete ${file.name} (${file.id}): Status ${deleteRes.statusCode}`);
        }
    }
}

async function main() {
    console.log('🔄 Verifying GDRIVE_TOKEN...');
    const options: https.RequestOptions = {
        hostname: 'www.googleapis.com',
        path: '/drive/v3/about?fields=user',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'node-script'
        }
    };

    try {
        const res = await makeRequest(options);
        if (res.statusCode === 200) {
            const body = JSON.parse(res.data);
            console.log(`✅ Token is valid. User: ${body.user?.emailAddress || 'Unknown'}`);
            await cleanTestFolder(token!);
            process.exit(0);
        } else {
            console.error(`❌ Token verification failed. Status: ${res.statusCode}`);
            console.error('Response:', res.data);
            process.exit(1);
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('❌ Error verifying token:', msg);
        process.exit(1);
    }
}

main();
