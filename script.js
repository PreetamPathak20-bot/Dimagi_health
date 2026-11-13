"use strict";

// ---- Config -------------------------------------------------------------
const API_BASE = "http://127.0.0.1:2200";
const SCORE_MAX = 10;          // upper end of the gauge; change if your model's scale differs
const MIN_LOADING_MS = 500;    // keeps the loading animation from flickering

const NUMBER_FIELDS = {
  age: { min: 10, max: 100, integer: true, label: "Age" },
  avg_daily_usage_hours: { min: 0, max: 24, label: "Daily usage" },
  daily_unlocks: { min: 0, max: 100, integer: true, label: "Phone unlocks" },
  study_hours: { min: 0, max: 24, label: "Study hours" },
  physical_activity_hours: { min: 0, max: 24, label: "Physical activity" },
  sleep_hours_per_night: { min: 0, max: 24, label: "Sleep hours" },
};
const SELECT_FIELDS = [
  "gender", "academic_level", "most_used_platform", "purpose_of_use", "stress_level",
];
const TEXT_FIELDS = ["country"];

// ---- Elements -----------------------------------------------------------
const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const btnLabel = submitBtn.querySelector(".btn-label");
const formAlert = document.getElementById("form-alert");
const resultCard = document.getElementById("result-card");
const gaugeFill = document.getElementById("gauge-fill");
const scoreValue = document.getElementById("score-value");
const scoreMax = document.getElementById("score-max");
const scoreBand = document.getElementById("score-band");
const scoreNote = document.getElementById("score-note");
const errorTitle = document.getElementById("error-title");
const errorMessage = document.getElementById("error-message");

scoreMax.textContent = `/ ${SCORE_MAX}`;

// ---- Helpers ------------------------------------------------------------
const setState = (state) => { resultCard.dataset.state = state; };

function setFieldError(name, message) {
  const slot = form.querySelector(`.error[data-for="${name}"]`);
  const field = form.elements[name]?.closest(".field");
  if (!slot || !field) return false;
  slot.textContent = message || "";
  field.classList.toggle("invalid", Boolean(message));
  return true;
}

function clearErrors() {
  form.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".field.invalid").forEach((el) => el.classList.remove("invalid"));
  formAlert.hidden = true;
  formAlert.textContent = "";
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  btnLabel.textContent = isLoading ? "Predicting…" : "Predict score";
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Validation & payload ----------------------------------------------
function buildPayload() {
  const payload = {};
  const errors = {};

  for (const [name, rule] of Object.entries(NUMBER_FIELDS)) {
    const raw = form.elements[name].value.trim();
    if (raw === "") { errors[name] = `${rule.label} is required.`; continue; }
    const value = Number(raw);
    if (Number.isNaN(value)) { errors[name] = "Enter a valid number."; continue; }
    if (rule.integer && !Number.isInteger(value)) { errors[name] = "Enter a whole number."; continue; }
    if (value < rule.min || value > rule.max) {
      errors[name] = `Enter a value between ${rule.min} and ${rule.max}.`; continue;
    }
    payload[name] = value;
  }

  for (const name of SELECT_FIELDS) {
    const value = form.elements[name].value;
    if (!value) errors[name] = "Select an option.";
    else payload[name] = value;
  }

  for (const name of TEXT_FIELDS) {
    const value = form.elements[name].value.trim();
    if (!value) errors[name] = "Country is required.";
    else payload[name] = value;
  }

  return { payload, errors };
}

// ---- Result rendering ---------------------------------------------------
function describeScore(score) {
  const ratio = score / SCORE_MAX;
  if (ratio < 0.5) return { color: "#ef8a69", band: "Needs attention", note: "The estimate is on the lower side for this profile." };
  if (ratio < 0.7) return { color: "#e8b23c", band: "Moderate", note: "The estimate sits in the middle of the range." };
  return { color: "#4fd19a", band: "Healthy range", note: "The estimate is on the higher side for this profile." };
}

function showResult(score) {
  const { color, band, note } = describeScore(score);
  resultCard.style.setProperty("--gauge-color", color);
  scoreBand.textContent = band;
  scoreNote.textContent = note;
  setState("success");

  // Animate gauge + count-up (reset first so repeat predictions replay)
  gaugeFill.style.transition = "none";
  gaugeFill.style.strokeDashoffset = 100;
  void gaugeFill.getBoundingClientRect();
  gaugeFill.style.transition = "";
  const fraction = Math.min(Math.max(score / SCORE_MAX, 0), 1);
  gaugeFill.style.strokeDashoffset = 100 - fraction * 100;

  const start = performance.now();
  const duration = 1200;
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    scoreValue.textContent = (score * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showError(title, message) {
  errorTitle.textContent = title;
  errorMessage.textContent = message;
  setState("error");
}

// ---- Error handling -----------------------------------------------------
// FastAPI 422 -> { detail: [{ loc: ["body", "age"], msg: "..." }, ...] }
function applyServerValidation(detail) {
  const leftovers = [];
  detail.forEach((item) => {
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
    const message = item.msg || "Invalid value.";
    if (!field || !setFieldError(field, message)) leftovers.push(message);
  });
  formAlert.textContent = leftovers.length
    ? leftovers.join(" ")
    : "Some answers were not accepted. Check the highlighted fields.";
  formAlert.hidden = false;
}

// ---- Submit -------------------------------------------------------------
async function submitForm(event) {
  event.preventDefault();
  clearErrors();

  const { payload, errors } = buildPayload();
  const names = Object.keys(errors);
  if (names.length) {
    names.forEach((n) => setFieldError(n, errors[n]));
    formAlert.textContent = "Fix the highlighted fields and try again.";
    formAlert.hidden = false;
    form.elements[names[0]].focus();
    return;
  }

  setLoading(true);
  setState("loading");
  if (window.matchMedia("(max-width: 900px)").matches) {
    resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const started = performance.now();
  try {
    const response = await fetch(`${API_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = null;
    try { data = await response.json(); } catch { /* non-JSON body */ }

    const elapsed = performance.now() - started;
    if (elapsed < MIN_LOADING_MS) await wait(MIN_LOADING_MS - elapsed);

    if (response.status === 422 && Array.isArray(data?.detail)) {
      applyServerValidation(data.detail);
      showError("Check your answers", "The server rejected one or more fields. Fix them and try again.");
      return;
    }
    if (!response.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : `The server responded with status ${response.status}.`;
      showError("Prediction failed", detail);
      return;
    }

    const score = data?.predicted_mental_health_score;
    if (typeof score !== "number") {
      showError("Unexpected response", "The server did not return a score.");
      return;
    }
    showResult(score);
  } catch (err) {
    showError("Can’t reach the server", `Make sure the API is running at ${API_BASE} (uvicorn main:app --port 2200 --reload), then try again.`);
  } finally {
    setLoading(false);
  }
}

// ---- Events -------------------------------------------------------------
form.addEventListener("submit", submitForm);
form.addEventListener("reset", () => { clearErrors(); setState("idle"); });
document.getElementById("retry-btn").addEventListener("click", () => form.requestSubmit());
form.addEventListener("input", (e) => {
  const name = e.target.name;
  if (name) setFieldError(name, "");
});
