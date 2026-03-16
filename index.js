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
    
    // Asegurar formato correcto para RD (1809... / 1829... / 1849...)
    if (numero.length === 10 && (numero.startsWith("809") || numero.startsWith("829") || numero.startsWith("849"))) {
      numero = "1" + numero;
    } else if (!numero.startsWith("1") && numero.length === 10) {
        numero = "1" + numero;
    }

    let phone = "+" + numero;
    console.log("📲 Intentando enviar a:", phone);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ to: phone, text: msj })
    });

    const data = await response.text();
    console.log("📩 Respuesta API WA:", data);
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
    const sheets = google.sheets({ version: "v4", auth });
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

    // 1. DETECTAR PERFIL
    let perfilCorreo = "";
    const matchPerfil = texto.match(/hola,?\s*(\d+):/i) || texto.match(/perfil\s*(\d+)/i) || texto.match(/>(\d+)</);
    if (matchPerfil) perfilCorreo = matchPerfil[1].trim();
    else if (texto.includes("cristal")) perfilCorreo = "cristal";

    console.log(`🔎 Analizando Correo: ${correoNetflix} | Perfil Detectado: [${perfilCorreo}]`);

    // 2. BUSCAR CLIENTE (Lógica mejorada)
    const cliente = clientes.find(f => {
      const correoExcel = (f[4] || "").toLowerCase().trim();
      const perfilExcel = (f[6] || "").toString().toLowerCase().trim();
      
      const mismoCorreo = correoExcel === correoNetflix.toLowerCase().trim();
      // Coincide si es el mismo perfil O si el Excel dice "completa"
      const mismoPerfil = (perfilExcel === perfilCorreo) || (perfilExcel === "completa");
      
      return mismoCorreo && mismoPerfil;
    });

    // 3. DETECTAR CONTENIDO
    const codMatch = texto.match(/\b\d{4}\b/);
    let codigo = (codMatch && codMatch[0] !== "2026") ? codMatch[0] : null;

    const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || 
                      html.match(/href="([^"]*confirm-account[^"]*)"/) || 
                      html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);

    const FRASE = "\n\nEste mensaje es automático. Contacta tu proveedor.";

    if (cliente) {
      // ✅ ENCONTRADO: Enviar al cliente
      console.log(`✅ Cliente encontrado: ${cliente[1]}. Enviando...`);
      let mensaje = "";
      if (codigo) mensaje = `🍿 *NETFLIX CODIGO*\n\nHola *${cliente[1]}*\n\nTu código es: *${codigo}*${FRASE}`;
      else if (linkMatch) mensaje = `🔗 *NETFLIX ACCESO*\n\nHola *${cliente[1]}*\n\nAccede aquí:\n${linkMatch[1]}${FRASE}`;
      
      if (mensaje) await enviarWA(cliente[2], mensaje);

    } else {
      // ⚠️ NO ENCONTRADO O SIN PERFIL: Enviar al Admin
      console.log("⚠️ Cliente no coincidente en Excel. Enviando al Admin.");
      if (codigo || linkMatch) {
        const contenido = codigo || linkMatch[1];
        await enviarWA(ADMIN_PHONE, `⚠️ *AVISO ADMIN (SIN PERFIL)*\n\nCuenta: ${correoNetflix}\nContenido: ${contenido}`);
      }
    }
  } catch (error) {
    console.log("❌ Error procesando correo:", error.message);
  }
}

// ================= API CORREOS =================
app.get("/api/emails", async (req, res) => {
  console.log("📬 Consultando Gmail...");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const list = await client.search({ from: "netflix" });
    let emails = [];

    // Procesar últimos 5 correos
    for (let seq of list.slice(-5).reverse()) {
      const msg = await client.fetchOne(seq, { source: true, envelope: true });
      const parsed = await simpleParser(msg.source);
      const correoDestino = msg.envelope.to[0].address;

      await procesarYNotificar(correoDestino, parsed);

      emails.push({
        subject: msg.envelope.subject,
        date: new Date(msg.envelope.date).toLocaleString("es-DO"),
        to: correoDestino
      });
    }
    await client.logout();
    res.json({ emails });
  } catch (error) {
    console.log("❌ Error IMAP:", error.message);
    res.status(500).json({ error: "Error leyendo correos" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Servidor en puerto", PORT);
});
