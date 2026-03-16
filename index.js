const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const WA_URL = 'https://www.wasenderapi.com/api/send-message';
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78'; 
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';

// --- FUNCIÓN WHATSAPP ---
async function enviarWA(tel, msj) {
    try {
        await fetch(WA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: WA_TOKEN, to: tel, body: msj })
        });
        console.log("✅ WhatsApp enviado a: " + tel);
    } catch (e) { console.error("❌ Error WA API"); }
}

// --- FUNCIÓN PRINCIPAL DE AUTOMATIZACIÓN ---
async function procesarNotificacionWA(correoNetflix, parsedEmail) {
    try {
        if (!process.env.GOOGLE_CREDENTIALS) return;

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Hoja1!A2:H500', 
        });

        const filas = res.data.values;
        if (!filas) return;

        const cuerpoTexto = (parsedEmail.text || "").toLowerCase();
        const html = parsedEmail.html || "";

        // 1. Detectar Perfil (mejorado)
        let perfilEnCorreo = "";
        const matchPerfil = cuerpoTexto.match(/hola,?\s*(\d+):/i) || cuerpoTexto.match(/solicitud de\s*(\d+)/i);
        if (matchPerfil) perfilEnCorreo = matchPerfil[1];
        else if (cuerpoTexto.includes("cristal")) perfilEnCorreo = "cristal";

        // 2. Buscar Cliente en Sheets
        const cliente = filas.find(f => {
            const correoMatch = f[4]?.toLowerCase().trim() === correoNetflix.toLowerCase().trim();
            const perfilMatch = f[6]?.toString().trim() === perfilEnCorreo;
            const esCompleta = f[6]?.toLowerCase().trim() === "completa";
            return correoMatch && (perfilMatch || esCompleta);
        });

        if (cliente) {
            let mensajeWA = "";
            
            // CASO A: Es una actualización de HOGAR (Botón)
            if (html.includes("update-home") || html.includes("confirm-account")) {
                const matchLink = html.match(/href="([^"]*update-home[^"]*)"/) || html.match(/href="([^"]*confirm-account[^"]*)"/);
                if (matchLink) {
                    mensajeWA = `*NETFLIX: ACTUALIZAR HOGAR* 🏠\n\n` +
                                `Hola *${cliente[1]}*, para activar tu TV presiona el siguiente botón:\n\n` +
                                `🔗 ${matchLink[1]}\n\n` +
                                `_Este enlace vence en 15 minutos._`;
                }
            } 
            
            // CASO B: Es un CÓDIGO de 4 dígitos
            else {
                const matchCodigo = cuerpoTexto.match(/\b\d{4}\b/);
                const anioActual = new Date().getFullYear().toString();
                const codigo = (matchCodigo && matchCodigo[0] !== anioActual) ? matchCodigo[0] : null;
                
                if (codigo) {
                    mensajeWA = `*NETFLIX: CÓDIGO DE ACCESO* 🍿\n\n` +
                                `Hola *${cliente[1]}*, tu código es:\n\n` +
                                `🔑 Código: *${codigo}*\n` +
                                `👤 Perfil: ${cliente[6]}\n` +
                                `📍 PIN: ${cliente[7] || 'N/A'}\n\n` +
                                `_Vence en 15 min._`;
                }
            }

            if (mensajeWA) {
                await enviarWA(cliente[2], mensajeWA);
            }
        }
    } catch (e) { console.error("❌ Error en Proceso WA:", e.message); }
}

app.get("/api/emails", async (req, res) => {
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

        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let parsed = await simpleParser(msg.source);
            let subject = (msg.envelope.subject || "").toLowerCase();
            let contenido = (parsed.text || "").toLowerCase();

            const esCorreoDeCambio = subject.includes("cambio") || subject.includes("cuenta") || subject.includes("contraseña") || subject.includes("password") || subject.includes("sesión");
            const esUtil = subject.includes("código") || subject.includes("codigo") || subject.includes("temporal") || subject.includes("hogar") || subject.includes("viaje");

            if (esUtil && !esCorreoDeCambio) {
                // Llamamos a la nueva función mejorada
                procesarNotificacionWA(msg.envelope.to[0].address, parsed);

                const fechaRD = new Date(msg.envelope.date).toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', hour12: true
                });

                emails.push({
                    subject: msg.envelope.subject,
                    date: fechaRD,
                    to: msg.envelope.to[0].address, 
                    html: parsed.html || `<pre>${parsed.text}</pre>`
                });
            }
        }
        await client.logout();
        res.json({ emails });
    } catch (error) {
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema de Códigos y Hogar Activo"); });
