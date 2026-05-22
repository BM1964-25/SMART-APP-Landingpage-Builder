import { createServer } from "node:http";
import { mkdirSync, appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const logsDir = join(projectRoot, "logs");
const logFile = join(logsDir, "landingpage-builder-server.log");
const port = Number(process.env.PORT || 8173);
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const anthropicModelsEndpoint = "https://api.anthropic.com/v1/models";
const defaultAnthropicModel = "claude-3-5-sonnet-20241022";
const preferredAnthropicModels = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
];
const allowedAnthropicModels = new Set([
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-3-7-sonnet-latest",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-0",
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const landingPageTool = {
  name: "deliver_landing_page",
  description: "Gibt das fertige Landingpage-Ergebnis strukturiert zurück.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["templateAnalysis", "contentAnalysis", "landingPageHtml", "briefMarkdown"],
    properties: {
      templateAnalysis: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "style", "sectionCount", "sections", "ctas"],
        properties: {
          headline: { type: "string" },
          style: { type: "string" },
          sectionCount: { type: "number" },
          sections: { type: "array", items: { type: "string" } },
          ctas: { type: "array", items: { type: "string" } },
        },
      },
      contentAnalysis: {
        type: "object",
        additionalProperties: false,
        required: ["offer", "headline", "benefits", "features", "proof", "rawSummary"],
        properties: {
          offer: { type: "string" },
          headline: { type: "string" },
          benefits: { type: "array", items: { type: "string" } },
          features: { type: "array", items: { type: "string" } },
          proof: { type: "array", items: { type: "string" } },
          rawSummary: { type: "array", items: { type: "string" } },
        },
      },
      landingPageHtml: { type: "string" },
      briefMarkdown: { type: "string" },
    },
  },
};

mkdirSync(logsDir, { recursive: true });

function logLine(message = "") {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(message);
  appendFileSync(logFile, `${line}\n`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, limit = 1_200_000) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("Die Anfrage ist zu groß.");
  }
  return JSON.parse(body || "{}");
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function compactText(value = "", limit = 80_000) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function collectMatches(value = "", pattern, limit = 30) {
  return [...String(value).matchAll(pattern)]
    .map((match) => compactText(match[1] || match[0], 2_000))
    .filter(Boolean)
    .slice(0, limit);
}

function stripScripts(value = "") {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, " ");
}

function summarizeTemplateBlocks(raw = "") {
  const cleaned = stripScripts(raw);
  const blocks = [...cleaned.matchAll(/<(header|section|main|footer|nav|article)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map((match, index) => {
      const tag = match[1].toLowerCase();
      const attrs = compactText(match[2], 500);
      const inner = match[3] || "";
      const heading = compactText(inner.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] || "", 500);
      const ctas = collectMatches(inner, /<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi, 8).join(" | ");
      const text = compactText(inner, 1_500);
      return `${index + 1}. <${tag} ${attrs}>
Heading: ${heading || "-"}
CTA: ${ctas || "-"}
Inhalt/Pattern: ${text}`;
    })
    .slice(0, 18);
  return blocks.join("\n\n");
}

function compactTemplateSource(value = "", limit = 120_000) {
  const raw = String(value || "");
  const title = compactText(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "", 300);
  const styles = collectMatches(raw, /<style[^>]*>([\s\S]*?)<\/style>/gi, 8).join("\n").slice(0, 20_000);
  const headings = collectMatches(raw, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 24);
  const navItems = collectMatches(raw, /<(?:nav|header)[^>]*>([\s\S]*?)<\/(?:nav|header)>/gi, 4);
  const buttons = collectMatches(raw, /<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi, 24);
  const templateBlocks = summarizeTemplateBlocks(raw);
  const sectionHints = [...raw.matchAll(/<(section|header|footer|main|article|div)\b([^>]*)>/gi)]
    .map((match) => compactText(`${match[1]} ${match[2]}`, 400))
    .filter((item) => /class=|id=|hero|cta|feature|benefit|workflow|faq|card|grid|section|nav|button/i.test(item))
    .slice(0, 80)
    .join("\n");
  const colors = [...new Set((raw.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)/g) || []).slice(0, 80))].join(", ");
  const text = compactText(raw, 60_000);

  return compactText(
    `TEMPLATE_URL_DESIGNDIGEST
Title: ${title}

Headings in Reihenfolge:
${headings.map((item, index) => `${index + 1}. ${item}`).join("\n")}

Navigation/Header/CTA Muster:
${navItems.join("\n---\n")}

Template-Skeleton in Reihenfolge:
${templateBlocks}

Button- und CTA-Texte:
${buttons.join(" | ")}

Layout-/Klassen-/Section-Hinweise:
${sectionHints}

CSS-/Farbhinweise:
${colors}

Style-Auszug:
${styles}

Bereinigter Seiteninhalt:
${text}`,
    limit,
  );
}

