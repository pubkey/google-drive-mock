import express from 'express';

const app = express();
const port = 8080;

app.use(express.static(__dirname));

app.listen(port, () => {
    console.log(`Login example running at http://localhost:${port}/google-login.html`);
    console.log('NOTE: Ensure "http://localhost:8080" is added to your Authorized JavaScript origins in Google Cloud Console.');
});
