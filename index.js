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
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78'; // <--- REEMPLAZA CON TU TOKEN DE WASENDER
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
    } catch (e) { 
        console.error("❌ Error en la API de WhatsApp:", e.message); 
    }
}

// --- 📋 FUNCIÓN BUSCAR CLIENTE EN SHEETS Y ENVIAR ---
async function buscarYEnviarWA(correoNetflix, cuerpoTexto) {
    try {
        // Verificamos si la variable existe para no crashear
        if (!process.env.GOOGLE_CREDENTIALS) {
            console.log("⚠️ Falta la variable GOOGLE_CREDENTIALS en Railway");
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

        // Detectar perfil en el correo
        let perfilEnCorreo = "";
        const texto = cuerpoTexto.toLowerCase();
        if (texto.includes("perfil 1") || texto.includes(">1<")) perfilEnCorreo = "1";
        else if (texto.includes("perfil 2") || texto.includes(">2<")) perfilEnCorreo = "2";
        else if (texto.includes("perfil 3") || texto.includes(">3<")) perfilEnCorreo = "3";
        else if (texto.includes("perfil 4") || texto.includes(">4<")) perfilEnCorreo = "4";
        else if (texto.includes("perfil 5") || texto.includes(">5<")) perfilEnCorreo = "5";
        else if (texto.includes("cristal")) perfilEnCorreo = "cristal";

        // Buscar coincidencia en la hoja
        const cliente = filas.find(f => {
            const correoMatch = f[4]?.toLowerCase().trim() === correoNetflix.toLowerCase().trim();
            const perfilMatch = f[6]?.toString().toLowerCase().trim() === perfilEnCorreo;
            const esCompleta = f[6]?.toLowerCase().trim() === "completa";
            return correoMatch && (perfilMatch || esCompleta);
        });

        if (cliente) {
            // Extraer solo el código de 4 dígitos
            const matchCodigo = cuerpoTexto.match(/\b\d{4}\b/);
            const anioActual = new Date().getFullYear().toString();
            const codigoValido = (matchCodigo && matchCodigo[0] !== anioActual) ? matchCodigo[0] : null;

            if (codigoValido) {
                const mensaje = `*NETFLIX CÓDIGO* 🍿\n\n` +
                              `Hola *${cliente[1]}*, tu acceso es:\n\n` +
                              `🔑 Código: *${codigoValido}*\n` +
                              `👤 Perfil: ${cliente[6]}\n` +
                              `📍 PIN: ${cliente[7] || 'No requiere'}\n\n` +
                              `_Vence pronto. Úsalo ahora._`;
                
                await enviarWA(cliente[2], mensaje);
            }
        }
    } catch (e) {
        console.error("❌ Error procesando Sheets:", e.message);
    }
}

// --- 📧 RUTA API ---
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

            // TUS FILTROS ORIGINALES
            const esCorreoDeCambio = 
                subject.includes("cambio") || subject.includes("cuenta") || 
                subject.includes("contraseña") || subject.includes("password") ||
                subject.includes("sesión") || contenido.includes("cambiar la información") ||
                contenido.includes("restablecer tu contraseña");

            const esAccesoUtil = 
                subject.includes("código") || subject.includes("codigo") || 
                subject.includes("temporal") || subject.includes("hogar") || 
                subject.includes("viaje");

            if (esAccesoUtil && !esCorreoDeCambio) {
                // Ejecutamos la búsqueda de WhatsApp (sin detener el panel)
                buscarYEnviarWA(msg.envelope.to[0].address, contenido);

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
        res.status(500).json({ error: "Error de servidor" });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Panel y Automatización Activos"); });
