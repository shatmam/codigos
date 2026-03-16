const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ================= CONFIG =================
const EMAIL_USER = "digitalesservicios311@gmail.com";
const EMAIL_PASS = "rfbmuirunbfwcara";
const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY";
const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";
const ADMIN_PHONE = "18494736782";

// ================= WHATSAPP =================
async function enviarWA(tel, msj) {
  const url = "https://www.wasenderapi.com/api/send-message";
  try {
    let numero = tel.toString().replace(/[^0-9]/g, "");
    if (!numero.startsWith("1") && numero.length === 10) numero = "1" + numero;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ to: "+" + numero, text: msj })
    });
    console.log(`📲 Enviado a ${numero}. Respuesta API: ${await response.text()}`);
  } catch (error) { console.log("❌ Error WA:", error.message); }
}

// ================= PROCESAR =================
async function procesarYNotificar(correoNetflix, parsedEmail) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Hoja1!A2:K500" });
    const clientes = res.data.values || [];

    // Limpieza de texto para evitar el "undefined"
    const texto = (parsedEmail.text || "").toLowerCase();
    const html = parsedEmail.html || "";

    // 1. Detección de Perfil (Búsqueda más profunda)
    let perfilCorreo = "";
    const matchPerfil = texto.match(/hola,?\s*(\d+):/i) || texto.match(/perfil\s*(\d+)/i) || html.match(/>Perfil\s*(\d+)</i);
    if (matchPerfil) perfilCorreo = matchPerfil[1].trim();
    else if (texto.includes("cristal")) perfilCorreo = "cristal";

    // 2. Detección de Contenido (Código o Link)
    const codMatch = texto.match(/\b\d{4}\b/);
    let codigo = (codMatch && codMatch[0] !== "2026") ? codMatch[0] : null;

    const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || 
                      html.match(/href="([^"]*confirm-account[^"]*)"/) ||
                      html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);

    const infoUtil = codigo || (linkMatch ? linkMatch[1] : null);

    // 3. Buscar en Excel
    const cliente = clientes.find(f => {
      const correoExcel = (f[4] || "").toLowerCase().trim();
      const perfilExcel = (f[6] || "").toString().toLowerCase().trim();
      return correoExcel === correoNetflix.toLowerCase().trim() && (perfilExcel === perfilCorreo || perfilExcel === "completa");
    });

    const FRASE = "\n\nEste mensaje es automático. Contacta tu proveedor.";

    if (cliente && infoUtil) {
      let mensaje = codigo ? 
        `🍿 *NETFLIX CÓDIGO*\n\nHola *${cliente[1]}*, tu código es: *${codigo}*${FRASE}` :
        `🔗 *NETFLIX ACCESO*\n\nHola *${cliente[1]}*, accede aquí:\n${linkMatch[1]}${FRASE}`;
      
      await enviarWA(cliente[2], mensaje);
    } else if (infoUtil) {
      // Si hay código pero no sabemos de quién es, va al Admin
      await enviarWA(ADMIN_PHONE, `⚠️ *AVISO ADMIN*\n\nCuenta: ${correoNetflix}\nPerfil Detectado: ${perfilCorreo || "Desconocido"}\nContenido: ${infoUtil}`);
    }
    
    return infoUtil; // Devolvemos el contenido para el panel
  } catch (error) { console.log("❌ Error:", error.message); return "Error extrayendo datos"; }
}

app.get("/api/emails", async (req, res) => {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const list = await client.search({ from: "netflix" });
    let emails = [];

    for (let seq of list.slice(-5).reverse()) {
      const msg = await client.fetchOne(seq, { source: true, envelope: true });
      const parsed = await simpleParser(msg.source);
      
      // Procesamos y obtenemos lo que antes salía como "undefined"
      const contenidoExtraido = await procesarYNotificar(msg.envelope.to[0].address, parsed);

      emails.push({
        subject: msg.envelope.subject,
        date: new Date(msg.envelope.date).toLocaleString("es-DO"),
        to: msg.envelope.to[0].address,
        html: contenidoExtraido || "No se detectó código/link" 
      });
    }
    await client.logout();
    res.json({ emails });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor corregido"); });