function compactContentSource(value = "", limit = 120_000) {
  const raw = String(value || "");
  const title = compactText(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "", 300);
  const headings = collectMatches(raw, /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, 40);
  const buttons = collectMatches(raw, /<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi, 30);
  const text = compactText(raw, 95_000);

  return compactText(
    `CONTENT_SOURCE_FACTS
Title: ${title}

Headings und Inhaltsstruktur:
${headings.map((item, index) => `${index + 1}. ${item}`).join("\n")}

CTA-/Button-Texte:
${buttons.join(" | ")}

Bereinigter Gesamtinhalt:
${text}`,
    limit,
  );
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

function decodeApiKey(body = {}) {
  if (body.apiKeyB64) {
    try {
      return Buffer.from(String(body.apiKeyB64), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return body.apiKey || "";
}

function validateAnthropicKey(apiKey) {
  if (!apiKey) return "Bitte Anthropic API-Key eingeben oder ANTHROPIC_API_KEY setzen.";
  if (apiKey.includes("•")) return "Der gespeicherte API-Key ist nur die maskierte Anzeige und nicht der echte Key. Bitte den Original-Key einmal neu einfügen.";
  return "";
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return { data: JSON.parse(text || "{}"), text };
  } catch {
    return { data: {}, text };
  }
}

function pickResponseHeaders(response) {
  if (!response) return {};
  return {
    "content-type": response.headers.get("content-type") || "",
    server: response.headers.get("server") || "",
    via: response.headers.get("via") || "",
    "cf-ray": response.headers.get("cf-ray") || "",
    "request-id": response.headers.get("request-id") || "",
    "anthropic-request-id": response.headers.get("anthropic-request-id") || "",
  };
}

function getConfiguredAnthropicModel() {
  const candidate = String(process.env.ANTHROPIC_MODEL || "").trim();
  if (allowedAnthropicModels.has(candidate)) return candidate;
  return defaultAnthropicModel;
}

function pickBestAnthropicModel(models = []) {
  const configured = getConfiguredAnthropicModel();
  if (models.includes(configured)) return { model: configured, source: "configured" };
  const preferred = preferredAnthropicModels.find((model) => models.includes(model));
  if (preferred) return { model: preferred, source: "preferred_sonnet" };
  const sonnet = models.find((model) => /sonnet/i.test(model));
  if (sonnet) return { model: sonnet, source: "models_api_sonnet" };
  return { model: models[0] || configured, source: models[0] ? "models_api_first" : "fallback" };
}

async function resolveAnthropicModel(apiKey) {
  try {
    const response = await fetch(anthropicModelsEndpoint, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    const { data, text } = await readJsonResponse(response);
    const models = Array.isArray(data.data) ? data.data.map((item) => item.id).filter(Boolean) : [];
    const picked = pickBestAnthropicModel(models);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: pickResponseHeaders(response),
      model: picked.model,
      modelSource: picked.source,
      availableModels: models.slice(0, 8),
      error: data.error?.message || (!response.ok ? text.slice(0, 180) : ""),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      model: getConfiguredAnthropicModel(),
      modelSource: "fallback_after_models_error",
      availableModels: [],
      error: error.message || "Models API konnte nicht gelesen werden.",
    };
  }
}

function buildApiDiagnostics({ rawKey = "", apiKey = "", model = getConfiguredAnthropicModel(), modelLookup = null, response = null, responseText = "", apiError = "", error = null } = {}) {
  const bodyPreview = JSON.stringify({
    model,
    max_tokens: 64,
    messages: [{ role: "user", content: "Antworte nur mit OK." }],
  });
  return {
    endpoint: anthropicEndpoint,
    method: "POST",
    hasTrailingSlash: anthropicEndpoint.endsWith("/"),
    contentType: "application/json",
    bodyType: "string",
    bodyIsJson: true,
    model,
    modelSource: modelLookup?.modelSource || (process.env.ANTHROPIC_MODEL ? "env" : "default"),
    modelsEndpoint: anthropicModelsEndpoint,
    modelsStatus: modelLookup?.status || null,
    modelsStatusText: modelLookup?.statusText || "",
    modelsOk: modelLookup?.ok ?? null,
    availableModels: modelLookup?.availableModels || [],
    modelsError: modelLookup?.error || "",
    modelsResponseServer: modelLookup?.responseHeaders?.server || "",
    modelsResponseVia: modelLookup?.responseHeaders?.via || "",
    modelsResponseContentType: modelLookup?.responseHeaders?.["content-type"] || "",
    keySource: rawKey ? "browser/localStorage" : "env",
    keyPresent: Boolean(apiKey),
    keyPrefix: apiKey ? apiKey.slice(0, 13) : "",
    keyStartsSkAntApi03: apiKey.startsWith("sk-ant-api03-"),
    keyStartsSkAnt: apiKey.startsWith("sk-ant-"),
    keyLength: apiKey.length,
    keyChangedByNormalizer: String(rawKey || "") !== apiKey,
    keyHasWhitespace: /\s/.test(String(rawKey || "")),
    keyHasMask: String(rawKey || "").includes("•"),
    bodyLength: bodyPreview.length,
    responseStatus: response?.status || null,
    responseStatusText: response?.statusText || "",
    responseOk: response?.ok ?? null,
    responseServer: response?.headers?.get("server") || "",
    responseVia: response?.headers?.get("via") || "",
    responseContentType: response?.headers?.get("content-type") || "",
    responseCfRay: response?.headers?.get("cf-ray") || "",
    responseRequestId: response?.headers?.get("request-id") || response?.headers?.get("anthropic-request-id") || "",
    responseTextPreview: responseText ? String(responseText).slice(0, 180) : "",
    apiError,
    error: error?.message || null,
  };
}

function logApiDiagnostics(diagnostics) {
  logLine("--- ANTHROPIC API DIAGNOSE ---");
  logLine(`Endpoint: ${diagnostics.endpoint}`);
  logLine(`Method: ${diagnostics.method}`);
  logLine(`Trailing Slash: ${diagnostics.hasTrailingSlash}`);
  logLine(`Content-Type: ${diagnostics.contentType}`);
  logLine(`Body-Typ: ${diagnostics.bodyType}`);
  logLine(`Body JSON valide: ${diagnostics.bodyIsJson}`);
  logLine(`Modell: ${diagnostics.model}`);
  logLine(`Modell-Quelle: ${diagnostics.modelSource}`);
  logLine(`Models API Status: ${diagnostics.modelsStatus || "-"}`);
  logLine(`Models API Server: ${diagnostics.modelsResponseServer || "-"}`);
  logLine(`Models API Content-Type: ${diagnostics.modelsResponseContentType || "-"}`);
  logLine(`Verfuegbare Modelle: ${diagnostics.availableModels.join(", ") || "-"}`);
  logLine(`Key-Quelle: ${diagnostics.keySource}`);
  logLine(`Key vorhanden: ${diagnostics.keyPresent}`);
  logLine(`Key-Prefix: ${diagnostics.keyPrefix}`);
  logLine(`Key beginnt sk-ant-api03-: ${diagnostics.keyStartsSkAntApi03}`);
  logLine(`Key beginnt sk-ant-: ${diagnostics.keyStartsSkAnt}`);
  logLine(`Key-Laenge: ${diagnostics.keyLength}`);
  logLine(`Key durch Normalisierung veraendert: ${diagnostics.keyChangedByNormalizer}`);
  logLine(`Key enthaelt Whitespace: ${diagnostics.keyHasWhitespace}`);
  logLine(`Key enthaelt Maske: ${diagnostics.keyHasMask}`);
  if (diagnostics.responseStatus) logLine(`Anthropic Status: ${diagnostics.responseStatus}`);
  if (diagnostics.responseStatusText) logLine(`Anthropic Status Text: ${diagnostics.responseStatusText}`);
  if (diagnostics.responseServer) logLine(`Anthropic Response Server: ${diagnostics.responseServer}`);
  if (diagnostics.responseContentType) logLine(`Anthropic Response Content-Type: ${diagnostics.responseContentType}`);
  if (diagnostics.responseRequestId) logLine(`Anthropic Request ID: ${diagnostics.responseRequestId}`);
  if (diagnostics.apiError) logLine(`Anthropic API Fehler: ${diagnostics.apiError}`);
  if (diagnostics.error) logLine(`Fehler: ${diagnostics.error}`);
}

function humanizeServerError(message = "") {
  if (/model/i.test(message) && /pattern|not found|invalid/i.test(message)) {
    return `Interne Anthropic-Modellkennung war ungültig. Standard ist jetzt ${defaultAnthropicModel}.`;
  }
  if (/the string did not match the expected pattern|string did not match|expected pattern/i.test(message)) {
    return "Verbindungstest nicht erfolgreich. Diagnosewerte wurden erzeugt.";
  }
  return message || "Anthropic Anfrage fehlgeschlagen.";
}

function humanizeAnthropicApiError(message = "") {
  if (/model/i.test(message) && /pattern|not found|invalid/i.test(message)) {
    return `Anthropic-Modellkennung war ungültig. Standard ist jetzt ${defaultAnthropicModel}.`;
  }
  return humanizeServerError(message);
}

async function readUrl(req, res) {
  try {
    const { url } = await readJsonBody(req, 20_000);
    if (!isSafeHttpUrl(url)) {
      sendJson(res, 400, { error: "Bitte eine gültige http/https URL eingeben." });
      return;
    }

    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "SMART APP & Landingpage Builder/1.0",
        accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    sendJson(res, response.ok ? 200 : 502, {
      ok: response.ok,
      status: response.status,
      url: response.url,
      contentType,
      text: text.slice(0, 500_000),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "URL konnte nicht gelesen werden." });
  }
}

async function generateAiLandingPage(req, res) {
  try {
    const body = await readJsonBody(req);
    const rawKey = decodeApiKey(body) || process.env.ANTHROPIC_API_KEY || "";
    const apiKey = normalizeApiKey(rawKey);
    const keyError = validateAnthropicKey(apiKey);
    if (keyError) {
      sendJson(res, 400, { error: keyError });
      return;
    }
    const modelLookup = await resolveAnthropicModel(apiKey);
    if (!modelLookup.ok && modelLookup.status === 401) {
      sendJson(res, 401, { error: modelLookup.error || "invalid x-api-key", diagnostics: buildApiDiagnostics({ rawKey, apiKey, model: modelLookup.model, modelLookup }) });
      return;
    }
    const model = modelLookup.model;
    const diagnostics = buildApiDiagnostics({ rawKey, apiKey, model, modelLookup });

    const project = body.project || {};
    const source = {
      name: project.name || "SMART APP & Landingpage Builder",
      audience: project.audience || "",
      templateUrl: project.templateUrl || "",
      contentUrl: project.contentUrl || "",
      screenshotUrl: project.screenshotUrl || "",
      templateText: compactTemplateSource(body.templateText),
      contentText: compactContentSource(body.contentText),
    };

    logApiDiagnostics(diagnostics);
    const response = await fetch(anthropicEndpoint, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 12000,
        system: `Du bist ein Elite-Team aus Creative Director, Conversion Strategist, Senior UX Writer und Principal Frontend Designer fuer BuiltSmart-Apps.

Dein Ziel ist nicht "eine brauchbare Landingpage", sondern ein 10/10 Premium-Ergebnis, das wie eine professionell konzipierte Produktlandingpage wirkt.
Der Kernauftrag: Die neue Landingpage muss vom Aufbau, Rhythmus, visuellen Stil, CTA-System und Section-Logik der Vorlage erkennbar abgeleitet sein. Die Inhalte duerfen dagegen nur aus der Inhaltsquelle der neuen Anwendung stammen.
Das Blueprint ist der Bauplan. Ein gutes Blueprint ohne entsprechend gute HTML-Landingpage ist ein Fehler.

Qualitaetsstandard 10/10:
- Die Seite hat eine klare strategische Positionierung, keine generische SaaS-Sprache.
- Der Hero muss sofort verstehen lassen: Fuer wen ist die App, welches Problem loest sie, warum ist sie wertvoll?
- Texte sind praezise, ruhig, vertrauenswuerdig und verkaufsstark. Keine Floskeln wie "revolutionaer", "innovativ", "maximiere dein Potenzial".
- Jede Section hat eine erkennbare Aufgabe in der Conversion-Story: Aufmerksamkeit, Problem, Loesung, Nutzen, Workflow, Proof, CTA.
- Design wirkt wie BuiltSmart/SMART-SnippetFlow: heller Header, starker Hero mit App-Screenshot-Hintergrund falls vorhanden, dunkles Overlay, grosse klare Typografie, hochwertige Buttons, dezente Karten, grosszuegige Abstaende, professionelle Farben.
- Keine abstrakten Illustrationen, keine Emoji-Dekoration, keine ueberladene SaaS-Seite, keine lauten Effekte.
- Layout muss auf Desktop und Mobile sauber funktionieren, ohne Textueberlagerung.
- HTML/CSS muss eigenstaendig, sauber strukturiert und direkt im Browser nutzbar sein.

Arbeitsweise:
1. Extrahiere alle Vorgaben selbst aus der Vorlage und Inhaltsquelle. Manuelle Inhalte sind nur Ergaenzung.
2. Analysiere die Vorlage als Design- und Aufbau-Muster: Header, Hero-Komposition, Section-Reihenfolge, CTA-System, visuelle Hierarchie, Farben, Typografie, Button-Stil, Card-Stil, Abstaende, Tonalitaet, Footer. Uebernehme diese Struktur sinngemaess.
3. Analysiere die Inhaltsquelle als Faktenquelle: Angebot, Zielgruppe, Schmerzpunkte, Nutzen, Features, Workflow, Proof, CTA, Fachbegriffe, konkrete App-Funktionen. Nutze keine Inhaltsbehauptungen aus der Vorlage.
4. Trenne strikt: "aus Quelle erkannt" vs. "Annahme". Erfinde keine Fakten.
5. Verdichte daraus ein scharfes Landingpage-Konzept.
6. Schreibe die Seite neu, nicht nur umsortiert.
7. Uebersetze das Blueprint 1:1 in landingPageHtml: Jede erkannte Template-Section braucht eine entsprechende neue Section mit Inhaltsquelle-Content.
8. Fuehre vor der Ausgabe intern eine Selbstpruefung durch: Wenn das HTML generisch aussieht, zu wenig nach Vorlage wirkt oder Inhalte aus der Vorlage uebernimmt, verbessere es.

Gib das Ergebnis ausschliesslich ueber das Tool deliver_landing_page zurueck. Schreibe keine separate Textantwort.`,
        messages: [
          {
            role: "user",
            content: `Erstelle aus diesen Daten eine High-Professional-Landingpage und ein Codex-freundliches Briefing.

Projekt:
${JSON.stringify(source, null, 2)}

Nicht verhandelbare Anforderungen:
- templateText ist die Vorlage. Nutze sie fuer Aufbau, Section-Reihenfolge, Header-/Hero-System, Button-Stil, Kartenlogik, Farben, Abstaende und Tonalitaet.
- contentText ist die Inhaltsquelle der neuen Anwendung. Nutze sie fuer ALLE Inhalte: App-Name, Zielgruppe, Nutzen, Features, Workflow, Proof, CTA und Fachbegriffe.
- Vermische die Inhalte der Vorlage nicht mit der neuen Anwendung.
- Die neue Landingpage soll nicht identisch kopieren, aber sichtbar nach demselben Muster gebaut sein.
- Das fertige landingPageHtml muss mindestens so viel Sorgfalt zeigen wie das Blueprint: kein generischer Standardaufbau, keine austauschbaren Sections, keine Dummy-Claims.
- Nutze die Template-Skeleton-Reihenfolge aus templateText als primaeren Bauplan. Nur wenn eine Vorlage-Section inhaltlich nicht passt, ersetze sie durch eine funktional vergleichbare Section.
- Jede HTML-Section soll als Kommentar markieren, welche Vorlage-Section sie abbildet, z. B. <!-- Vorlage: Hero -> Neue App Hero -->.
- Nutze manuelle Inhalte nur als Ergaenzung oder Ersatz, falls eine Quelle wenig hergibt.
- Markiere fehlende Informationen und Annahmen explizit im briefMarkdown.
- landingPageHtml muss eine vollstaendige, eigenstaendige HTML-Datei mit inline CSS sein.
- Die Landingpage muss deutsch sein.
- Die Texte muessen deutlich besser, spezifischer und verkaufsstaerker sein als eine reine Zusammenfassung.
- Verwende keine externen CDNs.
- Wenn screenshotUrl vorhanden ist, nutze ihn im Hero per CSS background-image mit dunklem Overlay.
- Wenn keine Quelle ausreichend ist, verwende die manuellen Inhalte und markiere Annahmen im Briefing.
- Keine Platzhalter wie Lorem ipsum.
- CTA realistisch und klar.
- briefMarkdown muss so gut sein, dass Codex die Landingpage danach professionell weiterbearbeiten kann.

Landingpage-Struktur:
Nutze die Struktur der Vorlage als verbindliche Reihenfolge. Falls die Vorlage weniger oder mehr Abschnitte hat, folge der Vorlage. Die folgende Struktur ist nur ein Fallback:
1. Header
2. Hero
3. Problem/Context
4. Nutzenkarten
5. Workflow/Produktlogik
6. Feature-Section
7. Proof/Trust
8. FAQ oder Einwandbehandlung
9. Final CTA

Designregeln:
- Beginne mit einer kurzen internen Template-Mapping-Entscheidung: Welche Vorlage-Section wird zu welcher neuen Section? Setze dieses Mapping im HTML um.
- Wenn die Vorlage einen hellen Header, dunklen Screenshot-Hero, dezente Karten und ruhige Premium-Abstaende hat, muss die neue Landingpage dieselbe visuelle Grammatik tragen.
- Uebernehme visuelle DNA aus der Vorlage: Header-Hoehe, Hero-Aufteilung, Breiten, Grid-Logik, Card-Radius, Button-Hoehe, Section-Abstaende, Farbfamilie, Schatten/Border, Footer-Rhythmus.
- Verwende im HTML semantische CSS-Klassen, die die Vorlage nachzeichnen: hero, hero-overlay, section, card-grid, feature-card, workflow, proof, faq, final-cta.
- Keine Farbexplosion. Nutze dunkles Ink, warmes Off-White, Teal/Green als Akzent, optional Gold nur sparsam.
- Cards maximal 8px Radius.
- Keine nested Cards.
- Keine riesigen Marketing-Floskeln.
- Abschnitte muessen visuell atmen, aber nicht leer wirken.
- Buttons hochwertig, klar, konsistent.
- Mobile CSS mit Breakpoints.
- Keine externen Fonts, keine externen Libraries.

Copy-Regeln:
- Headline muss spezifisch sein und darf nicht nur den App-Namen wiederholen.
- Subline erklaert Outcome plus Mechanismus.
- Nutze konkrete Verben.
- Jede Benefit-Karte beantwortet: "Was wird fuer den Nutzer besser?"
- Keine erfundenen Kunden, Zahlen, Zertifikate oder Testimonials.

Briefing-Anforderungen:
- Ganz oben im briefMarkdown: "Template-Mapping" als Tabelle mit Vorlage-Section -> neue Section -> verwendete Inhalte.
- Quellenextraktion: Welche Designvorgaben wurden aus der Vorlage erkannt?
- Quellenextraktion: Welche Inhaltsvorgaben wurden aus der Inhaltsquelle erkannt?
- Positionierung
- Zielgruppe
- Hauptversprechen
- Seitenstruktur mit Zweck jeder Section
- Wichtigste Copy-Entscheidungen
- Designentscheidungen
- Genutzte Quellen
- Annahmen und Unsicherheiten
- Naechste Codex-Schritte fuer finale Veredelung

Interne 10/10-Selbstpruefung vor Ausgabe:
- Ist die Headline stark genug?
- Ist der Hero visuell Premium?
- Klingt die Copy spezifisch zur App?
- Ist die Seite ohne falsche Behauptungen glaubwuerdig?
- Ist das HTML direkt nutzbar?
- Ist Mobile beruecksichtigt?

JSON-Format exakt:
{
  "templateAnalysis": {
    "headline": "string",
    "style": "string",
    "sectionCount": 6,
    "sections": ["string"],
    "ctas": ["string"]
  },
  "contentAnalysis": {
    "offer": "string",
    "headline": "string",
    "benefits": ["string"],
    "features": ["string"],
    "proof": ["string"],
    "rawSummary": ["string"]
  },
  "landingPageHtml": "vollstaendige HTML-Datei",
  "briefMarkdown": "Markdown Briefing"
}`,
          },
        ],
        tools: [landingPageTool],
        tool_choice: { type: "tool", name: "deliver_landing_page" },
      }),
    });

    const { data, text: responseText } = await readJsonResponse(response);
    if (!response.ok) {
      const apiError = data.error?.message || responseText.slice(0, 180) || "Anthropic Anfrage fehlgeschlagen.";
      sendJson(res, response.status, { error: humanizeAnthropicApiError(apiError), diagnostics: buildApiDiagnostics({ rawKey, apiKey, model, modelLookup, response, responseText, apiError }) });
      return;
    }

    const toolInput = data.content?.find((item) => item.type === "tool_use" && item.name === "deliver_landing_page")?.input;
    const outputText = data.content?.find((item) => item.type === "text")?.text;
    if (!toolInput && !outputText) {
      sendJson(res, 502, { error: "Anthropic Antwort enthielt kein nutzbares Ergebnis." });
      return;
    }

    const parsed = toolInput || parseJsonResponse(outputText);
    sendJson(res, 200, { ...normalizeGeneratedResult(parsed, source), diagnostics: buildApiDiagnostics({ rawKey, apiKey, model, modelLookup, response, responseText }) });
  } catch (error) {
    sendJson(res, 500, { error: humanizeServerError(error.message), diagnostics: buildApiDiagnostics({ error }) });
  }
}

