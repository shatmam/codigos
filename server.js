const express = require("express");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app = express();
// ✅ PUERTO DINÁMICO PARA RAILWAY
const PORT = process.env.PORT || 3000;

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

/* ================= CONFIG FILTROS ================= */
const GMAIL_FILTER = "from:info@account.netflix.com newer_than:2h";
const REQUIRED_PHRASES = [
  "tu código de acceso",
  "código de acceso temporal",
  "ingresa este código para iniciar sesión",
  "escribe este código para iniciar sesión",
  "iniciar sesión",
  "hogar",
  "actualizar tu hogar",
  "¿solicitaste actualizar tu hogar con netflix?"
];

app.use(express.static(path.join(__dirname, "public")));

// ✅ FUNCIÓN PARA CARGAR CREDENCIALES DESDE VARIABLE O ARCHIVO
function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  if (fs.existsSync(CREDENTIALS_PATH)) {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  }
  throw new Error("No se encontraron credenciales (Variable GOOGLE_CREDENTIALS o archivo json)");
}

// ✅ FUNCIÓN PARA CARGAR TOKEN DESDE VARIABLE O ARCHIVO
function getToken() {
  if (process.env.GOOGLE_TOKEN) {
    return JSON.parse(process.env.GOOGLE_TOKEN);
  }
  if (fs.existsSync(TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(TOKEN_PATH));
  }
  return null;
}

/* ================= RUTAS ================= */

app.get("/api/emails", async (req, res) => {
  try {
    const credentials = getCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.web;
    
    // Usamos el primer redirect_uri (recuerda actualizarlo en Google Console)
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const token = getToken();
    if (!token) return res.status(401).json({ error: "No hay token de acceso" });

    oAuth2Client.setCredentials(token);
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const response = await gmail.users.messages.list({
      userId: "me",
      q: GMAIL_FILTER,
    });

    if (!response.data.messages) return res.json({ emails: [] });

    const emails = [];
    for (const msg of response.data.messages) {
      const detail = await gmail.users.messages.get({ userId: "me", id: msg.id });
      const payload = detail.data.payload;
      
      let html = "";
      if (payload.parts) {
        const part = payload.parts.find(p => p.mimeType === "text/html");
        if (part && part.body.data) {
          html = Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      } else if (payload.body.data) {
        html = Buffer.from(payload.body.data, "base64").toString("utf-8");
      }

      const header = (headers, name) => {
        const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : "";
      };

      const subjectRaw = header(payload.headers, "Subject") || "";
      const subject = subjectRaw.toLowerCase();
      const body = html.toLowerCase();

      const match = REQUIRED_PHRASES.some(p => subject.includes(p) || body.includes(p));
      if (!match) continue;

      emails.push({
        subject: subjectRaw,
        from: header(payload.headers, "From"),
        date: header(payload.headers, "Date"),
        html
      });
    }

    res.json({ emails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ ESCUCHA EN 0.0.0.0 PARA ACCESO EXTERNO
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor listo en puerto ${PORT}`);
});