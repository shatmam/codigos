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

    if (!numero.startsWith("1")) {
      numero = "1" + numero;
    }

    let phone = "+" + numero;

    console.log("📲 Enviando WA:", phone);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: phone,
        text: msj
      })
    });

    const data = await response.text();

    console.log("📩 Respuesta WA:", data);

  } catch (error) {

    console.log("❌ Error WhatsApp:", error.message);

  }

}


// ================= GOOGLE SHEETS =================

async function obtenerClientes() {

  try {

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({
      version: "v4",
      auth
    });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Hoja1!A2:K500"
    });

    return res.data.values || [];

  } catch (error) {

    console.log("❌ Error Sheets:", error.message);
    return [];

  }

}


// ================= PROCESAR CORREO =================

async function procesarYNotificar(correoNetflix, parsedEmail) {

  try {

    const clientes = await obtenerClientes();

    const texto = (parsedEmail.text || "").toLowerCase();
    const html = parsedEmail.html || "";

    // detectar perfil
    let perfilCorreo = "";

    const matchPerfil =
      texto.match(/hola,?\s*(\d+):/i) ||
      texto.match(/perfil\s*(\d+)/i);

    if (matchPerfil) perfilCorreo = matchPerfil[1];

    // limpiar correo
    const correoLimpio = correoNetflix
      .toLowerCase()
      .replace(/\+.*@/, "@")
      .trim();

    const cliente = clientes.find(f => {

      const correo = (f[4] || "")
        .toLowerCase()
        .replace(/\+.*@/, "@")
        .trim();

      const perfil = (f[6] || "").toLowerCase().trim();

      if (perfilCorreo) {

        return correo === correoLimpio &&
          (perfil === perfilCorreo || perfil === "completa");

      }

      return correo === correoLimpio;

    });

    // detectar codigo
    let codigo = null;

    const codMatch =
      texto.match(/\b\d{4,6}\b/) ||
      html.match(/\b\d{4,6}\b/);

    if (codMatch) codigo = codMatch[0];

    // detectar link
    const linkMatch =
      html.match(/href="([^"]*update-home[^"]*)"/) ||
      html.match(/href="([^"]*confirm-account[^"]*)"/) ||
      html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);

    const FRASE =
      "\n\nEste mensaje es automático. Contacta tu proveedor.";

    if (cliente) {

      const nombre = cliente[1];
      const telefono = cliente[2];

      let mensaje = "";

      if (codigo) {

        mensaje =
          `🍿 *NETFLIX CODIGO*\n\nHola *${nombre}*\n\nTu código es: *${codigo}*${FRASE}`;

      }

      if (linkMatch) {

        mensaje =
          `🔗 *NETFLIX ACCESO*\n\nHola *${nombre}*\n\nAccede aquí:\n${linkMatch[1]}${FRASE}`;

      }

      if (mensaje) {

        await enviarWA(telefono, mensaje);

      }

    } else {

      console.log("⚠️ Cliente no encontrado");

      const contenido = codigo || (linkMatch ? linkMatch[1] : "Sin código");

      await enviarWA(
        ADMIN_PHONE,
        `⚠️ AVISO ADMIN\n\nCuenta: ${correoNetflix}\nContenido: ${contenido}`
      );

    }

  } catch (error) {

    console.log("❌ Error procesando correo:", error.message);

  }

}


// ================= API CORREOS =================

app.get("/api/emails", async (req, res) => {

  console.log("📬 Buscando correos Netflix...");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });

  try {

    await client.connect();

    await client.mailboxOpen("INBOX");

    const list = await client.search({
      from: "netflix"
    });

    let emails = [];

    for (let seq of list.slice(-5).reverse()) {

      const msg = await client.fetchOne(seq, {
        source: true,
        envelope: true
      });

      const parsed = await simpleParser(msg.source);

      const texto = (parsed.text || "").toLowerCase();
      const html = parsed.html || "";

      let codigo = null;

      const codMatch =
        texto.match(/\b\d{4,6}\b/) ||
        html.match(/\b\d{4,6}\b/);

      if (codMatch) codigo = codMatch[0];

      const linkMatch =
        html.match(/href="([^"]*update-home[^"]*)"/) ||
        html.match(/href="([^"]*confirm-account[^"]*)"/);

      let contenido = "Sin código";

      if (codigo) contenido = codigo;
      if (linkMatch) contenido = linkMatch[1];

      const correoDestino =
        parsed.to?.value?.[0]?.address ||
        msg.envelope.to?.[0]?.address ||
        "";

      const correoCompleto =
        parsed.to?.text || correoDestino;

      await procesarYNotificar(correoDestino, parsed);

      emails.push({
        subject: msg.envelope.subject,
        date: new Date(msg.envelope.date).toLocaleString("es-DO"),
        to: correoCompleto,
        contenido: contenido
      });

    }

    await client.logout();

    res.json({ emails });

  } catch (error) {

    console.log("❌ Error IMAP:", error.message);

    try { await client.logout(); } catch {}

    res.status(500).json({ error: "Error leyendo correos" });

  }

});


// ================= SERVIDOR =================

app.listen(PORT, "0.0.0.0", () => {

  console.log("🚀 Servidor iniciado en puerto", PORT);

});