async function testAnthropicConnection(req, res) {
  try {
    const body = await readJsonBody(req, 30_000);
    const rawKey = decodeApiKey(body) || process.env.ANTHROPIC_API_KEY || "";
    const apiKey = normalizeApiKey(rawKey);
    const keyError = validateAnthropicKey(apiKey);
    if (keyError) {
      sendJson(res, 400, { error: keyError });
      return;
    }
    const modelLookup = await resolveAnthropicModel(apiKey);
    if (!modelLookup.ok && modelLookup.status === 401) {
      sendJson(res, 401, { ok: false, error: modelLookup.error || "invalid x-api-key", diagnostics: buildApiDiagnostics({ rawKey, apiKey, model: modelLookup.model, modelLookup }) });
      return;
    }
    const model = modelLookup.model;
    const diagnostics = buildApiDiagnostics({ rawKey, apiKey, model, modelLookup });

    logApiDiagnostics(diagnostics);
    const response = await fetch(anthropicEndpoint, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        messages: [{ role: "user", content: "Antworte nur mit OK." }],
      }),
    });
    const { data, text: responseText } = await readJsonResponse(response);
    if (!response.ok) {
      const apiError = data.error?.message || responseText.slice(0, 180) || "Anthropic Verbindung fehlgeschlagen.";
      sendJson(res, response.status, { ok: false, error: humanizeAnthropicApiError(apiError), diagnostics: buildApiDiagnostics({ rawKey, apiKey, model, modelLookup, response, responseText, apiError }) });
      return;
    }

    const text = data.content?.find((item) => item.type === "text")?.text || "";
    sendJson(res, 200, { ok: true, model, text: text.trim(), diagnostics: buildApiDiagnostics({ rawKey, apiKey, model, modelLookup, response, responseText }) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: humanizeServerError(error.message), diagnostics: buildApiDiagnostics({ error }) });
  }
}

