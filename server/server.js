// server.js
// Run with: node server.js
// Requires Node 18+ (built-in fetch)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// ----- Config -----
const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // text output model
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 16);

// CORS: reflect the request origin (fine for local dev). Tighten if you want.
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));

if (!OPENAI_API_KEY) {
    console.error('ERROR: Set OPENAI_API_KEY in your environment (or .env).');
    process.exit(1);
}

// ----- Helpers -----
function buildMessagesFromBody(body) {
    const { question, system, html, url, locale, instruction, mode } = body || {};
    const messages = [];

    if (html && mode === 'fieldset') {
        messages.push({
            role: 'system',
            content:
                (system || 'You are a precise quiz parser.') +
                ' ' +
                (instruction ||
                    'Extract the visible question from the provided <fieldset> HTML and return ONLY the short free-text answer. No quotes, no extra words. If uncertain, return UNKNOWN.')
        });
        messages.push({
            role: 'user',
            content:
                `Page URL: ${url || '(unknown)'}
Locale: ${locale || 'fr'}

FIELDSET HTML:
${html}`
        });
    } else {
        messages.push({
            role: 'system',
            content: system || 'Answer briefly with only the final keyword or short phrase.'
        });
        messages.push({
            role: 'user',
            content: question || ''
        });
    }

    return messages;
}

// Extract best-effort text from Responses API payload
function extractText(respJson) {
    // Newer Responses format usually has output_text
    if (typeof respJson?.output_text === 'string' && respJson.output_text.trim()) {
        return respJson.output_text.trim();
    }
    // Fallback: walk output[0].content[0].text
    const maybe =
        respJson?.output?.[0]?.content?.find?.(c => typeof c?.text === 'string')?.text ||
        respJson?.output?.[0]?.content?.[0]?.text;
    return (maybe || '').toString().trim();
}

// ----- Routes -----

app.get('/health', (_req, res) => {
    res.json({ ok: true, model: OPENAI_MODEL });
});

app.get('/debug/openai', async (_req, res) => {
    const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            input: [{ role: 'user', content: 'ping' }],
            max_output_tokens: 16,
            temperature: 0
        })
    });
    const text = await r.text();
    res.status(r.status).json({
        status: r.status,
        headers: {
            'x-ratelimit-limit-requests': r.headers.get('x-ratelimit-limit-requests'),
            'x-ratelimit-remaining-requests': r.headers.get('x-ratelimit-remaining-requests'),
            'x-ratelimit-reset-requests': r.headers.get('x-ratelimit-reset-requests')
        },
        body: safeJson(text)
    });

    function safeJson(s) { try { return JSON.parse(s); } catch { return { raw: s }; } }
});


app.post('/api/ask', async (req, res) => {
    console.log('[proxy] /api/ask', req.body);
    try {
        const messages = buildMessagesFromBody(req.body || {});
        console.debug('[proxy] Built messages', messages);

        const r = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                // The Responses API accepts a unified "input" message array
                // See: platform.openai.com/docs/api-reference/responses
                input: messages,
                max_output_tokens: MAX_OUTPUT_TOKENS
            })
        });

        console.debug('[proxy] OpenAI status', r.status);
        if (!r.ok) {
            const errorText = await r.text().catch(() => '');
            console.error('[proxy] OpenAI error', r.status, errorText);
            return res.status(r.status).json({
                error: 'OpenAI error',
                status: r.status,
                detail: errorText
            });
        }

        const data = await r.json();
        const text = extractText(data);
        console.log('[proxy] Answer', text);
        return res.json({ answer: text });
    } catch (err) {
        console.error('[proxy] Failure', err);
        return res.status(500).json({ error: 'Proxy failure' });
    }
});

app.post('/api/ask_vision', async (req, res) => {
    const { image } = req.body || {};
    if (!image) {
        return res.status(400).json({ error: 'Image data URL is required.' });
    }

    console.log('[proxy] /api/ask_vision received image');
    try {
        // Reconstruire une data URL si on ne reçoit que le Base64
        const imageDataUrl = image.startsWith('data:')
            ? image
            : `data:image/jpeg;base64,${image}`;

        // Messages pour l'API Responses avec image
        const messages = [{
            role: 'user',
            content: [
                {
                    type: 'input_text',
                    text: 'Analyze this quiz screenshot. Determine the question and options, then provide the exact text of the correct answer. If it is a fill-in-the-blank, provide the concise answer. Return ONLY the answer string. If uncertain, return UNKNOWN.'
                },
                {
                    type: 'input_image',
                    image_url: imageDataUrl
                }
            ]
        }];
        console.debug('[proxy] Built vision messages');

        const r = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: OPENAI_MODEL, // gpt-4o-mini 
                input: messages,
                max_output_tokens: MAX_OUTPUT_TOKENS
            })
        });

        console.debug('[proxy] OpenAI vision status', r.status);
        if (!r.ok) {
            const errorText = await r.text().catch(() => '');
            console.error('[proxy] OpenAI vision error', r.status, errorText);
            return res.status(r.status).json({
                error: 'OpenAI vision error',
                status: r.status,
                detail: errorText
            });
        }

        const data = await r.json();
        const text = extractText(data);
        console.log('[proxy] Vision Answer', text);
        return res.json({ answer: text });
    } catch (err) {
        console.error('[proxy] Vision Failure', err);
        return res.status(500).json({ error: 'Proxy failure' });
    }
});


// ----- Start -----
app.listen(PORT, () => {
    console.log(`Proxy listening on http://localhost:${PORT}`);
});
