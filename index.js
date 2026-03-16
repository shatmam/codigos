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
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';

// --- 📲 FUNCIÓN ENVIAR WHATSAPP (Copiada de tu lógica exitosa) ---
async function enviarWA(tel, msj) {
    const URL = 'https://www.wasenderapi.com/api/send-message';
    const TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78';

    try {
        // Limpiamos el teléfono igual que en tu script
        var telefono = tel.toString().replace(/[^0-9]/g, '');
        
        // Formato E.164 con + (igual que tu phone_e164)
        var phone_e164 = '+' + telefono;

        console.log('← ENVIANDO a ' + phone_e164);

        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'to': phone_e164,
                'text': msj
            })
        });

        const data = await response.json();
        console.log('✅ Respuesta API:', JSON.stringify(data));
    } catch (e) {
        console.error('❌ Error enviando WA:', e.message);
    }
}

// --- 📋 PROCESADOR DE NOTIFICACIONES ---
async function procesarNotificacionWA(correoNetflix, parsedEmail) {
    try {
        if (!process.env.GOOGLE_CREDENTIALS) return console.log("❌ Falta variable GOOGLE_CREDENTIALS");

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
        const html = (parsedEmail.html || "");

        // Detectar perfil (Lógica mejorada)
        let perfilEmail = "";
        const match = cuerpoTexto.match(/hola,?\s*(\d+):/i) || cuerpoTexto.match(/perfil\s*(\d+)/i) || cuerpoTexto.match(/solicitud de\s*(\d+)/i);
        if (match) perfilEmail = match[1].trim();
        else if (cuerpoTexto.includes("cristal")) perfilEmail = "cristal";

        console.log(`🔍 Buscando Match: Correo [${correoNetflix}] | Perfil [${perfilEmail}]`);

        // Buscador de cliente (Fila I=1, J=2... E=4, G=6)
        const cliente = filas.find(f => {
            const correoSheet = (f[4] || "").toLowerCase().trim();
            const perfilSheet = (f[6] || "").toString().toLowerCase().trim();
            return correoSheet === correoNetflix.toLowerCase().trim() && 
                   (perfilSheet === perfilEmail || perfilSheet === "completa");
        });

        if (cliente) {
            console.log(`✅ Cliente Encontrado: ${cliente[1]}`);
            const FRASE = '\n\nEste mensaje se envía automáticamente, para más info contacta a tu proveedor.';
            let mensaje = "";

            // Caso A: Hogar
            if (html.includes("update-home") || html.includes("confirm-account")) {
                const link = html.match(/href="([^"]*update-home[^"]*)"/) || html.match(/href="([^"]*confirm-account[^"]*)"/);
                if (link) {
                    mensaje = 'Hola *' + cliente[1] + '*, para activar tu TV de Netflix presiona el siguiente botón:\n\n🔗 ' + link[1] + FRASE;
                }
            } 
            // Caso B: Código
            else {
                const cod = cuerpoTexto.match(/\b\d{4}\b/);
                const anio = new Date().getFullYear().toString();
                const codigoValido = (cod && cod[0] !== anio) ? cod[0] : null;
                if (codigoValido) {
                    mensaje = 'Hola *' + cliente[1] + '*, tu código de acceso Netflix es: *' + codigoValido + '*' + FRASE;
                }
            }

            if (mensaje !== "") {
                await enviarWA(cliente[2], mensaje);
            }
        } else {
            console.log("⚠️ No se encontró cliente para este correo/perfil.");
        }
    } catch (e) {
        console.error("❌ Error en ProcesarWA:", e.message);
    }
}

app.get("/api/emails", async (req, res) => {
    console.log("🔔 Petición de códigos recibida...");
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

            if (subject.includes("código") || subject.includes("codigo") || subject.includes("hogar") || subject.includes("temporal")) {
                // Disparar envío
                await procesarNotificacionWA(msg.envelope.to[0].address, parsed);
                
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
    } catch (e) {
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema sincronizado con lógica de recordatorios"); });