function parseJsonResponse(text) {
  const trimmed = String(text).trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Anthropic Antwort war kein gueltiges JSON.");
  }
}

function asStringArray(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return fallback;
}

function normalizeGeneratedResult(result = {}, source = {}) {
  const templateAnalysis = result.templateAnalysis || {};
  const contentAnalysis = result.contentAnalysis || {};
  const projectName = source.name || "SMART APP & Landingpage Builder";
  const offer = String(contentAnalysis.offer || `${projectName} professionell positioniert.`).trim();
  const headline = String(contentAnalysis.headline || templateAnalysis.headline || projectName).trim();
  const normalized = {
    templateAnalysis: {
      headline: String(templateAnalysis.headline || headline).trim(),
      style: String(templateAnalysis.style || "BuiltSmart Premium Landingpage").trim(),
      sectionCount: Number(templateAnalysis.sectionCount || 9),
      sections: asStringArray(templateAnalysis.sections, ["Hero", "Problem", "Nutzen", "Workflow", "Features", "Proof", "FAQ", "Final CTA"]),
      ctas: asStringArray(templateAnalysis.ctas, ["Demo ansehen", "Projekt starten"]),
    },
    contentAnalysis: {
      offer,
      headline,
      benefits: asStringArray(contentAnalysis.benefits, ["Klarere Positionierung", "Bessere Entscheidungsgrundlage", "Professioneller Landingpage-Aufbau"]),
      features: asStringArray(contentAnalysis.features, ["Strukturierte Inhalte", "Gefuehrter Workflow", "Exportfaehige HTML-Ausgabe"]),
      proof: asStringArray(contentAnalysis.proof, ["Aus Vorlage und Inhaltsquelle abgeleitet", "Annahmen im Briefing dokumentiert"]),
      rawSummary: asStringArray(contentAnalysis.rawSummary, [offer]),
    },
  };

  return {
    ...normalized,
    landingPageHtml: buildBlueprintLandingPage({ projectName, source, ...normalized }),
    briefMarkdown: String(result.briefMarkdown || buildEmergencyBrief({ projectName, headline, offer })).trim(),
  };
}

