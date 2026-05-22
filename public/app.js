const STORAGE_KEY = "landingpage-app-builder-v1";
const SETTINGS_KEY = "landingpage-app-builder-settings-v1";
const projectCount = 10;
const staleStatusPatterns = [
  /Verbindung zu Anthropic konnte nicht hergestellt werden/i,
  /Bitte Key erneut speichern und Verbindung testen/i,
  /API-Key-Format nicht lesbar/i,
];

const defaultProjects = Array.from({ length: projectCount }, (_, index) => ({
  id: crypto.randomUUID(),
  name: index === 0 ? "SMART APP & Landingpage Builder" : `Landing Page ${index + 1}`,
  templateUrl: "",
  contentUrl: "",
  screenshotUrl: "",
  audience: "",
  manualContent: "",
  sourceContentText: "",
  templateAnalysis: null,
  contentAnalysis: null,
  briefMarkdown: "",
  generatedHtml: "",
  status: [],
}));

let shouldSaveMigratedState = false;
let state = loadState();
let settings = loadSettings();
let activeIndex = 0;
let apiKeyUi = {
  visible: false,
  connected: false,
  loading: false,
  draft: "",
};

const elements = {
  projectList: document.querySelector("#projectList"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  progressMeter: document.querySelector("#progressMeter"),
  pageTitle: document.querySelector("#pageTitle"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  toggleApiKeyButton: document.querySelector("#toggleApiKeyButton"),
  saveApiKeyButton: document.querySelector("#saveApiKeyButton"),
  connectAiButton: document.querySelector("#connectAiButton"),
  disconnectAiButton: document.querySelector("#disconnectAiButton"),
  useAiInput: document.querySelector("#useAiInput"),
  nameInput: document.querySelector("#nameInput"),
  templateUrlInput: document.querySelector("#templateUrlInput"),
  contentUrlInput: document.querySelector("#contentUrlInput"),
  screenshotUrlInput: document.querySelector("#screenshotUrlInput"),
  audienceInput: document.querySelector("#audienceInput"),
  manualContentInput: document.querySelector("#manualContentInput"),
  statusLog: document.querySelector("#statusLog"),
  analyzeButton: document.querySelector("#analyzeButton"),
  testAiButton: document.querySelector("#testAiButton"),
  aiConnectionStatus: document.querySelector("#aiConnectionStatus"),
  exportButton: document.querySelector("#exportButton"),
  templateBlueprint: document.querySelector("#templateBlueprint"),
  contentBlueprint: document.querySelector("#contentBlueprint"),
  sourceContentOutput: document.querySelector("#sourceContentOutput"),
  previewFrame: document.querySelector("#previewFrame"),
  htmlOutput: document.querySelector("#htmlOutput"),
  briefOutput: document.querySelector("#briefOutput"),
  copyButton: document.querySelector("#copyButton"),
  clearOutputButton: document.querySelector("#clearOutputButton"),
  copySourceButton: document.querySelector("#copySourceButton"),
  clearSourceButton: document.querySelector("#clearSourceButton"),
  copyBriefButton: document.querySelector("#copyBriefButton"),
  downloadButton: document.querySelector("#downloadButton"),
  downloadBriefButton: document.querySelector("#downloadBriefButton"),
  exportProjectButton: document.querySelector("#exportProjectButton"),
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length === projectCount) {
      return saved.map((project, index) => ({
        ...defaultProjects[index],
        ...migrateProject(project, index),
      }));
    }
  } catch {
    // Ignore malformed local data.
  }
  return defaultProjects;
}

function migrateProject(project, index) {
  const migrated = { ...project };
  if (index === 0 && (!migrated.name || migrated.name === "SMART Landingpage Builder" || migrated.name === "SMART APP&Landingpage Builder")) {
    migrated.name = "SMART APP & Landingpage Builder";
  }
  if (Array.isArray(migrated.status)) {
    const cleanedStatus = migrated.status.filter((message) => !staleStatusPatterns.some((pattern) => pattern.test(String(message))));
    if (cleanedStatus.length !== migrated.status.length) {
      migrated.status = cleanedStatus;
      shouldSaveMigratedState = true;
    }
  }
  migrated.sourceContentText = migrated.sourceContentText || "";
  return migrated;
}

