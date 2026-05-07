// Chat shell + voice (Web Speech API → whisper.cpp fallback). Auto-sends after speech.
const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");

const AUTO_SEND_DELAY_MS = 1500;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function append(role, text) {
  const row = document.createElement("div");
  row.className = `msg msg--${role}`;
  row.innerHTML = `<div class="msg__text govbb-text-body">${esc(text)}</div>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}
input.addEventListener("input", () => { autosize(); cancelAutoSend(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

append("bot", "Hi! I'm here to help you find opportunities. Tell me a bit about yourself — your age, what you're studying or working on, and what you're curious about.");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  cancelAutoSend();
  const msg = input.value.trim();
  if (!msg) return;
  append("user", msg);
  input.value = "";
  autosize();
  setTimeout(() => append("bot", "Thanks — the assistant isn't connected yet. In the meantime, you can browse all opportunities below."), 400);
});

let autoSendTimer = null;
function scheduleAutoSend() {
  cancelAutoSend();
  let remaining = Math.ceil(AUTO_SEND_DELAY_MS / 1000);
  micStatus.textContent = `Sending in ${remaining}s… (type or click to cancel)`;
  autoSendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(autoSendTimer); autoSendTimer = null; micStatus.textContent = "";
      if (input.value.trim()) form.requestSubmit();
    } else {
      micStatus.textContent = `Sending in ${remaining}s… (type or click to cancel)`;
    }
  }, 1000);
}
function cancelAutoSend() {
  if (autoSendTimer) { clearInterval(autoSendTimer); autoSendTimer = null; micStatus.textContent = ""; }
}
document.addEventListener("click", (e) => { if (e.target !== micBtn && !micBtn.contains(e.target)) cancelAutoSend(); });

async function ensureMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    micStatus.textContent = `Microphone blocked: ${err.name}. Allow microphone access in your browser settings.`;
    return false;
  }
}

let listening = false;

if (SR) {
  const recog = new SR();
  recog.lang = "en-US";
  recog.interimResults = true;
  recog.continuous = false;

  let baseValue = "";
  recog.addEventListener("result", (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    input.value = (baseValue + " " + final + interim).trim();
    autosize();
    if (final) baseValue = input.value;
  });
  recog.addEventListener("start", () => {
    listening = true; micBtn.classList.add("is-recording");
    micBtn.setAttribute("aria-label", "Stop voice input");
    micStatus.textContent = "Listening… speak now.";
    baseValue = input.value;
  });
  recog.addEventListener("end", () => {
    listening = false; micBtn.classList.remove("is-recording");
    micBtn.setAttribute("aria-label", "Start voice input");
    if (input.value.trim()) scheduleAutoSend(); else micStatus.textContent = "";
    input.focus();
  });
  recog.addEventListener("error", (e) => {
    micStatus.textContent = `Voice error: ${e.error}. ${e.error === "not-allowed" ? "Allow microphone access in browser settings." : ""}`;
    listening = false; micBtn.classList.remove("is-recording");
  });

  micBtn.addEventListener("click", async () => {
    cancelAutoSend();
    if (listening) { recog.stop(); return; }
    if (!(await ensureMicPermission())) return;
    try { recog.start(); } catch (err) { micStatus.textContent = `Could not start: ${err.message}`; }
  });
} else {
  let mediaRecorder = null;
  let chunks = [];
  micBtn.addEventListener("click", async () => {
    cancelAutoSend();
    if (listening) { mediaRecorder?.stop(); return; }
    if (!(await ensureMicPermission())) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.addEventListener("dataavailable", (e) => { if (e.data.size > 0) chunks.push(e.data); });
      mediaRecorder.addEventListener("start", () => {
        listening = true; micBtn.classList.add("is-recording");
        micStatus.textContent = "Recording… click again to stop and transcribe.";
      });
      mediaRecorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((t) => t.stop());
        listening = false; micBtn.classList.remove("is-recording");
        micStatus.textContent = "Transcribing…";
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        try {
          const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({}));
            micStatus.textContent = `Transcription unavailable: ${error || res.statusText}`;
            return;
          }
          const { text } = await res.json();
          input.value = (input.value + " " + (text || "")).trim();
          autosize();
          micStatus.textContent = "";
          if (input.value.trim()) scheduleAutoSend();
        } catch (err) {
          micStatus.textContent = `Transcription failed: ${err.message}`;
        }
      });
      mediaRecorder.start();
    } catch (err) {
      micStatus.textContent = `Could not start recorder: ${err.message}`;
    }
  });
  micStatus.textContent = "Voice uses recorded audio in this browser. Chrome/Edge/Safari give live transcription.";
}