function takeItems(items = [], count = 4, fallback = []) {
  const list = asStringArray(items, fallback);
  return [...list, ...fallback].filter(Boolean).slice(0, count);
}

function titleFromText(value = "", fallback = "Nutzen") {
  const words = String(value)
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 5).join(" ") || fallback;
}

function cssUrl(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

function mapSectionPurpose(section = "", index = 0) {
  const lower = String(section).toLowerCase();
  if (/hero|start|intro/.test(lower)) return "Hero mit neuer App-Positionierung";
  if (/feature|funktion/.test(lower)) return "Funktionen als Nutzenbeweis";
  if (/benefit|nutzen|vorteil/.test(lower)) return "Nutzenkarten aus Inhaltsquelle";
  if (/workflow|prozess|how|ablauf/.test(lower)) return "Produktlogik und Ablauf";
  if (/proof|trust|kunden|beweis/.test(lower)) return "Vertrauen ohne erfundene Zahlen";
  if (/faq|frage/.test(lower)) return "Einwandbehandlung";
  if (/cta|kontakt|final/.test(lower)) return "Abschluss-CTA";
  return index < 2 ? "Obere Seitenlogik der Vorlage" : "Passende neue Inhaltssektion";
}

function buildBlueprintLandingPage({ projectName, source = {}, templateAnalysis = {}, contentAnalysis = {} }) {
  const ctas = takeItems(templateAnalysis.ctas, 2, ["Demo ansehen", "Gespräch starten"]);
  const benefits = takeItems(contentAnalysis.benefits, 4, ["Klarere Entscheidungen", "Weniger manuelle Arbeit", "Professioneller Ablauf", "Besserer Überblick"]);
  const features = takeItems(contentAnalysis.features, 6, ["Geführter Workflow", "Strukturierte Auswertung", "Exportfähige Ergebnisse", "Saubere Übersicht", "Praxisnahe Inhalte", "Schnelle Weiterbearbeitung"]);
  const proof = takeItems(contentAnalysis.proof, 3, ["Aus realer App-Quelle abgeleitet", "Keine erfundenen Referenzen", "Qualitätslogik im Briefing dokumentiert"]);
  const rawSummary = takeItems(contentAnalysis.rawSummary, 5, [contentAnalysis.offer]);
  const sections = takeItems(templateAnalysis.sections, 8, ["Hero", "Problem", "Nutzen", "Workflow", "Features", "Proof", "FAQ", "Final CTA"]);
  const screenshot = source.screenshotUrl ? `linear-gradient(90deg, rgba(10,16,19,.92), rgba(10,16,19,.76) 45%, rgba(10,16,19,.38)), url("${cssUrl(source.screenshotUrl)}")` : "linear-gradient(115deg, rgba(10,16,19,.96), rgba(13,74,69,.88) 52%, rgba(185,135,47,.46))";
  const templateMap = sections
    .map((section, index) => `<li><span>Vorlage ${index + 1}</span><strong>${escapeHtml(section)}</strong><em>${escapeHtml(mapSectionPurpose(section, index))}</em></li>`)
    .join("");

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(projectName)}</title>
    <style>
      :root { --ink:#10181c; --ink-2:#172327; --muted:#64747b; --line:#dde7ea; --paper:#fbfaf7; --panel:#fff; --soft:#eef5f4; --accent:#0e7c72; --accent-dark:#075c55; --gold:#b8872f; --shadow:0 22px 58px rgba(16,24,28,.12); }
      *{box-sizing:border-box} html{scroll-behavior:smooth} body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper)} a{color:inherit}
      .site-nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:22px;min-height:74px;padding:0 clamp(20px,5vw,76px);border-bottom:1px solid rgba(221,231,234,.9);background:rgba(255,255,255,.94);backdrop-filter:blur(16px)}
      .brand{display:flex;align-items:center;gap:12px;font-weight:900}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:var(--ink);color:#fff;font-size:13px}.nav-links{display:flex;align-items:center;gap:24px;color:var(--muted);font-size:14px;font-weight:740}
      .btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:850;box-shadow:0 16px 36px rgba(14,124,114,.22)}.btn.secondary{border-color:rgba(255,255,255,.46);background:rgba(255,255,255,.12);box-shadow:none}
      .hero{min-height:calc(100vh - 74px);display:grid;align-items:end;padding:clamp(86px,10vw,138px) clamp(20px,5vw,76px) clamp(54px,7vw,82px);color:#fff;background-image:${screenshot};background-size:cover;background-position:center}.hero-inner{width:min(940px,100%)}.eyebrow{margin:0 0 14px;color:#f1c478;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0}
      h1{max-width:980px;margin:0 0 22px;font-size:clamp(44px,7vw,88px);line-height:.96;letter-spacing:0}.lead{max-width:780px;margin:0;color:rgba(255,255,255,.82);font-size:clamp(18px,2vw,23px);line-height:1.58}.hero-actions{display:flex;flex-wrap:wrap;gap:13px;margin-top:34px}.trust-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px;color:rgba(255,255,255,.78)}.trust-row span{border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:9px 12px;background:rgba(255,255,255,.08);backdrop-filter:blur(10px)}
      section{padding:clamp(64px,8vw,108px) clamp(20px,5vw,76px)}.section-head{max-width:800px;margin-bottom:34px}h2{margin:0 0 14px;font-size:clamp(31px,4.2vw,56px);line-height:1.05;letter-spacing:0}h3{margin:0 0 10px;font-size:19px}p{color:var(--muted);line-height:1.68}.band{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
      .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.card{min-height:210px;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:24px;box-shadow:var(--shadow)}.card small{display:block;margin-bottom:18px;color:var(--gold);font-weight:900;text-transform:uppercase}
      .workflow{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(0,1.15fr);gap:clamp(28px,5vw,72px);align-items:start}.steps{display:grid;gap:13px;counter-reset:step}.step{counter-increment:step;display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px;border:1px solid var(--line);border-radius:8px;padding:20px;background:var(--soft)}.step:before{content:counter(step);display:grid;place-items:center;width:44px;height:44px;border-radius:8px;background:var(--ink);color:#fff;font-weight:900}
      .feature-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.feature{border-left:3px solid var(--accent);background:#fff;padding:18px 18px 18px 20px}.proof{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.proof-item{border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:24px}.faq{display:grid;gap:12px}details{border:1px solid var(--line);border-radius:8px;background:#fff;padding:18px 20px}summary{cursor:pointer;font-weight:850}
      .mapping{background:var(--ink);color:#fff}.mapping p{color:#c8d3d6}.mapping ol{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:0;list-style:none}.mapping li{border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:16px;background:rgba(255,255,255,.06)}.mapping span,.mapping em{display:block;color:#aebcc1;font-style:normal;font-size:13px}
      .final-cta{text-align:center;background:var(--ink);color:#fff}.final-cta p{max-width:720px;margin:0 auto 26px;color:#c8d3d6}
      @media(max-width:980px){.grid,.feature-list,.proof,.mapping ol{grid-template-columns:repeat(2,minmax(0,1fr))}.workflow{grid-template-columns:1fr}}@media(max-width:680px){.nav-links a:not(.btn){display:none}.grid,.feature-list,.proof,.mapping ol{grid-template-columns:1fr}h1{font-size:42px}.hero{min-height:720px}.btn{width:100%}}
    </style>
  </head>
  <body>
    <!-- Vorlage: Header -> Neuer App-Header -->
    <nav class="site-nav"><div class="brand"><span class="brand-mark">BS</span>${escapeHtml(projectName)}</div><div class="nav-links"><a href="#nutzen">Nutzen</a><a href="#workflow">Workflow</a><a class="btn" href="#kontakt">${escapeHtml(ctas[0])}</a></div></nav>
    <!-- Vorlage: Hero -> Neue App Hero -->
    <header class="hero"><div class="hero-inner"><p class="eyebrow">${escapeHtml(templateAnalysis.style || "BuiltSmart Premium")}</p><h1>${escapeHtml(contentAnalysis.headline)}</h1><p class="lead">${escapeHtml(contentAnalysis.offer)}</p><div class="hero-actions"><a class="btn" href="#kontakt">${escapeHtml(ctas[0])}</a><a class="btn secondary" href="#workflow">${escapeHtml(ctas[1])}</a></div><div class="trust-row">${proof.map((item) => `<span>${escapeHtml(titleFromText(item, "Qualitaet"))}</span>`).join("")}</div></div></header>
    <!-- Vorlage: Template-Mapping -> Umsetzungskontrolle -->
    <section class="mapping"><div class="section-head"><p class="eyebrow">Template-Mapping</p><h2>Der Aufbau folgt dem Blueprint der Vorlage.</h2><p>Die Struktur wurde aus den erkannten Vorlage-Sections abgeleitet und mit Inhalten der neuen Anwendung befüllt.</p></div><ol>${templateMap}</ol></section>
    <!-- Vorlage: Nutzenkarten -> App-Nutzen -->
    <section id="nutzen"><div class="section-head"><p class="eyebrow">Nutzen</p><h2>Was für Nutzer konkret besser wird</h2><p>${escapeHtml(rawSummary[0] || contentAnalysis.offer)}</p></div><div class="grid">${benefits.map((item, index) => `<article class="card"><small>0${index + 1}</small><h3>${escapeHtml(titleFromText(item, "Nutzen"))}</h3><p>${escapeHtml(item)}</p></article>`).join("")}</div></section>
    <!-- Vorlage: Workflow/Product Logic -> Neuer App-Workflow -->
    <section id="workflow" class="band"><div class="workflow"><div class="section-head"><p class="eyebrow">Workflow</p><h2>Vom Bedarf zur verwertbaren Entscheidung</h2><p>Die Landingpage erklärt nicht nur Features, sondern macht die Produktlogik der Anwendung nachvollziehbar.</p></div><div class="steps">${features.slice(0, 4).map((item) => `<div class="step"><div><h3>${escapeHtml(titleFromText(item, "Schritt"))}</h3><p>${escapeHtml(item)}</p></div></div>`).join("")}</div></div></section>
    <!-- Vorlage: Feature Grid -> Funktionen als Nutzenbeweis -->
    <section><div class="section-head"><p class="eyebrow">Funktionen</p><h2>Features, die den Nutzen sichtbar machen</h2><p>Jede Funktion wird als Beleg für das Nutzenversprechen eingesetzt, nicht als trockene Liste.</p></div><div class="feature-list">${features.map((item) => `<article class="feature"><h3>${escapeHtml(titleFromText(item, "Feature"))}</h3><p>${escapeHtml(item)}</p></article>`).join("")}</div></section>
    <!-- Vorlage: Proof/Trust -> Vertrauenslogik -->
    <section class="band"><div class="section-head"><p class="eyebrow">Vertrauen</p><h2>Glaubwürdig ohne erfundene Zahlen</h2><p>Die Aussagen bleiben nah an der Inhaltsquelle und dokumentieren Annahmen transparent im Briefing.</p></div><div class="proof">${proof.map((item) => `<article class="proof-item"><h3>${escapeHtml(titleFromText(item, "Proof"))}</h3><p>${escapeHtml(item)}</p></article>`).join("")}</div></section>
    <!-- Vorlage: FAQ/Einwände -> Entscheidungsfragen -->
    <section><div class="section-head"><p class="eyebrow">FAQ</p><h2>Fragen, die vor der Entscheidung wichtig sind</h2></div><div class="faq"><details open><summary>Für wen ist ${escapeHtml(projectName)} gedacht?</summary><p>${escapeHtml(rawSummary[1] || contentAnalysis.offer)}</p></details><details><summary>Was unterscheidet die Anwendung von einer reinen Informationsseite?</summary><p>${escapeHtml(benefits[0])}</p></details><details><summary>Welche Ergebnisse kann ich erwarten?</summary><p>${escapeHtml(benefits[1] || benefits[0])}</p></details><details><summary>Wie kann die Seite final veredelt werden?</summary><p>Mit echtem Screenshot, konkretem CTA und geprüften Proof-Elementen lässt sich diese Seite in Codex weiter professionalisieren.</p></details></div></section>
    <!-- Vorlage: Final CTA -> Abschluss -->
    <section id="kontakt" class="final-cta"><p class="eyebrow">Nächster Schritt</p><h2>${escapeHtml(projectName)} klar positionieren.</h2><p>${escapeHtml(contentAnalysis.offer)}</p><a class="btn" href="#">${escapeHtml(ctas[0])}</a></section>
  </body>
</html>`;
}

function buildEmergencyLandingPage({ projectName, headline, offer }) {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(projectName)}</title>
    <style>
      body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#142025;background:#f7faf9}
      header{padding:80px 7vw;background:#10181c;color:#fff}
      main{padding:56px 7vw;display:grid;gap:24px}
      h1{font-size:clamp(40px,6vw,72px);line-height:1;margin:0 0 18px}
      p{font-size:18px;line-height:1.7;color:#5f7078}
      header p{color:#d7e0e3;max-width:760px}
      section{background:#fff;border:1px solid #dfe8eb;border-radius:8px;padding:28px}
    </style>
  </head>
  <body>
    <header>
      <strong>${escapeHtml(projectName)}</strong>
      <h1>${escapeHtml(headline)}</h1>
      <p>${escapeHtml(offer)}</p>
    </header>
    <main>
      <section>
        <h2>Landingpage-Entwurf</h2>
        <p>Die KI-Antwort war strukturell unvollständig. Diese sichere Ersatzseite verhindert Datenverlust; Details stehen im Briefing und können erneut verfeinert werden.</p>
      </section>
    </main>
  </body>
</html>`;
}

function buildEmergencyBrief({ projectName, headline, offer }) {
  return `# ${projectName}

## Hinweis
Die KI-Antwort war nicht vollständig strukturiert. Die App hat deshalb ein sicheres Basis-Ergebnis erzeugt, statt die Analyse abzubrechen.

## Erkannte Richtung
- Headline: ${headline}
- Angebot: ${offer}

## Nächster Schritt
Analyse erneut starten oder dieses Briefing mit Codex weiter verfeinern.`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
  const path = cleanPath === "/" ? "/index.html" : cleanPath;
  const filePath = join(root, path);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store, max-age=0",
    });
    res.end(content);
  } catch {
    const index = await readFile(join(root, "index.html"));
    res.writeHead(200, { "content-type": mimeTypes[".html"], "cache-control": "no-store, max-age=0" });
    res.end(index);
  }
}

createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }
  if (req.method === "POST" && req.url === "/api/read-url") {
    readUrl(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/generate-ai") {
    generateAiLandingPage(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/test-anthropic") {
    testAnthropicConnection(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(port, "127.0.0.1", () => {
  logLine(`SMART APP & Landingpage Builder läuft auf http://127.0.0.1:${port}`);
});