function loadSettings() {
  try {
    const legacy = JSON.parse(sessionStorage.getItem(SETTINGS_KEY) || "{}");
    const loaded = {
      useAi: true,
      apiKey: "",
      ...legacy,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
    if (loaded.apiKey?.includes("•")) {
      loaded.apiKey = "";
    } else {
      loaded.apiKey = normalizeApiKey(loaded.apiKey || "");
    }
    return loaded;
  } catch {
    return { useAi: true, apiKey: "" };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

if (shouldSaveMigratedState) saveState();

function activeProject() {
  return state[activeIndex];
}

function setProjectValue(key, value) {
  activeProject()[key] = value;
  if (key === "name") elements.pageTitle.textContent = value || `Landing Page ${activeIndex + 1}`;
  saveState();
  renderProjectList();
}

function isReady(project) {
  return Boolean(project.generatedHtml && project.templateAnalysis && project.contentAnalysis);
}

function renderProjectList() {
  elements.projectList.innerHTML = "";
  state.forEach((project, index) => {
    const button = document.createElement("button");
    button.className = `project-item${index === activeIndex ? " active" : ""}`;
    button.innerHTML = `
      <span class="project-number">${index + 1}</span>
      <span>
        <strong>${escapeHtml(project.name || `Landing Page ${index + 1}`)}</strong>
        <span>${project.templateUrl ? "Vorlage gesetzt" : "Vorlage fehlt"} · ${project.contentUrl || project.manualContent ? "Inhalt gesetzt" : "Inhalt fehlt"}</span>
      </span>
      <i class="state-dot${isReady(project) ? " ready" : ""}" aria-hidden="true"></i>
    `;
    button.addEventListener("click", () => {
      activeIndex = index;
      render();
    });
    elements.projectList.append(button);
  });

  const ready = state.filter(isReady).length;
  const percent = Math.round((ready / projectCount) * 100);
  elements.progressLabel.textContent = `${ready} von ${projectCount} bereit`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressMeter.style.width = `${percent}%`;
}

function render() {
  const project = activeProject();
  elements.pageTitle.textContent = project.name || `Landing Page ${activeIndex + 1}`;
  elements.useAiInput.checked = settings.useAi !== false;
  renderApiKeyManager();
  elements.nameInput.value = project.name || "";
  elements.templateUrlInput.value = project.templateUrl || "";
  elements.contentUrlInput.value = project.contentUrl || "";
  elements.screenshotUrlInput.value = project.screenshotUrl || "";
  elements.audienceInput.value = project.audience || "";
  elements.manualContentInput.value = project.manualContent || "";
  renderStatus(project.status);
  renderBlueprints();
  renderSourceContent();
  renderBriefing();
  updateOutput(project.generatedHtml || buildLandingPage(project));
  renderProjectList();
}

function renderApiKeyManager() {
  const savedKey = normalizeApiKey(settings.apiKey);
  const draftKey = apiKeyUi.draft;
  const hasDraft = draftKey.length > 0;
  const displayRaw = apiKeyUi.visible ? draftKey || savedKey : draftKey;

  elements.apiKeyInput.readOnly = Boolean(!apiKeyUi.visible && savedKey && !hasDraft);
  elements.apiKeyInput.type = apiKeyUi.visible || !savedKey || hasDraft ? (apiKeyUi.visible ? "text" : "password") : "text";
  elements.apiKeyInput.value = !apiKeyUi.visible && savedKey && !hasDraft ? maskApiKey(savedKey) : displayRaw;
  elements.toggleApiKeyButton.classList.toggle("visible", apiKeyUi.visible);
  elements.toggleApiKeyButton.setAttribute("aria-label", apiKeyUi.visible ? "API-Key verbergen" : "API-Key anzeigen");
  elements.connectAiButton.textContent = apiKeyUi.connected ? "Verbindung ok" : "Verbindung";
  elements.connectAiButton.classList.toggle("connected", apiKeyUi.connected);
  elements.connectAiButton.classList.toggle("loading", apiKeyUi.loading);
  elements.testAiButton.classList.toggle("loading", apiKeyUi.loading);
}

function renderStatus(messages = []) {
  elements.statusLog.innerHTML = messages.length
    ? messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("")
    : "<p>Noch keine Analyse gestartet.</p>";
}

function renderBlueprints() {
  const project = activeProject();
  elements.templateBlueprint.innerHTML = project.templateAnalysis
    ? renderTemplateAnalysis(project.templateAnalysis)
    : `<div class="insight"><strong>Keine Vorlage analysiert</strong><span>Füge einen Link ein und starte die Analyse.</span></div>`;

  elements.contentBlueprint.innerHTML = project.contentAnalysis
    ? renderContentAnalysis(project.contentAnalysis)
    : `<div class="insight"><strong>Keine Inhalte extrahiert</strong><span>Nutze eine Inhaltsquelle oder manuelle Inhalte.</span></div>`;
}

function renderBriefing() {
  const project = activeProject();
  elements.briefOutput.value = project.briefMarkdown || buildFallbackBrief(project);
}

function renderTemplateAnalysis(analysis) {
  return `
    <div class="insight"><strong>Struktur</strong><span>${analysis.sectionCount} Abschnitte, ${analysis.ctas.length} Calls-to-Action, Stil: ${analysis.style}</span></div>
    <div class="insight"><strong>Headline-Muster</strong><span>${escapeHtml(analysis.headline || "Nicht gefunden")}</span></div>
    <div class="insight"><strong>Abschnittsfolge</strong><ul>${analysis.sections.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="insight"><strong>CTA-Texte</strong><ul>${analysis.ctas.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Keine erkannt</li>"}</ul></div>
  `;
}

function renderContentAnalysis(analysis) {
  return `
    <div class="insight"><strong>Angebot</strong><span>${escapeHtml(analysis.offer)}</span></div>
    <div class="insight"><strong>Nutzenversprechen</strong><ul>${analysis.benefits.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="insight"><strong>Features</strong><ul>${analysis.features.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="insight"><strong>Proof / Details</strong><ul>${analysis.proof.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
  `;
}

function renderSourceContent() {
  const project = activeProject();
  const sourceText = project.sourceContentText || "";
  elements.sourceContentOutput.value = sourceText || "Noch kein Quelleninhalt ausgelesen. Trage eine Inhaltsquelle ein und starte die Analyse.";
}

function updateOutput(html) {
  elements.htmlOutput.value = html;
  elements.previewFrame.srcdoc = html;
}

async function analyzeActiveProject() {
  const project = activeProject();
  project.status = [];
  logStatus("Analyse gestartet.");

  let templateText = "";
  if (project.templateUrl) {
    logStatus("Vorlage wird ausgelesen.");
    const result = await readUrl(project.templateUrl);
    templateText = result.text || "";
    logStatus(result.ok ? "Vorlage erfolgreich gelesen." : `Vorlage nicht vollständig lesbar: ${result.error || result.status}`);
  }

  let contentText = project.manualContent || "";
  if (project.contentUrl) {
    logStatus("Inhaltsquelle wird ausgelesen.");
    const result = await readUrl(project.contentUrl);
    contentText = [result.text || "", project.manualContent || ""].filter(Boolean).join("\n\n");
    project.sourceContentText = formatSourceContent(contentText);
    logStatus(result.ok ? "Inhaltsquelle erfolgreich gelesen." : `Inhaltsquelle nicht vollständig lesbar: ${result.error || result.status}`);
  } else if (project.manualContent) {
    project.sourceContentText = formatSourceContent(project.manualContent);
    logStatus("Manuelle Inhalte werden verwendet.");
  } else {
    project.sourceContentText = "";
  }

  if (settings.useAi !== false) {
    const aiKey = getActiveApiKey();
    if (aiKey) {
      logStatus("KI-Erstellung mit Anthropic läuft.");
      const aiResult = await generateWithAi(project, templateText, contentText, aiKey);
      if (aiResult.ok) {
        project.templateAnalysis = aiResult.templateAnalysis;
        project.contentAnalysis = aiResult.contentAnalysis;
        project.generatedHtml = aiResult.landingPageHtml;
        project.briefMarkdown = aiResult.briefMarkdown;
        logStatus("KI-Landingpage und Briefing wurden erstellt.");
      } else {
        logStatus(`KI nicht erfolgreich: ${aiResult.error}`);
        project.generatedHtml = "";
        project.briefMarkdown = buildFailureBrief(project, aiResult.error);
        saveState();
        render();
        activateTab("briefing");
        return;
      }
    } else {
      logStatus("Kein API-Key eingegeben. Fallback-Generator wird verwendet.");
      applyFallbackGeneration(project, templateText, contentText);
    }
  } else {
    applyFallbackGeneration(project, templateText, contentText);
    logStatus("Regelbasierte Landingpage wurde generiert.");
  }

  saveState();
  render();
  activateTab("preview");
}

function applyFallbackGeneration(project, templateText, contentText) {
  project.templateAnalysis = analyzeTemplate(templateText, project.templateUrl);
  project.contentAnalysis = analyzeContent(contentText, project);
  project.generatedHtml = buildLandingPage(project);
  project.briefMarkdown = buildFallbackBrief(project);
}

async function generateWithAi(project, templateText, contentText, apiKey) {
  if (isMaskedApiKey(apiKey)) {
    clearBrokenApiKey();
    return {
      ok: false,
      error: "Der gespeicherte API-Key war nur die maskierte Anzeige und wurde entfernt. Bitte den Original-Key einmal neu einfügen.",
    };
  }
  if (location.hostname.endsWith("github.io")) {
    return {
      ok: false,
      error: "GitHub Pages hat keinen Node-Server fuer KI-Erstellung. Bitte lokal mit npm start nutzen.",
    };
  }

  try {
    const response = await fetch("/api/generate-ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKeyB64: encodeApiKey(apiKey),
        project,
        templateText,
        contentText,
      }),
    });
    const data = await response.json();
    return response.ok ? { ok: true, ...data } : { ok: false, error: humanizeConnectionError(data.error || "KI-Anfrage fehlgeschlagen.") };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function testAiConnection() {
  return verifyAnthropicConnection({ markConnected: true });
}

async function verifyAnthropicConnection({ markConnected = false } = {}) {
  const apiKey = getActiveApiKey();
  elements.aiConnectionStatus.className = "";
  if (!apiKey) return showAiError("Kein API-Key eingegeben");
  if (isMaskedApiKey(apiKey)) {
    clearBrokenApiKey();
    return showAiError("Der gespeicherte API-Key war nur die maskierte Anzeige und wurde entfernt. Bitte den Original-Key einmal neu einfügen.");
  }
  apiKeyUi.loading = true;
  renderApiKeyManager();
  elements.aiConnectionStatus.textContent = "Teste Verbindung...";
  try {
    const response = await fetch("/api/test-anthropic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKeyB64: encodeApiKey(apiKey) }),
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      if (markConnected) apiKeyUi.connected = true;
      elements.aiConnectionStatus.textContent = `Verbunden (${data.model})`;
      elements.aiConnectionStatus.classList.add("ok");
      logStatus(`Anthropic-Verbindung erfolgreich: ${data.model}`);
    } else {
      const message = humanizeConnectionError(data.error || "Verbindung fehlgeschlagen");
      showAiError(message);
      logStatus(`Anthropic-Verbindung fehlgeschlagen: ${message || response.status}`);
    }
  } catch (error) {
    showAiError(humanizeConnectionError(error.message));
    logStatus(`Anthropic-Verbindung fehlgeschlagen: ${humanizeConnectionError(error.message)}`);
  } finally {
    apiKeyUi.loading = false;
    renderApiKeyManager();
  }
}

function getActiveApiKey() {
  return normalizeApiKey(apiKeyUi.draft || settings.apiKey);
}

function saveApiKey() {
  const rawCandidate = apiKeyUi.draft || (apiKeyUi.visible ? elements.apiKeyInput.value : settings.apiKey);
  if (isMaskedApiKey(rawCandidate)) {
    clearBrokenApiKey();
    return showAiError("Das ist nur die maskierte Anzeige, nicht der echte API-Key. Bitte den Original-Key einmal neu einfügen.");
  }
  const candidate = normalizeApiKey(rawCandidate);
  if (!candidate) return showAiError("Kein API-Key eingegeben");
  if (!isHeaderSafeApiKey(candidate)) {
    clearBrokenApiKey();
    return showAiError("Der eingefügte API-Key enthält weiterhin ungültige Zeichen. Bitte direkt aus der Anthropic Console kopieren.");
  }
  settings.apiKey = candidate;
  apiKeyUi.draft = "";
  apiKeyUi.visible = false;
  apiKeyUi.connected = false;
  saveSettings();
  elements.aiConnectionStatus.textContent = `Gespeichert: ${maskApiKey(candidate)}`;
  elements.aiConnectionStatus.className = "ok";
  renderApiKeyManager();
}

function disconnectAiConnection() {
  apiKeyUi.connected = false;
  elements.aiConnectionStatus.textContent = settings.apiKey ? "Verbindung getrennt. Key bleibt gespeichert." : "Verbindung getrennt.";
  elements.aiConnectionStatus.className = "";
  renderApiKeyManager();
}

function toggleApiKeyVisibility() {
  apiKeyUi.visible = !apiKeyUi.visible;
  apiKeyUi.draft = apiKeyUi.draft || normalizeApiKey(settings.apiKey);
  renderApiKeyManager();
  elements.apiKeyInput.focus();
}

function showAiError(message) {
  elements.aiConnectionStatus.textContent = humanizeConnectionError(message);
  elements.aiConnectionStatus.className = "error";
}

function humanizeConnectionError(message = "") {
  if (/model/i.test(message) && /pattern|not found|invalid|ungültig/i.test(message)) {
    return "Anthropic-Modellkennung war ungültig. Bitte lokalen Server neu starten und erneut testen.";
  }
  if (/expected pattern|string did not match|header value|bytestring|invalid character/i.test(message)) {
    return "Der gespeicherte API-Key ist beschädigt oder enthält Zeichen, die nicht an Anthropic gesendet werden können. Bitte den Original-Key einmal neu einfügen.";
  }
  return message || "Verbindung fehlgeschlagen";
}

function isHeaderSafeApiKey(apiKey = "") {
  return /^[\x21-\x7e]+$/.test(apiKey);
}

function normalizeApiKey(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/^Bearer\s*/i, "")
    .replace(/^x-api-key\s*:\s*/i, "")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[“”„‟‘’‚‛]/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\s]/g, "")
    .replace(/[^\x21-\x7e•]/g, "")
    .trim();
}

