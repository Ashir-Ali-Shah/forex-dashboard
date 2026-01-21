const https = require('https');

const API_KEY = 'AIzaSyCTYjl6pyWtgx9eITXoRiqhSACdVNIAxZo';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.models) {
                console.log('Available Models:');
                json.models.forEach(m => {
                    if (m.supportedGenerationMethods.includes('generateContent')) {
                        console.log(`- ${m.name}`);
                    }
                });
            } else {
                console.log('Error:', json);
            }
        } catch (e) {
            console.error(e);
        }
    });
}).on('error', (err) => {
    console.error('Network Error:', err);
});
