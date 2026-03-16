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
        if (!numero.startsWith("1")) { numero = "1" + numero; }
        const phone = "+" + numero;

        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WA_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ to: phone, text: msj })
        });
        console.log("✅ WA enviado a:", phone);
    } catch (e) { console.log("❌ Error WA:", e.message); }
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
    } catch (e) { return []; }
}

// ================= UTILIDADES =================
function extraerCodigo(cuerpo) {
    const match = cuerpo.match(/\b\d{4,6}\b/g);
    if (!match) return null;
    for (let num of match) {
        if (num !== "2026") return num;
    }
    return null;
}

function extraerPerfil(cuerpo) {
    const match = cuerpo.match(/hola,?\s*(\d+):/i) || cuerpo.match(/perfil\s*(\d+)/i);
    return match ? match[1].trim() : "";
}

// ================= API PANEL =================
app.get("/api/emails", async (req, res) => {
    console.log("📬 Consultando Gmail...");
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS }
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");
        const list = await client.search({ from: "netflix" });
        const clientes = await obtenerClientes();
        let emailsParaPanel = [];

        // Procesar últimos 10
        for (let seq of list.slice(-10).reverse()) {
            const msg = await client.fetchOne(seq, { source: true, envelope: true });
            const parsed = await simpleParser(msg.source);
            
            // 1. Obtener cuerpo y datos básicos
            let cuerpo = (parsed.text || parsed.html || "").toLowerCase();
            const codigo = extraerCodigo(cuerpo);
            const perfil = extraerPerfil(cuerpo);
            
            let correoDestino = "";
            if (parsed.to?.value?.length) correoDestino = parsed.to.value[0].address;
            else if (parsed.headers.get("delivered-to")) correoDestino = parsed.headers.get("delivered-to");
            correoDestino = (correoDestino || "").toLowerCase().trim();

            // 2. Buscar Cliente
            let cliente = clientes.find(f => {
                const correoExcel = (f[4] || "").toLowerCase().trim();
                const perfilExcel = (f[6] || "").toString().toLowerCase().trim();
                return correoExcel === correoDestino && (perfilExcel === perfil || perfilExcel === "completa");
            });

            // 3. Notificar (WhatsApp)
            if (codigo) {
                const mensajeBase = `🍿 *NETFLIX*\n\nTu código es: *${codigo}*\n\nMensaje automático.`;
                if (cliente) {
                    await enviarWA(cliente[2], `Hola *${cliente[1]}*\n\n${mensajeBase}`);
                } else {
                    await enviarWA(ADMIN_PHONE, `⚠️ *ADMIN*\nCuenta: ${correoDestino}\nPerfil: ${perfil || "Desconocido"}\nCod: ${codigo}`);
                }
            }

            // 4. Armar respuesta para el PANEL (Evita el "undefined")
            emailsParaPanel.push({
                subject: msg.envelope.subject || "Correo Netflix",
                date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                to: correoDestino || "No detectado",
                contenido: codigo || "Sin código detectado" // <--- ESTO ARREGLA EL PANEL
            });
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });
    } catch (e) {
        console.log("❌ Error:", e.message);
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor en puerto", PORT); });
