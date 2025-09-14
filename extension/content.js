(function () {

  // Identify quiz blocks and important elements
  const isQuizFieldset = (fs) =>
    !!fs.querySelector('h3') && !!fs.querySelector('input[name="reponse"]');

  // Prevent duplicate runs per fieldset
  const busy = new WeakSet();
  // Track internal state without touching the DOM
  const state = new WeakMap();
  // Allow temporary disabling via keyboard (disabled by default)
  let enabled = false;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const decodeHTML = (str) => {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = str;
    return textarea.value;
  };
  const typeText = async (input, text) => {
    input.focus();
    input.click();
    await wait(200 + Math.random() * 200);
    for (const char of text) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: char, bubbles: true })
      );
      input.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          inputType: "insertText",
          data: char,
        })
      );
      input.value += char;
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: char,
        })
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: char, bubbles: true })
      );
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (document.activeElement === input) input.blur();
  };

  // Return only visible and non-hidden inputs named "reponse"
  const getAnswerInputs = (fieldset) =>
    Array.from(
      fieldset.querySelectorAll(
        'input[name="reponse"]:not([type="hidden"]):not([hidden])'
      )
    ).filter((i) => i.type !== "hidden" && i.offsetParent !== null);

  // Sanitize fieldset HTML before sending to proxy (remove hidden inputs and values)
  const sanitizeFieldsetHtml = (fieldset) => {
    const clone = fieldset.cloneNode(true);
    clone
      .querySelectorAll(
        'input[type="hidden"], input[hidden], [hidden], [style*="display:none"]'
      )
      .forEach((el) => el.remove());
    clone.querySelectorAll('input').forEach((i) => i.removeAttribute('value'));
    return clone.outerHTML;
  };

  // NEW: Refactored function to fill a quiz fieldset with a given answer.
  // This will be used by the new vision feature.
  const fillQuizWithAnswer = async (fieldset, answer) => {
    if (!fieldset || !answer || answer === "UNKNOWN") return false;

    const inputs = getAnswerInputs(fieldset);
    if (!inputs.length) return false;

    const choiceInputs = inputs.filter((i) => ["radio", "checkbox"].includes(i.type));
    let filled = false;

    if (choiceInputs.length > 1) {
      console.debug("[Question Helper] Matching choice for:", answer);
      const matchText = answer.toLowerCase();
      const match = choiceInputs.find((input) => {
        const label = fieldset.querySelector(`label[for="${input.id}"]`) || input.closest("label");
        const text = label?.textContent || input.value;
        return text.trim().toLowerCase().includes(matchText);
      });

      if (match) {
        match.focus();
        match.click();
        if (document.activeElement === match) match.blur();
        console.debug("[Question Helper] Selected option", match);
        filled = true;
      }
    } else if (inputs.length > 0 && !["radio", "checkbox"].includes(inputs[0].type)) {
      console.debug("[Question Helper] Filling free-text answer", answer);
      const input = inputs[0];
      await typeText(input, answer);
      filled = true;
    }

    return filled;
  }

  // Track whether a vision analysis is ongoing to suppress HTML-triggered calls
  let visionActive = false;
  let visionFilling = false;

  // Global click handler: when a fieldset is clicked, answer but do not submit
  // This is your original function with its retry logic preserved.
  const handleClick = async (e) => {
    // Block if manually disabled or if a vision flow is active
    if (!enabled || visionActive) return;
    if (e.target.matches('button[type="submit"], input[type="submit"]')) return;
    const fs = e.target.closest("fieldset");
    if (!fs || !isQuizFieldset(fs) || busy.has(fs)) return;

    console.debug("[Question Helper] Fieldset clicked", fs);
    busy.add(fs);
    state.set(fs, "pending");

    try {
      const { proxyUrl } = await chrome.storage.sync.get({
        proxyUrl: "http://localhost:8787/api/ask"
      });
      if (!proxyUrl) {
        console.warn("[Question Helper] Set proxy URL in options.");
        state.set(fs, "idle");
        busy.delete(fs);
        return;
      }

      // Send the raw fieldset HTML
      const payload = {
        mode: "fieldset",
        url: location.href,
        locale: document.documentElement.lang || navigator.language || "fr",
        html: sanitizeFieldsetHtml(fs),
        instruction: [
          "You receive a quiz <fieldset> HTML block with the question and its inputs.",
          "If multiple-choice options are present, answer with the exact text of the correct option.",
          "Otherwise return the concise free-text answer.",
          "Return ONLY the final answer string; no quotes or extra words.",
          "If uncertain, return UNKNOWN."
        ].join(" ")
      };

      console.debug("[Question Helper] Sending payload to proxy", payload);
      const r = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error(`Proxy error ${r.status}`);
      const data = await r.json();
      console.debug("[Question Helper] Proxy response", data);

      const answer = decodeHTML(data.answer || "")
        .replace(/[\r\n]+/g, " ")
        .trim();
      const inputs = getAnswerInputs(fs);

      let filled = false;
      if (answer && answer !== "UNKNOWN" && inputs.length) {
        const choiceInputs = inputs.filter((i) => ["radio", "checkbox"].includes(i.type));

        if (choiceInputs.length > 1) {
          console.debug("[Question Helper] Detected multiple-choice question");
          const matchText = answer.toLowerCase();
          const match = choiceInputs.find((input) => {
            const label =
              fs.querySelector(`label[for="${input.id}"]`) || input.closest("label");
            const text = label?.textContent || input.value;
            return text.trim().toLowerCase().includes(matchText);
          });
          if (match) {
            match.focus();
            match.click();
            if (document.activeElement === match) match.blur();
            console.debug("[Question Helper] Selected option", match);
            filled = true;
          } else {
            console.warn("[Question Helper] No matching choice for", answer);

            try {
              const options = choiceInputs.map((input) => {
                const label =
                  fs.querySelector(`label[for="${input.id}"]`) ||
                  input.closest("label");
                return (label?.textContent || input.value || "").trim();
              });

              const retryPayload = {
                mode: "fieldset",
                url: location.href,
                locale:
                  document.documentElement.lang || navigator.language || "fr",
                html: sanitizeFieldsetHtml(fs),
                previousAnswer: answer,
                options,
                instruction: [
                  "Previous answer was incorrect.",
                  "Here are the available options.",
                  "Respond with the exact text of the correct option.",
                  "Return ONLY the final answer string; no quotes or extra words.",
                  "If uncertain, return UNKNOWN."
                ].join(" "),
              };

              console.debug(
                "[Question Helper] Retrying with payload",
                retryPayload
              );
              const r2 = await fetch(proxyUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(retryPayload),
              });
              if (r2.ok) {
                const data2 = await r2.json();
                console.debug(
                  "[Question Helper] Proxy retry response",
                  data2
                );
                const answer2 = decodeHTML(data2.answer || "")
                  .replace(/[\r\n]+/g, " ")
                  .trim();
                const match2 = choiceInputs.find((input) => {
                  const label =
                    fs.querySelector(`label[for="${input.id}"]`) ||
                    input.closest("label");
                  const text = label?.textContent || input.value;
                  return text
                    .trim()
                    .toLowerCase()
                    .includes(answer2.toLowerCase());
                });
                if (match2) {
                  match2.focus();
                  match2.click();
                  if (document.activeElement === match2) match2.blur();
                  console.debug(
                    "[Question Helper] Selected option after retry",
                    match2
                  );
                  filled = true;
                } else {
                  console.warn(
                    "[Question Helper] Still no matching choice for",
                    answer2
                  );
                  choiceInputs.forEach((input) => {
                    if (input.checked) {
                      input.focus();
                      input.click();
                      if (document.activeElement === input) input.blur();
                      if (input.checked) {
                        input.checked = false;
                        input.dispatchEvent(
                          new Event("change", { bubbles: true })
                        );
                      }
                    }
                  });
                }
              } else {
                console.warn(
                  `[Question Helper] Retry proxy error ${r2.status}`
                );
              }
            } catch (retryErr) {
              console.error("[Question Helper] Retry failure:", retryErr);
            }
          }
        } else if (
          inputs.length > 0 &&
          !["radio", "checkbox"].includes(inputs[0].type)
        ) {
          console.debug("[Question Helper] Filling free-text answer", answer);
          const input = inputs[0];
          await typeText(input, answer);
          filled = true;
        } else {
          console.warn("[Question Helper] No suitable input for answer", { inputs });
        }
      }

      if (filled) {
        console.debug(
          "[Question Helper] Answer filled; awaiting manual submission"
        );
        state.set(fs, "filled");
        // Disable to prevent a second call when user clicks to check/submit
        enabled = false;
      } else {
        console.warn("[Question Helper] Could not fill answer", { answer });
        state.set(fs, "uncertain");
      }
    } catch (err) {
      console.error("[Question Helper] Failure:", err);
      state.set(fs, "error");
    } finally {
      // Allow another attempt if the page stays on this question
      setTimeout(() => {
        busy.delete(fs);
        state.delete(fs);
      }, 500);
    }
  };

  document.addEventListener("click", handleClick, true);

  // NEW: Listener for messages from the background worker (for screenshot feature)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'visionStart') {
      visionActive = true;
      return;
    }
    if (request.action === 'visionEnd') {
      // Only clear if not currently filling
      if (!visionFilling) visionActive = false;
      return;
    }
    if (request.action === 'fillFromVision' && request.answer) {
      console.debug("[Question Helper] Received answer from vision:", request.answer);
      // This implementation finds the first quiz fieldset on the page and tries to fill it.
      const firstFieldset = Array.from(document.querySelectorAll("fieldset")).find(isQuizFieldset);
      if (firstFieldset) {
        // Clean possible code fences/backticks coming from the model
        const cleaned = String(request.answer)
          .replace(/^```[a-z]*\n?|```$/gi, "")
          .replace(/^`|`$/g, "")
          .trim();
        // Fill while keeping visionActive true to suppress HTML calls
        visionFilling = true;
        fillQuizWithAnswer(firstFieldset, cleaned).then((filled) => {
          if (filled) enabled = false;
        }).finally(() => {
          visionFilling = false;
          visionActive = false;
        });
      } else {
        console.warn("[Question Helper] No fieldset found for vision answer.");
      }
    } else if (request.action === 'visionError') {
      console.error("[Question Helper] Vision analysis failed:", request.error);
    }
  });

  // MODIFIED: Keyboard shortcuts now include screenshot trigger
  document.addEventListener("keydown", (e) => {
    // Toggle enable/disable with Left Shift key
    if (e.code === "ShiftLeft" && !e.repeat) {
      enabled = !enabled;
      console.debug(`[Question Helper] ${enabled ? "Enabled" : "Disabled"} via key "ShiftLeft"`);
    }
    // This shortcut now sends a message to the background worker for analysis
    if ((e.key === "<" || e.code === "IntlBackslash") && enabled) {
      console.debug("[Question Helper] '<' key pressed, requesting screenshot analysis.");
      chrome.runtime.sendMessage({ action: 'captureAndAnalyze' });
    }
  });
})();