function encodeApiKey(apiKey = "") {
  const bytes = new TextEncoder().encode(apiKey);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function maskApiKey(apiKey = "") {
  const clean = normalizeApiKey(apiKey);
  if (!clean) return "";
  return `${clean.slice(0, 7)}${"•".repeat(10)}`;
}

function isMaskedApiKey(apiKey = "") {
  return String(apiKey).includes("•");
}

function clearBrokenApiKey() {
  settings.apiKey = "";
  apiKeyUi.draft = "";
  apiKeyUi.visible = false;
  apiKeyUi.connected = false;
  saveSettings();
  renderApiKeyManager();
}

async function readUrl(url) {
  if (location.hostname.endsWith("github.io")) {
    return {
      ok: false,
      error: "GitHub Pages kann keine fremden URLs serverseitig auslesen. Nutze die lokale Node-App fuer die Analyse.",
    };
  }

  try {
    const response = await fetch("/api/read-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    return { ok: response.ok && data.ok !== false, ...data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function logStatus(message) {
  activeProject().status = [...(activeProject().status || []), message];
  saveState();
  renderStatus(activeProject().status);
}

function analyzeTemplate(rawText, url) {
  const text = htmlToText(rawText);
  const headings = collectMatches(rawText, /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis).map(htmlToText).filter(Boolean);
  const buttons = collectMatches(rawText, /<(?:a|button)[^>]*>(.*?)<\/(?:a|button)>/gis).map(htmlToText).filter((item) => item.length > 2).slice(0, 8);
  const sectionCount = Math.max(estimateSectionCount(rawText), headings.length || 4);
  const style = inferStyle(rawText, text);
  const sections = inferSections(headings, sectionCount);

  return {
    source: url,
    headline: headings[0] || firstSentence(text) || "Klarer Hero mit Nutzenversprechen",
    sectionCount,
    ctas: buttons.length ? unique(buttons).slice(0, 5) : ["Jetzt starten", "Demo ansehen"],
    sections,
    style,
  };
}

function analyzeContent(rawText, project) {
  const text = htmlToText(rawText);
  const lines = text
    .split(/\n|\. /)
    .map((line) => line.trim())
    .filter((line) => line.length > 18 && line.length < 180);
  const fallbackName = project.name || `Landing Page ${activeIndex + 1}`;

  return {
    offer: lines[0] || `${fallbackName} für ${project.audience || "deine Zielgruppe"}`,
    headline: lines.find((line) => /für|mit|ohne|mehr|besser|schneller|automatis/i.test(line)) || lines[0] || `${fallbackName} effizient auf den Punkt gebracht`,
    benefits: pickLines(lines, ["spart", "mehr", "ohne", "einfach", "schnell", "klar", "wachstum"], 4),
    features: pickLines(lines, ["funktion", "feature", "dashboard", "autom", "analyse", "app", "prozess"], 4),
    proof: pickLines(lines, ["kunden", "ergebnis", "case", "daten", "sicher", "team", "erfahrung"], 3),
    rawSummary: lines.slice(0, 8),
  };
}

function buildLandingPage(project) {
  const template = project.templateAnalysis || analyzeTemplate("", project.templateUrl);
  const content = project.contentAnalysis || analyzeContent(project.manualContent, project);
  const name = project.name || `Landing Page ${activeIndex + 1}`;
  const cta = template.ctas[0] || "Jetzt starten";
  const secondaryCta = template.ctas[1] || "Einblick ansehen";
  const screenshotUrl = sanitizeUrl(project.screenshotUrl);
  const heroBackground = screenshotUrl
    ? `linear-gradient(90deg, rgba(7, 12, 15, .88) 0%, rgba(7, 12, 15, .72) 45%, rgba(7, 12, 15, .34) 100%), url("${escapeCssUrl(screenshotUrl)}")`
    : `linear-gradient(90deg, rgba(7, 12, 15, .92), rgba(7, 12, 15, .78)), linear-gradient(135deg, #1f3439 0%, #0b1114 100%)`;
  const benefits = ensureItems(content.benefits, ["Klarere Abläufe ohne Tool-Chaos", "Schnellere Entscheidungen im Tagesgeschäft", "Professioneller Auftritt für Kunden und Teams", "Weniger manuelle Abstimmung"]);
  const features = ensureItems(content.features, ["Geführter Workflow", "Strukturierte Inhalte", "Schneller Export", "Saubere Übersicht"]);
  const proof = ensureItems(content.proof, ["Für produktive Teams und reale Prozesse entwickelt", "Ruhiges Interface mit Fokus auf Umsetzung", "Schnell anpassbar für unterschiedliche Angebote"]);

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(name)}</title>
    <style>
      :root { --ink:#12181c; --muted:#66747c; --line:#dfe7ea; --accent:#0f766e; --accent-dark:#094f4a; --signal:#b98335; --soft:#f3f7f7; --cream:#fbfaf7; }
      * { box-sizing: border-box; }
      html { scroll-behavior:smooth; }
      body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); background:var(--cream); }
      a { color: inherit; }
      .nav { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:18px clamp(18px,5vw,72px); border-bottom:1px solid rgba(223,231,234,.86); background:rgba(255,255,255,.94); position:sticky; top:0; z-index:5; backdrop-filter:blur(14px); }
      .brand { display:flex; align-items:center; gap:10px; font-weight:850; font-size:18px; }
      .brand-mark { display:grid; place-items:center; width:34px; height:34px; border-radius:8px; background:var(--ink); color:#fff; font-size:12px; letter-spacing:0; }
      .nav-links { display:flex; align-items:center; gap:22px; color:var(--muted); font-size:14px; }
      .button { display:inline-flex; align-items:center; justify-content:center; min-height:46px; border-radius:8px; padding:0 20px; background:var(--accent); color:#fff; text-decoration:none; font-weight:850; border:1px solid var(--accent); box-shadow:0 16px 34px rgba(15,118,110,.24); }
      .button.secondary { background:rgba(255,255,255,.12); color:#fff; border-color:rgba(255,255,255,.42); box-shadow:none; }
      .hero { min-height:calc(100vh - 74px); display:grid; align-items:end; padding:clamp(76px,10vw,132px) clamp(18px,5vw,72px) clamp(42px,6vw,72px); color:#fff; background-image:${heroBackground}; background-size:cover; background-position:center; position:relative; }
      .hero::after { content:""; position:absolute; inset:auto clamp(18px,5vw,72px) 0; height:1px; background:rgba(255,255,255,.22); }
      .hero-content { position:relative; width:min(880px,100%); }
      .kicker { color:#f4c579; font-weight:850; text-transform:uppercase; letter-spacing:0; font-size:13px; }
      h1 { margin:14px 0 20px; font-size:clamp(44px,7vw,86px); line-height:.96; letter-spacing:0; max-width:920px; }
      .lead { color:rgba(255,255,255,.82); font-size:clamp(18px,2vw,23px); line-height:1.58; max-width:760px; }
      .hero-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:32px; }
      .hero-meta { display:flex; flex-wrap:wrap; gap:10px; margin-top:34px; color:rgba(255,255,255,.78); }
      .hero-meta span { border:1px solid rgba(255,255,255,.22); border-radius:8px; padding:9px 12px; background:rgba(255,255,255,.08); backdrop-filter:blur(10px); }
      section { padding:clamp(62px,8vw,104px) clamp(18px,5vw,72px); }
      .section-head { max-width:780px; margin-bottom:32px; }
      h2 { margin:0 0 14px; font-size:clamp(30px,4vw,52px); line-height:1.05; letter-spacing:0; }
      .section-head p, .card p, .proof li, .quote p, .feature-row span { color:var(--muted); line-height:1.65; }
      .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; }
      .card { border:1px solid var(--line); border-radius:8px; background:#fff; padding:24px; min-height:176px; box-shadow:0 18px 44px rgba(19,32,38,.07); }
      .card strong { display:block; margin-bottom:10px; font-size:18px; color:var(--ink); }
      .band { background:#fff; }
      .feature-layout { display:grid; grid-template-columns:minmax(280px,.82fr) minmax(0,1.18fr); gap:clamp(24px,5vw,68px); align-items:start; }
      .feature-list { display:grid; gap:12px; }
      .feature-row { display:grid; grid-template-columns:34px minmax(0,1fr); gap:14px; border:1px solid var(--line); border-radius:8px; background:var(--soft); padding:18px; }
      .feature-row i { display:grid; place-items:center; width:34px; height:34px; border-radius:8px; background:var(--accent); color:#fff; font-style:normal; font-weight:850; }
      .feature-row strong { display:block; margin-bottom:4px; }
      .quote { border:1px solid var(--line); border-radius:8px; background:var(--cream); padding:28px; margin-top:26px; }
      .quote strong { display:block; margin-bottom:8px; }
      .proof { display:grid; grid-template-columns:minmax(280px,.85fr) minmax(0,1.15fr); gap:clamp(24px,5vw,64px); align-items:start; }
      .proof ul { margin:0; padding:0; list-style:none; display:grid; gap:12px; }
      .proof li { border-left:3px solid var(--signal); padding:12px 0 12px 18px; background:#fff; }
      .cta { text-align:center; background:var(--ink); color:#fff; }
      .cta p { color:#c9d2d6; max-width:700px; margin:0 auto 26px; line-height:1.65; }
      .cta .button { box-shadow:none; }
      @media (max-width:980px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .feature-layout, .proof { grid-template-columns:1fr; } .nav-links a:not(.button) { display:none; } }
      @media (max-width:620px) { .grid { grid-template-columns:1fr; } .nav { align-items:flex-start; } h1 { font-size:42px; } .hero { min-height:680px; } .button { width:100%; } }
    </style>
  </head>
  <body>
    <nav class="nav">
      <div class="brand"><span class="brand-mark">BS</span>${escapeHtml(name)}</div>
      <div class="nav-links">
        <a href="#nutzen">Nutzen</a>
        <a href="#workflow">Workflow</a>
        <a href="#kontakt" class="button">${escapeHtml(cta)}</a>
      </div>
    </nav>

    <header class="hero">
      <div class="hero-content">
        <div class="kicker">${escapeHtml(project.audience || "BuiltSmart App")}</div>
        <h1>${escapeHtml(content.headline)}</h1>
        <p class="lead">${escapeHtml(content.offer)}</p>
        <div class="hero-actions">
          <a class="button" href="#kontakt">${escapeHtml(cta)}</a>
          <a class="button secondary" href="#workflow">${escapeHtml(secondaryCta)}</a>
        </div>
        <div class="hero-meta">
          <span>Premium-Landingpage</span>
          <span>${escapeHtml(template.style)} Struktur</span>
          <span>${template.sectionCount} Abschnitte</span>
        </div>
      </div>
    </header>

    <section id="nutzen">
      <div class="section-head">
        <h2>Ein ruhiger Auftritt für ein klares Angebot</h2>
        <p>Die Seite übernimmt das Muster der Referenz-Landingpage und übersetzt die Inhalte in eine hochwertige, vertrauenswürdige BuiltSmart-Präsentation.</p>
      </div>
      <div class="grid">
        ${benefits.map((item) => `<article class="card"><strong>${escapeHtml(shortTitle(item))}</strong><p>${escapeHtml(item)}</p></article>`).join("\n        ")}
      </div>
    </section>

    <section id="workflow" class="band">
      <div class="feature-layout">
        <div class="section-head">
          <h2>Reduziert auf das, was Entscheidung leichter macht</h2>
          <p>Keine überladene SaaS-Seite, keine abstrakten Illustrationen. Der Fokus liegt auf Nutzen, Oberfläche und nachvollziehbarer Umsetzung.</p>
          <div class="quote">
            <strong>Designrichtung</strong>
            <p>Heller Header, starker Screenshot-Hero, dunkles Overlay, großzügige Abstände und dezente Karten.</p>
          </div>
        </div>
        <div class="feature-list">
          ${features.map((item, index) => `<div class="feature-row"><i>${index + 1}</i><div><strong>${escapeHtml(shortTitle(item))}</strong><span>${escapeHtml(item)}</span></div></div>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section class="proof">
      <div class="section-head">
        <h2>Professionell genug für Kunden, klar genug für schnelle Entscheidungen</h2>
        <p>Diese Punkte eignen sich als Proof, FAQ-Grundlage oder als Argumente für Vertrieb und Präsentation.</p>
      </div>
      <ul>
        ${proof.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n        ")}
      </ul>
    </section>

    <section id="kontakt" class="cta">
      <h2>${escapeHtml(cta)}</h2>
      <p>${escapeHtml(content.offer)}</p>
      <a class="button" href="mailto:kontakt@example.com">${escapeHtml(cta)}</a>
    </section>
  </body>
</html>`;
}

function collectMatches(text, regex) {
  return [...(text || "").matchAll(regex)].map((match) => match[1] || "");
}

function htmlToText(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function formatSourceContent(value = "") {
  return htmlToText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

function estimateSectionCount(html) {
  const matches = (html || "").match(/<section|<article|class=["'][^"']*(section|hero|feature|benefit|testimonial|faq|pricing|cta)/gi);
  return Math.min(10, Math.max(4, matches ? matches.length : 4));
}

function inferStyle(html, text) {
  const source = `${html} ${text}`.toLowerCase();
  if (source.includes("pricing") || source.includes("preis")) return "SaaS";
  if (source.includes("termin") || source.includes("beratung")) return "Consulting";
  if (source.includes("kurs") || source.includes("coaching")) return "Education";
  if (source.includes("shop") || source.includes("warenkorb")) return "Commerce";
  return "Conversion";
}

function inferSections(headings, count) {
  const defaults = ["Hero", "Problem", "Lösung", "Nutzen", "Features", "Proof", "FAQ", "CTA"];
  return unique([...headings.slice(0, count), ...defaults]).slice(0, Math.min(8, count));
}

function firstSentence(text) {
  return (text.match(/[^.!?]{24,140}[.!?]/) || [])[0]?.trim();
}

function pickLines(lines, keywords, amount) {
  const matches = lines.filter((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword)));
  return unique([...matches, ...lines]).slice(0, amount);
}

function ensureItems(items, fallback) {
  return unique([...(items || []), ...fallback]).slice(0, 4);
}

function buildFallbackBrief(project) {
  const template = project.templateAnalysis || {};
  const content = project.contentAnalysis || {};
  return `# ${project.name || `Landing Page ${activeIndex + 1}`}

## Status
${project.generatedHtml ? "Landingpage wurde erstellt." : "Noch keine finale Analyse erstellt."}

## Quellen
- Vorlage: ${project.templateUrl || "nicht gesetzt"}
- Inhaltsquelle: ${project.contentUrl || "nicht gesetzt"}
- Hero-Screenshot: ${project.screenshotUrl || "nicht gesetzt"}

## Positionierung
${content.offer || "Noch nicht analysiert."}

## Hero
${content.headline || "Noch nicht analysiert."}

## Zielgruppe
${project.audience || "Noch nicht gesetzt."}

## Struktur
${(template.sections || ["Hero", "Nutzen", "Workflow", "Proof", "CTA"]).map((item) => `- ${item}`).join("\n")}

## Nutzen
${(content.benefits || []).map((item) => `- ${item}`).join("\n") || "- Noch keine Nutzenpunkte vorhanden."}

## Naechste Codex-Schritte
- HTML/CSS in eigenes Projekt aufteilen
- Texte final schaerfen
- echten App-Screenshot einsetzen
- mobile Ansicht visuell pruefen
`;
}

function buildFailureBrief(project, error) {
  return `# KI-Erstellung fehlgeschlagen

Die Anthropic-Verbindung oder KI-Erstellung war nicht erfolgreich.

## Fehler
${error || "Unbekannter Fehler"}

## Was pruefen?
- Ist der Anthropic API-Key korrekt?
- Ist im Anthropic-Konto API-Billing/Credits aktiv?
- Laeuft die App lokal ueber http://127.0.0.1:8171/ und nicht nur auf GitHub Pages?
- Klicke im Setup auf "Anthropic-Verbindung testen".

## Fuer 10/10 Ergebnisse benoetigt die KI moeglichst gute Eingangsdaten
- Konkrete Zielgruppe
- Hauptproblem und Dringlichkeit
- Klare App-Loesung
- 3-5 echte Nutzenargumente
- Wichtigste Features mit Zweck
- Workflow der App
- Proof, Beispiele oder Qualitaetsargumente
- Gewuenschter CTA
- Echter App-Screenshot fuer den Hero

## Projekt
- Name: ${project.name || "nicht gesetzt"}
- Vorlage: ${project.templateUrl || "nicht gesetzt"}
- Inhaltsquelle: ${project.contentUrl || "nicht gesetzt"}
`;
}

function unique(items) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function shortTitle(text) {
  const words = text.replace(/[^\p{L}\p{N}\s-]/gu, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join(" ") || "Baustein";
}

function sanitizeUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:" ? url.href : "";
  } catch {
    return "";
  }
}

function escapeCssUrl(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function activateTab(id) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
}

elements.nameInput.addEventListener("input", (event) => setProjectValue("name", event.target.value));
elements.apiKeyInput.addEventListener("input", (event) => {
  if (elements.apiKeyInput.readOnly) return;
  apiKeyUi.draft = event.target.value;
  apiKeyUi.connected = false;
  elements.aiConnectionStatus.textContent = "Nicht gespeichert";
  elements.aiConnectionStatus.className = "";
});
elements.apiKeyInput.addEventListener("focus", () => {
  if (!elements.apiKeyInput.readOnly) return;
  apiKeyUi.draft = "";
  apiKeyUi.visible = false;
  elements.apiKeyInput.readOnly = false;
  elements.apiKeyInput.type = "password";
  elements.apiKeyInput.value = "";
  elements.aiConnectionStatus.textContent = "Neuen Key eingeben oder Auge zum Anzeigen nutzen";
  elements.aiConnectionStatus.className = "";
});
elements.toggleApiKeyButton.addEventListener("click", toggleApiKeyVisibility);
elements.saveApiKeyButton.addEventListener("click", saveApiKey);
elements.connectAiButton.addEventListener("click", () => verifyAnthropicConnection({ markConnected: true }));
elements.disconnectAiButton.addEventListener("click", disconnectAiConnection);
elements.useAiInput.addEventListener("change", (event) => {
  settings.useAi = event.target.checked;
  saveSettings();
});
elements.testAiButton.addEventListener("click", testAiConnection);
elements.templateUrlInput.addEventListener("input", (event) => setProjectValue("templateUrl", event.target.value));
elements.contentUrlInput.addEventListener("input", (event) => setProjectValue("contentUrl", event.target.value));
elements.screenshotUrlInput.addEventListener("input", (event) => setProjectValue("screenshotUrl", event.target.value));
elements.audienceInput.addEventListener("input", (event) => setProjectValue("audience", event.target.value));
elements.manualContentInput.addEventListener("input", (event) => setProjectValue("manualContent", event.target.value));
elements.analyzeButton.addEventListener("click", analyzeActiveProject);
elements.exportButton.addEventListener("click", () => activateTab("output"));
elements.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.htmlOutput.value);
  setButtonFeedback(elements.copyButton, "Kopiert");
});
elements.clearOutputButton.addEventListener("click", () => {
  activeProject().generatedHtml = "";
  saveState();
  updateOutput("");
  setButtonFeedback(elements.clearOutputButton, "Geleert");
});
elements.copySourceButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(activeProject().sourceContentText || "");
  setButtonFeedback(elements.copySourceButton, "Kopiert");
});
elements.clearSourceButton.addEventListener("click", () => {
  activeProject().sourceContentText = "";
  saveState();
  renderSourceContent();
  setButtonFeedback(elements.clearSourceButton, "Geleert");
});
elements.copyBriefButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.briefOutput.value);
  elements.copyBriefButton.textContent = "Kopiert";
  setTimeout(() => (elements.copyBriefButton.textContent = "Briefing kopieren"), 1200);
});
elements.downloadButton.addEventListener("click", () => {
  const name = (activeProject().name || "landing-page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const blob = new Blob([elements.htmlOutput.value], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name || "landing-page"}.html`;
  link.click();
  URL.revokeObjectURL(url);
});
elements.downloadBriefButton.addEventListener("click", () => {
  downloadText(`${slugify(activeProject().name || "landing-page")}-briefing.md`, elements.briefOutput.value, "text/markdown");
});
elements.exportProjectButton.addEventListener("click", () => {
  const project = activeProject();
  const slug = slugify(project.name || "landing-page");
  const bundle = `# Codex Projektpaket: ${project.name || "Landing Page"}

## Datei: brief.md

${elements.briefOutput.value}

## Datei: index.html

\`\`\`html
${elements.htmlOutput.value}
\`\`\`
`;
  downloadText(`${slug}-codex-projektpaket.md`, bundle, "text/markdown");
});

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "landing-page";
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setButtonFeedback(button, label) {
  const labelElement = button.querySelector("span");
  const original = labelElement ? labelElement.textContent : button.textContent;
  if (labelElement) {
    labelElement.textContent = label;
  } else {
    button.textContent = label;
  }
  setTimeout(() => {
    if (labelElement) {
      labelElement.textContent = original;
    } else {
      button.textContent = original;
    }
  }, 1200);
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

render();
