const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// --- CONFIGURACIÓN ---
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78';

// --- 📲 FUNCIÓN ENVIAR WHATSAPP ---
async function enviarWA(tel, msj) {
    const url = 'https://www.wasenderapi.com/api/send-message';
    try {
        var telefono = tel.toString().replace(/[^0-9]/g, '');
        var phone_e164 = '+' + telefono;

        console.log('← ENVIANDO WHATSAPP A: ' + phone_e164);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + WA_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'to': phone_e164,
                'text': msj
            })
        });
        const resData = await response.json();
        console.log('✅ Respuesta API:', JSON.stringify(resData));
    } catch (e) { console.error('❌ Error WA:', e.message); }
}

// --- 📋 BUSCADOR Y PROCESADOR ---
async function procesarTodoWA(correoNetflix, cuerpoParsed) {
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

        const cuerpoTexto = (cuerpoParsed.text || "").toLowerCase();
        const html = (cuerpoParsed.html || "");

        // Detectar Perfil
        let perfilEnCorreo = "";
        if (cuerpoTexto.includes("perfil 1") || cuerpoTexto.includes(">1<")) perfilEnCorreo = "1";
        else if (cuerpoTexto.includes("perfil 2") || cuerpoTexto.includes(">2<")) perfilEnCorreo = "2";
        else if (cuerpoTexto.includes("perfil 3") || cuerpoTexto.includes(">3<")) perfilEnCorreo = "3";
        else if (cuerpoTexto.includes("perfil 4") || cuerpoTexto.includes(">4<")) perfilEnCorreo = "4";
        else if (cuerpoTexto.includes("perfil 5") || cuerpoTexto.includes(">5<")) perfilEnCorreo = "5";
        else if (cuerpoTexto.includes("cristal")) perfilEnCorreo = "cristal";

        const cliente = filas.find(f => {
            const correoMatch = f[4]?.toLowerCase().trim() === correoNetflix.toLowerCase().trim();
            const perfilMatch = f[6]?.toString().trim() === perfilEnCorreo;
            const esCompleta = f[6]?.toLowerCase().trim() === "completa";
            return correoMatch && (perfilMatch || esCompleta);
        });

        if (cliente) {
            let mensaje = "";
            const FRASE = '\n\nEste mensaje se envía automáticamente para más info contacta tu proveedor';

            // 1. Detectar Enlace (Hogar o Inicio de sesión rápido)
            if (html.includes("update-home") || html.includes("confirm-account") || html.includes("netflix.com/browse")) {
                const link = html.match(/href="([^"]*update-home[^"]*)"/) || 
                             html.match(/href="([^"]*confirm-account[^"]*)"/) ||
                             html.match(/href="([^"]*netflix.com\/browse[^"]*)"/);
                
                if (link) {
                    mensaje = 'Hola *' + cliente[1] + '*, detectamos un acceso en tu cuenta. Presiona aquí para entrar o activar:\n\n🔗 ' + link[1] + FRASE;
                }
            } 
            // 2. Detectar Código
            else {
                const matchCodigo = cuerpoTexto.match(/\b\d{4}\b/);
                const anioActual = new Date().getFullYear().toString();
                const codigo = (matchCodigo && matchCodigo[0] !== anioActual) ? matchCodigo[0] : null;

                if (codigo) {
                    mensaje = 'Hola *' + cliente[1] + '*, tu código Netflix es: *' + codigo + '*' + FRASE;
                }
            }

            if (mensaje) await enviarWA(cliente[2], mensaje);
        }
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
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

            // --- FILTRO AHORA INCLUYE INICIO DE SESIÓN ---
            const esUtil = 
                subject.includes("código") || subject.includes("codigo") || 
                subject.includes("temporal") || subject.includes("hogar") || 
                subject.includes("viaje") || subject.includes("sesión") || 
                subject.includes("sesion") || subject.includes("inicio");

            // Solo bloqueamos correos de cambio de contraseña o seguridad crítica
            const esBloqueado = subject.includes("contraseña") || subject.includes("password") || subject.includes("cambio");

            if (esUtil && !esBloqueado) {
                await procesarTodoWA(msg.envelope.to[0].address, parsed);

                const fechaRD = new Date(msg.envelope.date).toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', hour12: true
                });

                emails.push({
                    subject: msg.envelope.subject,
                    date: fechaRD,
                    to: msg.envelope.to[0].address, 
                    html: parsed.html
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

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema incluyendo Inicios de Sesión"); });
