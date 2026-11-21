(function () {
  "use strict";

  var dialog = document.getElementById("machcoll-dialog");
  var openButton = document.getElementById("machcoll-open");
  var closeButton = document.getElementById("machcoll-close");
  var form = document.getElementById("machcoll-form");
  var questionInput = document.getElementById("machcoll-question");
  var sendButton = form.querySelector('button[type="submit"]');
  var messagesElement = document.getElementById("machcoll-messages");
  var suggestions = document.getElementById("machcoll-suggestions");
  var statusElement = document.getElementById("machcoll-status");
  var history = [];
  var deviceKey = "machcoll-device-id";
  var usedKey = "machcoll-used-date";

  function getDeviceId() {
    var existing = localStorage.getItem(deviceKey);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
    var generated =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID().replace(/-/g, "")
        : Math.random().toString(36).slice(2) +
          Math.random().toString(36).slice(2) +
          Date.now().toString(36);
    generated = generated.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (generated.length < 16) generated = (generated + "machcoll-device").slice(0, 64);
    localStorage.setItem(deviceKey, generated);
    return generated;
  }

  var deviceId = getDeviceId();

  function todayUtc() {
    return new Date().toISOString().slice(0, 10);
  }

  function setUsedForToday() {
    localStorage.setItem(usedKey, todayUtc());
  }

  function usedTodayLocally() {
    return localStorage.getItem(usedKey) === todayUtc();
  }

  function lockForToday() {
    questionInput.disabled = true;
    sendButton.disabled = true;
    statusElement.textContent =
      "Your Machcoll question has been used today. Please try again tomorrow.";
  }

  async function refreshServerLimit() {
    try {
      var response = await fetch("/api/chat/status", {
        headers: { "X-Machcoll-Device": deviceId },
      });
      if (!response.ok) return;
      var result = await response.json();
      if (result.canAsk === false) lockForToday();
    } catch (_) {
      if (usedTodayLocally()) lockForToday();
    }
  }

  if (usedTodayLocally()) lockForToday();
  refreshServerLimit();

  function addMessage(text, role, isError) {
    var message = document.createElement("p");
    message.className = "machcoll-bubble " + role + (isError ? " error" : "");
    message.textContent = text;
    messagesElement.appendChild(message);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return message;
  }

  function openChat() {
    if (!dialog.open) dialog.showModal();
    questionInput.focus();
  }

  openButton.addEventListener("click", openChat);
  closeButton.addEventListener("click", function () {
    dialog.close();
  });
  dialog.addEventListener("close", function () {
    openButton.focus();
  });

  suggestions.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    questionInput.value = button.textContent;
    openChat();
    form.requestSubmit();
  });

  questionInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var question = questionInput.value.trim();
    if (!question || sendButton.disabled) return;

    addMessage(question, "user", false);
    if (suggestions.isConnected) suggestions.remove();
    questionInput.value = "";
    questionInput.disabled = true;
    sendButton.disabled = true;
    statusElement.textContent = "Machcoll is checking the published results…";
    var pending = addMessage("Checking the live results…", "assistant", false);

    try {
      var response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "sportsday",
          "X-Machcoll-Device": deviceId,
        },
        body: JSON.stringify({ question: question, history: history.slice(-6) }),
        signal: AbortSignal.timeout(30000),
      });
      var result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Machcoll could not answer right now. Please try again.");
      if (typeof result.answer !== "string" || !result.answer.trim())
        throw new Error("Machcoll returned an empty answer. Please try again.");
      pending.remove();
      addMessage(result.answer, "assistant", false);
      history.push(
        { role: "user", content: question },
        { role: "assistant", content: result.answer },
      );
      history = history.slice(-6);
      setUsedForToday();
      lockForToday();
      statusElement.textContent =
        "Answers use published results. For an official correction, please speak to an event official.";
    } catch (error) {
      pending.remove();
      var message =
        error && error.name === "TimeoutError"
          ? "Machcoll is taking too long to respond. Please try again."
          : error && error.name === "TypeError"
            ? "Could not reach Machcoll. Check your connection and try again."
            : error && error.message
              ? error.message
              : "Machcoll could not answer right now. Please try again.";
      addMessage(message, "assistant", true);
      statusElement.textContent =
        "Your message was not saved. Please try again or speak to an event official.";
    } finally {
      if (usedTodayLocally()) {
        lockForToday();
      } else {
        questionInput.disabled = false;
        sendButton.disabled = false;
        questionInput.focus();
      }
    }
  });
})();
