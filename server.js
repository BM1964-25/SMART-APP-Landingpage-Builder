import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 8171);
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const anthropicModelsEndpoint = "https://api.anthropic.com/v1/models";
const defaultAnthropicModel = "claude-3-5-sonnet-20241022";
const allowedAnthropicModels = new Set([
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

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
    const configured = getConfiguredAnthropicModel();
    const model = models.includes(configured) ? configured : models[0] || configured;
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: pickResponseHeaders(response),
      model,
      modelSource: models.includes(configured) ? "configured" : models[0] ? "models_api_first" : "fallback",
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
  console.log("--- ANTHROPIC API DIAGNOSE ---");
  console.log("Endpoint:", diagnostics.endpoint);
  console.log("Method:", diagnostics.method);
  console.log("Trailing Slash:", diagnostics.hasTrailingSlash);
  console.log("Content-Type:", diagnostics.contentType);
  console.log("Body-Typ:", diagnostics.bodyType);
  console.log("Body JSON valide:", diagnostics.bodyIsJson);
  console.log("Modell:", diagnostics.model);
  console.log("Modell-Quelle:", diagnostics.modelSource);
  console.log("Models API Status:", diagnostics.modelsStatus);
  console.log("Models API Server:", diagnostics.modelsResponseServer || "-");
  console.log("Models API Content-Type:", diagnostics.modelsResponseContentType || "-");
  console.log("Verfuegbare Modelle:", diagnostics.availableModels.join(", ") || "-");
  console.log("Key-Quelle:", diagnostics.keySource);
  console.log("Key vorhanden:", diagnostics.keyPresent);
  console.log("Key-Prefix:", diagnostics.keyPrefix);
  console.log("Key beginnt sk-ant-api03-:", diagnostics.keyStartsSkAntApi03);
  console.log("Key beginnt sk-ant-:", diagnostics.keyStartsSkAnt);
  console.log("Key-Laenge:", diagnostics.keyLength);
  console.log("Key durch Normalisierung veraendert:", diagnostics.keyChangedByNormalizer);
  console.log("Key enthaelt Whitespace:", diagnostics.keyHasWhitespace);
  console.log("Key enthaelt Maske:", diagnostics.keyHasMask);
  if (diagnostics.responseStatus) console.log("Anthropic Status:", diagnostics.responseStatus);
  if (diagnostics.responseStatusText) console.log("Anthropic Status Text:", diagnostics.responseStatusText);
  if (diagnostics.responseServer) console.log("Anthropic Response Server:", diagnostics.responseServer);
  if (diagnostics.responseContentType) console.log("Anthropic Response Content-Type:", diagnostics.responseContentType);
  if (diagnostics.responseRequestId) console.log("Anthropic Request ID:", diagnostics.responseRequestId);
  if (diagnostics.apiError) console.log("Anthropic API Fehler:", diagnostics.apiError);
  if (diagnostics.error) console.log("Fehler:", diagnostics.error);
}

function humanizeServerError(message = "") {
  if (/model/i.test(message) && /pattern|not found|invalid/i.test(message)) {
    return `Interne Anthropic-Modellkennung war ungültig. Standard ist jetzt ${defaultAnthropicModel}.`;
  }
  if (/the string did not match the expected pattern|string did not match|expected pattern/i.test(message)) {
    return `Anthropic konnte den Request nicht annehmen. Geprüft: POST ${anthropicEndpoint}, Modell ${defaultAnthropicModel}.`;
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

Gib ausschliesslich valides JSON zurueck. Keine Markdown-Codefences, keine Erklaerung ausserhalb des JSON.`,
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
      }),
    });

    const { data, text: responseText } = await readJsonResponse(response);
    if (!response.ok) {
      const apiError = data.error?.message || responseText.slice(0, 180) || "Anthropic Anfrage fehlgeschlagen.";
      sendJson(res, response.status, { error: humanizeAnthropicApiError(apiError), diagnostics: buildApiDiagnostics({ rawKey, apiKey, model, modelLookup, response, responseText, apiError }) });
      return;
    }

    const outputText = data.content?.find((item) => item.type === "text")?.text;
    if (!outputText) {
      sendJson(res, 502, { error: "Anthropic Antwort enthielt keinen Text." });
      return;
    }

    sendJson(res, 200, { ...parseJsonResponse(outputText), diagnostics: buildApiDiagnostics({ rawKey, apiKey, model, modelLookup, response, responseText }) });
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
}).listen(port, () => {
  console.log(`SMART APP & Landingpage Builder läuft auf http://127.0.0.1:${port}`);
});
