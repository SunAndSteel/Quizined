// worker.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Check if the message is for capturing the screen
    if (request.action === 'captureAndAnalyze') {
        // Use an async function to handle the promise-based APIs
        (async () => {
            try {
                // Determine target tab id (sender, else active tab)
                let targetTabId = sender.tab?.id;
                if (!targetTabId) {
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    targetTabId = tabs?.[0]?.id;
                }

                if (targetTabId) {
                    chrome.tabs.sendMessage(targetTabId, { action: 'visionStart' });
                }

                // 1. Capture the visible part of the current tab
                const dataUrl = await chrome.tabs.captureVisibleTab(null, {
                    format: 'jpeg',
                    quality: 85
                });

                // Extract the Base64 part from the Data URL
                const base64Image = dataUrl.split(',')[1];

                // 2. Get the proxy URL from storage
                const { proxyUrl } = await chrome.storage.sync.get({
                    // Assuming a different endpoint for vision
                    proxyUrl: "http://localhost:8787/api/ask_vision"
                });

                // 3. Send the screenshot to the local proxy server
                const res = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64Image }) // Send the Base64 part
                });

                if (!res.ok) throw new Error(`Proxy error ${res.status}`);
                const data = await res.json();

                // 4. Send the received answer back to the content script
                if (targetTabId) {
                    chrome.tabs.sendMessage(targetTabId, {
                        action: 'fillFromVision',
                        answer: data.answer
                    });
                    chrome.tabs.sendMessage(targetTabId, { action: 'visionEnd' });
                }
            } catch (err) {
                console.error('[Question Helper Worker] Error:', err);
                try {
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    const tabId = sender.tab?.id || tabs?.[0]?.id;
                    if (tabId) {
                        chrome.tabs.sendMessage(tabId, { action: 'visionError', error: err.message });
                        chrome.tabs.sendMessage(tabId, { action: 'visionEnd' });
                    }
                } catch {}
            }
        })();

        // Return true to indicate that you will send a response asynchronously
        return true;
    }
});