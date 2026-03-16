const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// --- CONFIG ---
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78';
const ADMIN_PHONE = '18494736782';

// 📲 ENVIADOR (Copiado tal cual de tu lógica funcional)
async function enviarWA(tel, msj) {
  const url = 'https://www.wasenderapi.com/api/send-message';
  try {
    let numero = tel.toString().replace(/[^0-9]/g, '');
    let phone_e164 = '+' + numero;

    console.log(`[WA] Intentando enviar a: ${phone_e164}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 'to': phone_e164, 'text': msj })
    });

    const resData = await response.json();
    console.log(`[WA] Respuesta API: ${JSON.stringify(resData)}`);
  } catch (e) { console.error('[WA] ERROR:', e.message); }
}

// 📋 PROCESADOR MEJORADO
async function procesarYNotificar(correoNetflix, parsedEmail) {
  try {
    if (!process.env.GOOGLE_CREDENTIALS) return console.log("⚠️ Falta GOOGLE_CREDENTIALS");

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja1!A2:K500', // Ampliado el rango por si acaso
    });

    const filas = res.data.values;
    if (!filas) return console.log("⚠️ No hay datos en el Excel");

    const cuerpoTexto = (parsedEmail.text || "").toLowerCase();
    const html = (parsedEmail.html || "");

    // Identificar Perfil
    let perfilEnCorreo = "";
    const matchPerfil = cuerpoTexto.match(/hola,?\s*(\d+):/i) || cuerpoTexto.match(/perfil\s*(\d+)/i);
    if (matchPerfil) perfilEnCorreo = matchPerfil[1].trim();
    else if (cuerpoTexto.includes("cristal")) perfilEnCorreo = "cristal";

    console.log(`[BUSCANDO] Cuenta: ${correoNetflix} | Perfil: ${perfilEnCorreo}`);

    // Búsqueda Flexible
    const cliente = filas.find(f => {
      const correoSheet = (f[4] || "").toLowerCase().trim();
      const perfilSheet = (f[6] || "").toString().toLowerCase().trim();
      
      const coincideCorreo = correoSheet === correoNetflix.toLowerCase().trim();
      const coincidePerfil = (perfilSheet === perfilEnCorreo) || (perfilSheet === "completa");
      
      return coincideCorreo && coincidePerfil;
    });

    // Contenido
    const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || 
                      html.match(/href="([^"]*confirm-account[^"]*)"/) ||
                      html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);
    
    const codMatch = cuerpoTexto.match(/\b\d{4}\b/);
    const codigo = (codMatch && codMatch[0] !== "2026") ? codMatch[0] : null;

    const FRASE = '\n\nEste mensaje se envía automáticamente para más info contacta tu proveedor';

    if (cliente) {
      console.log(`[OK] Cliente encontrado: ${cliente[1]} (${cliente[2]})`);
      let mensaje = "";
      if (linkMatch) mensaje = `*NETFLIX ACCESO* 🔗\n\nHola *${cliente[1]}*, presiona aquí:\n\n${linkMatch[1]}${FRASE}`;
      else if (codigo) mensaje = `*NETFLIX CÓDIGO* 🍿\n\nHola *${cliente[1]}*, tu código: *${codigo}*${FRASE}`;
      
      if (mensaje) await enviarWA(cliente[2], mensaje);
    } else if (perfilEnCorreo === "" && (linkMatch || codigo)) {
      console.log(`[ADMIN] Sin perfil detectado, enviando a Admin...`);
      let contenido = linkMatch ? linkMatch[1] : codigo;
      await enviarWA(ADMIN_PHONE, `*AVISO ADMIN* ⚠️\n\nCuenta: ${correoNetflix}\nContenido: ${contenido}`);
    } else {
      console.log(`[SALTADO] No hubo coincidencia para: ${correoNetflix}`);
    }
  } catch (e) { console.error("[ERROR PROCESADOR]:", e.message); }
}

app.get("/api/emails", async (req, res) => {
  console.log("--- 🚀 NUEVA BÚSQUEDA SOLICITADA ---");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false, tls: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    let emails = [];
    let list = await client.search({ from: "netflix" });

    // Procesamos últimos 5
    for (let seq of list.slice(-5).reverse()) {
      let msg = await client.fetchOne(seq, { source: true, envelope: true });
      let parsed = await simpleParser(msg.source);
      let subject = (msg.envelope.subject || "").toLowerCase();

      // Filtro de utilidad
      const esUtil = subject.includes("código") || subject.includes("codigo") || 
                     subject.includes("temporal") || subject.includes("hogar") || 
                     subject.includes("viaje") || subject.includes("sesion") || 
                           subject.includes("sesión") || subject.includes("inicio");

      if (esUtil) {
        await procesarYNotificar(msg.envelope.to[0].address, parsed);
        emails.push({
          subject: msg.envelope.subject,
          date: new Date(msg.envelope.date).toLocaleString('es-DO'),
          to: msg.envelope.to[0].address,
          html: parsed.html
        });
      }
    }
    await client.logout();
    res.json({ emails });
  } catch (error) {
    if (client) await client.logout().catch(() => {});
    console.error("[IMAP ERROR]:", error.message);
    res.status(500).json({ error: "Error" });
  }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Servidor Listo"); });
