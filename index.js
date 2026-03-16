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
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';

// --- 📲 FUNCIÓN ENVIAR WHATSAPP (Ajustada a tu CURL) ---
async function enviarWA(tel, msj) {
    const MI_TOKEN_REAL = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";
    const URL_API = "https://wasenderapi.com/api/send-message";

    try {
        // Formatear teléfono: Asegurar que tenga el "+" al inicio
        let numeroDestino = tel.trim();
        if (!numeroDestino.startsWith('+')) {
            numeroDestino = `+${numeroDestino}`;
        }

        console.log(`🚀 Intentando enviar WhatsApp a ${numeroDestino}...`);

        const response = await fetch(URL_API, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${MI_TOKEN_REAL}`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                "to": numeroDestino, 
                "text": msj 
            })
        });

        const data = await response.json();
        console.log(`✅ Resultado API WAsender para ${numeroDestino}:`, data);
    } catch (e) { 
        console.error("❌ Error fatal en conexión WA:", e.message); 
    }
}

// --- 📋 BÚSQUEDA EN SHEETS Y PROCESAMIENTO ---
async function procesarNotificacionWA(correoNetflix, parsedEmail) {
    try {
        if (!process.env.GOOGLE_CREDENTIALS) {
            console.log("❌ Error: Variable GOOGLE_CREDENTIALS no configurada en Railway.");
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
        if (!filas) return;

        const cuerpoTexto = (parsedEmail.text || "").toLowerCase();
        const html = parsedEmail.html || "";

        // Detectar Perfil (Busca el número después de "Hola," o "solicitud de")
        let perfilDetectado = "";
        const matchPerfil = cuerpoTexto.match(/hola,?\s*(\d+):/i) || cuerpoTexto.match(/perfil\s*(\d+)/i) || cuerpoTexto.match(/solicitud de\s*(\d+)/i);
        if (matchPerfil) perfilDetectado = matchPerfil[1];
        else if (cuerpoTexto.includes("cristal")) perfilDetectado = "cristal";

        // Buscar Cliente en el Sheet (Columna E=Correo, G=Perfil)
        const cliente = filas.find(f => {
            const correoSheet = (f[4] || "").toLowerCase().trim();
            const perfilSheet = (f[6] || "").toString().trim();
            return correoSheet === correoNetflix.toLowerCase().trim() && 
                   (perfilSheet === perfilDetectado || perfilSheet.toLowerCase() === "completa");
        });

        if (cliente) {
            let mensajeFinal = "";
            
            // Caso Hogar (Enlace)
            if (html.includes("update-home") || html.includes("confirm-account")) {
                const matchLink = html.match(/href="([^"]*update-home[^"]*)"/) || html.match(/href="([^"]*confirm-account[^"]*)"/);
                if (matchLink) {
                    mensajeFinal = `*NETFLIX: ACTUALIZAR HOGAR* 🏠\n\nHola *${cliente[1]}*, activa tu TV aquí:\n\n🔗 ${matchLink[1]}`;
                }
            } 
            // Caso Código (4 dígitos)
            else {
                const matchCodigo = cuerpoTexto.match(/\b\d{4}\b/);
                const anioActual = new Date().getFullYear().toString();
                const codigo = (matchCodigo && matchCodigo[0] !== anioActual) ? matchCodigo[0] : null;
                
                if (codigo) {
                    mensajeFinal = `*NETFLIX CÓDIGO* 🍿\n\nHola *${cliente[1]}*, tu código es: *${codigo}*\n👤 Perfil: ${cliente[6]}`;
                }
            }

            if (mensajeFinal) {
                await enviarWA(cliente[2], mensajeFinal);
            }
        } else {
            console.log(`⚠️ Correo de ${correoNetflix} no coincide con ningún cliente activo en el Sheet.`);
        }
    } catch (e) { console.error("❌ Error en Sheets:", e.message); }
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

        // Analiza los últimos 10 de Netflix (incluyendo los que ya estaban)
        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let parsed = await simpleParser(msg.source);
            let subject = (msg.envelope.subject || "").toLowerCase();

            const esUtil = subject.includes("código") || subject.includes("codigo") || subject.includes("temporal") || subject.includes("hogar") || subject.includes("viaje");

            if (esUtil) {
                // Ejecutamos la automatización
                await procesarNotificacionWA(msg.envelope.to[0].address, parsed);

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

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema con API WAsender Verificada"); });
