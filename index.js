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
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78'; // <-- Pon tu token aquí
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY';

// --- 📲 FUNCIÓN ENVIAR WHATSAPP ---
async function enviarWA(tel, msj) {
    try {
        await fetch(WA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: WA_TOKEN, to: tel, body: msj })
        });
        console.log(`✅ WhatsApp enviado a: ${tel}`);
    } catch (e) { console.error("❌ Error WA:", e.message); }
}

// --- 📋 FUNCIÓN BUSCAR CLIENTE ---
async function buscarCliente(correoNetflix, cuerpo) {
    try {
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
        if (!filas) return null;

        let perfilEnCorreo = "";
        const texto = cuerpo.toLowerCase();
        
        // Detección de perfiles (1-5 y nombres especiales)
        if (texto.includes("perfil 1") || texto.includes(">1<")) perfilEnCorreo = "1";
        else if (texto.includes("perfil 2") || texto.includes(">2<")) perfilEnCorreo = "2";
        else if (texto.includes("perfil 3") || texto.includes(">3<")) perfilEnCorreo = "3";
        else if (texto.includes("perfil 4") || texto.includes(">4<")) perfilEnCorreo = "4";
        else if (texto.includes("perfil 5") || texto.includes(">5<")) perfilEnCorreo = "5";
        else if (texto.includes("cristal")) perfilEnCorreo = "CRISTAL";

        return filas.find(f => {
            const correoIgual = f[4]?.toLowerCase().trim() === correoNetflix.toLowerCase().trim();
            const perfilIgual = f[6]?.toString().trim() === perfilEnCorreo;
            const esCompleta = f[6]?.toLowerCase().trim() === "completa";
            return correoIgual && (perfilIgual || esCompleta);
        });
    } catch (e) { return null; }
}

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false,
        tls: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');
        
        let emails = [];
        let list = await client.search({ from: "netflix" });

        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            let subject = (msg.envelope.subject || "").toLowerCase();
            let parsed = await simpleParser(msg.source);
            let contenido = (parsed.text || "").toLowerCase();

            // 🚫 TUS FILTROS ORIGINALES (No los toqué)
            const esCorreoDeCambio = 
                subject.includes("cambio") || 
                subject.includes("cuenta") || 
                subject.includes("contraseña") || 
                subject.includes("password") ||
                subject.includes("sesión") ||
                contenido.includes("cambiar la información") ||
                contenido.includes("restablecer tu contraseña");

            const esAccesoUtil = 
                subject.includes("código") || 
                subject.includes("codigo") || 
                subject.includes("temporal") || 
                subject.includes("hogar") || 
                subject.includes("viaje");

            if (esAccesoUtil && !esCorreoDeCambio) {
                
                // --- 🤖 NUEVA AUTOMATIZACIÓN ---
                const matchCodigo = contenido.match(/\b\d{4}\b/); // Código de 4 dígitos
                const anioActual = new Date().getFullYear().toString();
                const codigoLimpio = (matchCodigo && matchCodigo[0] !== anioActual) ? matchCodigo[0] : null;

                if (codigoLimpio) {
                    const cliente = await buscarCliente(msg.envelope.to[0].address, contenido);
                    if (cliente) {
                        const mensaje = `*NETFLIX CÓDIGO* 🍿\n\nHola *${cliente[1]}*, tu acceso es:\n\n🔑 Código: *${codigoLimpio}*\n👤 Perfil: ${cliente[6]}\n📍 PIN: ${cliente[7] || 'N/A'}\n\n_Vence en 15 min._`;
                        await enviarWA(cliente[2], mensaje);
                    }
                }
                // --- FIN AUTOMATIZACIÓN ---

                const fechaRD = new Date(msg.envelope.date).toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo',
                    hour: '2-digit', minute: '2-digit', hour12: true
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

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Panel Blindado con WhatsApp Auto"); });
