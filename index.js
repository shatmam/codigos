const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// --- 🔑 CONFIGURACIONES ---
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const WA_URL = 'https://www.wasenderapi.com/api/send-message';
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78'; // <-- Pon tu token de WAsender
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';

// --- 📲 FUNCIÓN ENVIAR WHATSAPP ---
async function enviarWA(tel, msj) {
    try {
        const res = await fetch(WA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: WA_TOKEN, to: tel, body: msj })
        });
        const data = await res.json();
        console.log(`✅ Respuesta de WA para ${tel}:`, data);
    } catch (e) { 
        console.error("❌ Error enviando WhatsApp:", e.message); 
    }
}

// --- 📋 PROCESO DE BÚSQUEDA Y ENVÍO ---
async function procesarNotificacionWA(correoNetflix, parsedEmail) {
    try {
        console.log(`--- 📩 Nuevo correo de: ${correoNetflix} ---`);

        if (!process.env.GOOGLE_CREDENTIALS) {
            console.log("❌ ERROR: No existe la variable GOOGLE_CREDENTIALS en Railway");
            return;
        }

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
        if (!filas) return console.log("⚠️ El Sheet está vacío.");

        const cuerpoTexto = (parsedEmail.text || "").toLowerCase();
        const html = parsedEmail.html || "";

        // 1. Detectar Perfil (Busca el número después de "Hola," o "solicitud de")
        let perfilDetectado = "";
        const matchPerfil = cuerpoTexto.match(/hola,?\s*(\d+):/i) || cuerpoTexto.match(/perfil\s*(\d+)/i) || cuerpoTexto.match(/solicitud de\s*(\d+)/i);
        
        if (matchPerfil) {
            perfilDetectado = matchPerfil[1];
        } else if (cuerpoTexto.includes("cristal")) {
            perfilDetectado = "cristal";
        }
        
        console.log(`🔍 Buscando en Sheet: Correo [${correoNetflix}] | Perfil [${perfilDetectado}]`);

        // 2. Buscar Cliente
        const cliente = filas.find(f => {
            const correoSheet = (f[4] || "").toLowerCase().trim();
            const perfilSheet = (f[6] || "").toString().trim(); // Aquí busca el "1", "2", etc.
            
            return correoSheet === correoNetflix.toLowerCase().trim() && 
                   (perfilSheet === perfilDetectado || perfilSheet.toLowerCase() === "completa");
        });

        if (!cliente) {
            return console.log(`⚠️ No se encontró coincidencia para ${correoNetflix} con perfil ${perfilDetectado}`);
        }

        console.log(`👤 Cliente identificado: ${cliente[1]}`);

        // 3. Determinar qué enviar (Código o Hogar)
        let mensajeWA = "";
        
        if (html.includes("update-home") || html.includes("confirm-account")) {
            const matchLink = html.match(/href="([^"]*update-home[^"]*)"/) || html.match(/href="([^"]*confirm-account[^"]*)"/);
            if (matchLink) {
                mensajeWA = `*NETFLIX: ACTUALIZAR HOGAR* 🏠\n\nHola *${cliente[1]}*, activa tu TV presionando el enlace:\n\n🔗 ${matchLink[1]}`;
            }
        } else {
            const matchCodigo = cuerpoTexto.match(/\b\d{4}\b/);
            const anioActual = new Date().getFullYear().toString();
            const codigo = (matchCodigo && matchCodigo[0] !== anioActual) ? matchCodigo[0] : null;

            if (codigo) {
                mensajeWA = `*NETFLIX CÓDIGO* 🍿\n\nHola *${cliente[1]}*, tu código de acceso es:\n\n🔑 Código: *${codigo}*\n👤 Perfil: ${cliente[6]}\n📍 PIN: ${cliente[7] || 'N/A'}`;
            }
        }

        if (mensajeWA) {
            await enviarWA(cliente[2], mensajeWA);
        } else {
            console.log("❓ Correo procesado pero no se halló código de 4 dígitos ni link de hogar.");
        }

    } catch (e) {
        console.error("❌ Error crítico en el proceso:", e.message);
    }
}

// --- 📧 RUTA API ---
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
        res.status(500).json({ error: "Reintentando..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema Multi-Acceso Online"); });
