import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 8171);

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
  if (!/^[\x21-\x7e]+$/.test(apiKey)) return "Der API-Key enthält ein nicht erlaubtes Sonderzeichen. Bitte den Key frisch und ohne Anführungszeichen einfügen.";
  return "";
}

function humanizeServerError(message = "") {
  if (/model/i.test(message) && /pattern|not found|invalid/i.test(message)) {
    return "Interne Anthropic-Modellkennung war ungültig. Die App wurde auf eine gültige Sonnet-ID umgestellt.";
  }
  if (/expected pattern|string did not match|header value|bytestring|invalid character/i.test(message)) {
    return "Der gespeicherte API-Key ist beschädigt oder enthält Zeichen, die nicht an Anthropic gesendet werden können. Bitte den Original-Key einmal neu einfügen.";
  }
  return message || "Anthropic Anfrage fehlgeschlagen.";
}

function humanizeAnthropicApiError(message = "") {
  if (/model/i.test(message) && /pattern|not found|invalid/i.test(message)) {
    return "Anthropic-Modellkennung war ungültig. Bitte Server neu laden; Standard ist jetzt claude-sonnet-4-5-20250929.";
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
    const apiKey = normalizeApiKey(decodeApiKey(body) || process.env.ANTHROPIC_API_KEY);
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
    const keyError = validateAnthropicKey(apiKey);
    if (keyError) {
      sendJson(res, 400, { error: keyError });
      return;
    }

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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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

    const data = await response.json();
    if (!response.ok) {
      sendJson(res, response.status, { error: humanizeAnthropicApiError(data.error?.message || "Anthropic Anfrage fehlgeschlagen.") });
      return;
    }

    const outputText = data.content?.find((item) => item.type === "text")?.text;
    if (!outputText) {
      sendJson(res, 502, { error: "Anthropic Antwort enthielt keinen Text." });
      return;
    }

    sendJson(res, 200, parseJsonResponse(outputText));
  } catch (error) {
    sendJson(res, 500, { error: humanizeServerError(error.message) });
  }
}

async function testAnthropicConnection(req, res) {
  try {
    const body = await readJsonBody(req, 30_000);
    const apiKey = normalizeApiKey(decodeApiKey(body) || process.env.ANTHROPIC_API_KEY);
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
    const keyError = validateAnthropicKey(apiKey);
    if (keyError) {
      sendJson(res, 400, { error: keyError });
      return;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
    const data = await response.json();
    if (!response.ok) {
      sendJson(res, response.status, { ok: false, error: humanizeAnthropicApiError(data.error?.message || "Anthropic Verbindung fehlgeschlagen.") });
      return;
    }

    const text = data.content?.find((item) => item.type === "text")?.text || "";
    sendJson(res, 200, { ok: true, model, text: text.trim() });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: humanizeServerError(error.message) });
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
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    const index = await readFile(join(root, "index.html"));
    res.writeHead(200, { "content-type": mimeTypes[".html"] });
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
