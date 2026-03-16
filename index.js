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
  try {
    let numero = tel.toString().replace(/[^0-9]/g, "");
    if (!numero.startsWith("1")) numero = "1" + numero;
    const phone = "+" + numero;

    await fetch("https://www.wasenderapi.com/api/send-message", {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, text: msj })
    });
    console.log("✅ WA Enviado a:", phone);
  } catch (e) { console.log("❌ Error WA:", e.message); }
}

// ================= API PANEL =================
app.get("/api/emails", async (req, res) => {
  console.log("📬 Iniciando consulta de correos...");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    
    // Obtener Clientes (si falla Sheets, el panel sigue funcionando)
    let clientes = [];
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
      });
      const sheets = google.sheets({ version: "v4", auth });
      const spreadsheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Hoja1!A2:K500" });
      clientes = spreadsheet.data.values || [];
    } catch (err) { console.log("⚠️ Error Sheets:", err.message); }

    const list = await client.search({ from: "netflix" });
    let emailsParaPanel = [];

    // Procesar los últimos 10 correos
    for (let seq of list.slice(-10).reverse()) {
      try {
        const msg = await client.fetchOne(seq, { source: true, envelope: true });
        const parsed = await simpleParser(msg.source);
        
        let cuerpo = (parsed.text || parsed.html || "").toLowerCase();
        let htmlParaPanel = parsed.html || parsed.text || "Sin contenido";
        
        // 1. Detectar Código
        const codMatch = cuerpo.match(/\b\d{4,6}\b/);
        const codigo = (codMatch && codMatch[0] !== "2026") ? codMatch[0] : null;

        // 2. Detectar Perfil (Busca 1, 2, 3, 4, 5 o nombres como "cristal")
        let perfilDetectado = "";
        const pMatch = cuerpo.match(/hola,?\s*(\d+):/i) || cuerpo.match(/perfil\s*(\d+)/i) || cuerpo.match(/perfil:\s*(\d+)/i);
        if (pMatch) perfilDetectado = pMatch[1].trim();
        else if (cuerpo.includes("cristal")) perfilDetectado = "cristal";

        // 3. Correo de destino
        let correoDestino = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

        // 4. Match con Excel (Correo + Perfil)
        let cliente = clientes.find(f => {
          const correoExcel = (f[4] || "").toLowerCase().trim();
          const perfilExcel = (f[6] || "").toString().toLowerCase().trim();
          // Coincide si el correo es igual Y (el perfil es igual O la cuenta es "completa")
          return correoExcel === correoDestino && (perfilExcel === perfilDetectado || perfilExcel === "completa");
        });

        // 5. Enviar Notificación si hay código
        if (codigo) {
          const FRASE = "\n\nMensaje automático.";
          if (cliente) {
            await enviarWA(cliente[2], `🍿 *NETFLIX*\n\nHola *${cliente[1]}*, tu código es: *${codigo}*${FRASE}`);
          } else {
            // Si no hay cliente, enviar aviso al Admin para que sepas qué perfil llegó
            await enviarWA(ADMIN_PHONE, `⚠️ *AVISO ADMIN*\nCuenta: ${correoDestino}\nPerfil: ${perfilDetectado || "No detectado"}\nCódigo: ${codigo}`);
          }
        }

        // 6. Agregar al Panel (Asegura que 'html' tenga datos para que no salga undefined)
        emailsParaPanel.push({
          subject: msg.envelope.subject || "Correo Netflix",
          date: new Date(msg.envelope.date).toLocaleString("es-DO"),
          to: correoDestino,
          html: codigo ? `<b style="color: #ff4d4d;">CÓDIGO: ${codigo}</b><br>Perfil: ${perfilDetectado || "Desconocido"}` : "Acceso detectado (Revisar link)"
        });

      } catch (err) { console.log(`❌ Error procesando correo seq ${seq}:`, err.message); }
    }

    await client.logout();
    res.json({ emails: emailsParaPanel });

  } catch (e) {
    console.log("❌ Error Crítico IMAP:", e.message);
    try { await client.logout(); } catch {}
    res.status(500).json({ error: "Error de conexión con Gmail" });
  }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor Reparado y listo"); });
