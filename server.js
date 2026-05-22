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
      templateText: compactText(body.templateText),
      contentText: compactText(body.contentText),
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
2. Analysiere die Vorlage: Layoutmuster, Hero-Aufbau, Header, Sektionen, CTA-System, visuelle Hierarchie, Farben, Typografie, Button-Stil, Card-Stil, Abstaende, Tonalitaet.
3. Analysiere die Inhaltsquelle: Angebot, Zielgruppe, Schmerzpunkte, Nutzen, Features, Workflow, Proof, CTA, Fachbegriffe, konkrete App-Funktionen.
4. Trenne strikt: "aus Quelle erkannt" vs. "Annahme". Erfinde keine Fakten.
5. Verdichte daraus ein scharfes Landingpage-Konzept.
6. Schreibe die Seite neu, nicht nur umsortiert.
7. Fuehre vor der Ausgabe intern eine Selbstpruefung durch: Wenn das Ergebnis generisch klingt, verbessere es.

Gib das Ergebnis ausschliesslich ueber das Tool deliver_landing_page zurueck. Schreibe keine separate Textantwort.`,
        messages: [
          {
            role: "user",
            content: `Erstelle aus diesen Daten eine High-Professional-Landingpage und ein Codex-freundliches Briefing.

Projekt:
${JSON.stringify(source, null, 2)}

Nicht verhandelbare Anforderungen:
- Hole die Vorgaben primaer selbst aus templateText und contentText.
- Nutze templateText fuer Design, Struktur, Stil, CTA-Logik und Seitenmuster.
- Nutze contentText fuer App-Inhalte, Nutzen, Zielgruppe, Features, Workflow und Proof.
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
1. Header: hell, minimal, Markenname links, 2-3 Navigationlinks, starker CTA rechts.
2. Hero: grosser Screenshot-Hintergrund oder hochwertiger dunkler Fallback, dunkles Overlay, praezise Headline, Subline, Primary/Secondary CTA, 2-3 Trust-/Outcome-Pills.
3. Problem/Context: Warum die Zielgruppe diese App braucht, konkret statt allgemein.
4. Nutzenkarten: 3-4 hochwertige Nutzen, jede mit klarer Konsequenz fuer Nutzer.
5. Workflow/Produktlogik: Wie die App arbeitet, in 3-5 Schritten.
6. Feature-Section: Features nur als Beweis fuer Nutzen, nicht als trockene Liste.
7. Proof/Trust: Wenn keine echten Beweise vorhanden sind, formuliere glaubwuerdige Prozess- und Qualitaetsargumente ohne falsche Zahlen.
8. FAQ oder Einwandbehandlung: 3-4 echte Entscheidungsfragen.
9. Final CTA: ruhig, klar, handlungsorientiert.

Designregeln:
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
  const landingPageHtml = String(result.landingPageHtml || "").trim();

  return {
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
    landingPageHtml: landingPageHtml || buildEmergencyLandingPage({ projectName, headline, offer }),
    briefMarkdown: String(result.briefMarkdown || buildEmergencyBrief({ projectName, headline, offer })).trim(),
  };
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
