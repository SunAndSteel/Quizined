const $ = (s) => document.querySelector(s);
const status = $("#status");
const proxy = $("#proxyUrl");

// Load saved
chrome.storage.sync.get(
    { proxyUrl: "http://localhost:8787/api/ask" },
    (v) => {
        proxy.value = v.proxyUrl;
    }
);

// Save
$("#save").addEventListener("click", async () => {
    await chrome.storage.sync.set({ proxyUrl: proxy.value.trim() });
    status.textContent = "Saved.";
    setTimeout(() => (status.textContent = ""), 1500);
});

// Quick test call
$("#test").addEventListener("click", async () => {
    status.textContent = "Testing…";
    try {
        const body = {
            mode: "fieldset",
            url: "http://localhost/test",
            locale: "fr",
            html: `<fieldset id="field" class="sujet6">
              <legend>Question 1/1</legend>
              <h3>Quel mot clé JavaScript pour déclarer une variable locale mutable ?</h3>
              <label><input type="text" name="reponse" value=""></label>
              <input id="submit" type="submit" value="Valider">
            </fieldset>`,
            instruction: "Return only the single-word answer; no quotes."
        };
        const r = await fetch(proxy.value.trim(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        status.textContent = `OK. Example answer: ${data.answer || "(empty)"}`;
    } catch (e) {
        status.innerHTML = `<span class="warn">Proxy test failed:</span> ${e.message}`;
    }
});
