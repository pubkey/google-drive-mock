import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Load .ENV manually to avoid devDependency issues if dotenv isn't available in this context, 
// though project seems to use it.
const envPath = path.resolve(__dirname, '../.ENV');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, ''); // strip quotes
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

// Simple check only if running real tests (though script is likely invoked specifically for that)
// The user asked to run this BEFORE test:real.

console.log('🔄 Verifying GDRIVE_TOKEN...');

const options = {
    hostname: 'www.googleapis.com',
    path: '/drive/v3/about?fields=user',
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'node-script'
    }
};

const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode === 200) {
            try {
                const body = JSON.parse(data);
                console.log(`✅ Token is valid. User: ${body.user?.emailAddress || 'Unknown'}`);
                process.exit(0);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('❌ Error parsing response:', msg);
                process.exit(1);
            }
        } else {
            console.error(`❌ Token verification failed. Tell the human to update the .ENV file with a valid token. Status: ${res.statusCode}`);
            console.error('Response:', data);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error(`❌ Request error: ${e.message}`);
    process.exit(1);
});

req.end();
