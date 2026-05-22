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
        "user-agent": "SMART APP&Landingpage Builder/1.0",
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
    const apiKey = body.apiKey || process.env.OPENAI_API_KEY;
    const model = body.model || "gpt-5-mini";
    if (!apiKey) {
      sendJson(res, 400, { error: "Bitte OpenAI API-Key eingeben oder OPENAI_API_KEY setzen." });
      return;
    }

    const project = body.project || {};
    const source = {
      name: project.name || "SMART APP&Landingpage Builder",
      audience: project.audience || "",
      templateUrl: project.templateUrl || "",
      contentUrl: project.contentUrl || "",
      screenshotUrl: project.screenshotUrl || "",
      templateText: compactText(body.templateText),
      contentText: compactText(body.contentText),
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        instructions: `Du bist ein Senior Conversion-Copywriter und Frontend-Designer fuer BuiltSmart-Apps.
Erstelle eine eigenstaendige Premium-Landingpage im Stil SMART-SnippetFlow:
- heller Header ueber volle Breite
- starker Hero mit echtem App-Screenshot als Hintergrund, falls screenshotUrl vorhanden
- dunkles Overlay im Hero
- klare grosse Typografie
- ruhige professionelle Farben
- hochwertige Buttons
- dezente Karten
- grosszuegige Abstaende
- keine laute SaaS-Seite
- keine abstrakten Illustrationen
Gib ausschliesslich valides JSON gemaess Schema zurueck.`,
        input: [
          {
            role: "user",
            content: `Erstelle aus diesen Daten eine hochwertige Landingpage und ein Codex-freundliches Briefing.

Projekt:
${JSON.stringify(source, null, 2)}

Anforderungen:
- landingPageHtml muss eine vollstaendige, eigenstaendige HTML-Datei mit inline CSS sein.
- Die Landingpage muss deutsch sein.
- Die Texte muessen deutlich besser, spezifischer und verkaufsstaerker sein als eine reine Zusammenfassung.
- Verwende keine externen CDNs.
- Wenn screenshotUrl vorhanden ist, nutze ihn im Hero per CSS background-image mit dunklem Overlay.
- Wenn keine Quelle ausreichend ist, verwende die manuellen Inhalte und markiere Annahmen im Briefing.
- Keine Platzhalter wie Lorem ipsum.
- CTA realistisch und klar.
- briefMarkdown soll enthalten: Positionierung, Zielgruppe, Seitenstruktur, genutzte Quellen, Annahmen, naechste Codex-Schritte.`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "landingpage_builder_output",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                templateAnalysis: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    headline: { type: "string" },
                    style: { type: "string" },
                    sectionCount: { type: "number" },
                    sections: { type: "array", items: { type: "string" } },
                    ctas: { type: "array", items: { type: "string" } },
                  },
                  required: ["headline", "style", "sectionCount", "sections", "ctas"],
                },
                contentAnalysis: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    offer: { type: "string" },
                    headline: { type: "string" },
                    benefits: { type: "array", items: { type: "string" } },
                    features: { type: "array", items: { type: "string" } },
                    proof: { type: "array", items: { type: "string" } },
                    rawSummary: { type: "array", items: { type: "string" } },
                  },
                  required: ["offer", "headline", "benefits", "features", "proof", "rawSummary"],
                },
                landingPageHtml: { type: "string" },
                briefMarkdown: { type: "string" },
              },
              required: ["templateAnalysis", "contentAnalysis", "landingPageHtml", "briefMarkdown"],
            },
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      sendJson(res, response.status, { error: data.error?.message || "OpenAI Anfrage fehlgeschlagen." });
      return;
    }

    const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text;
    if (!outputText) {
      sendJson(res, 502, { error: "OpenAI Antwort enthielt keinen Text." });
      return;
    }

    sendJson(res, 200, JSON.parse(outputText));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "KI-Erstellung fehlgeschlagen." });
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
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`SMART APP&Landingpage Builder läuft auf http://127.0.0.1:${port}`);
});
