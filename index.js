const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// --- 🔑 CONFIGURACIONES (RELLENA ESTO) ---
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const WA_URL = 'https://www.wasenderapi.com/api/send-message';
const WA_TOKEN = 'e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78'; // <--- Tu Token de WAsender
const SPREADSHEET_ID = '1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY'; // <--- El ID de tu Google Sheet

// --- 📋 FUNCIÓN PARA BUSCAR CLIENTE EN SHEETS ---
async function buscarCliente(correoNetflix, cuerpo) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json', 
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Hoja1!A2:H500', 
        });

        const filas = res.data.values;
        if (!filas) return null;

        // Detectar perfil en el cuerpo del correo
        let perfilEnCorreo = "";
        const texto = cuerpo.toLowerCase();
        if (texto.includes("perfil 1") || texto.includes(">1<")) perfilEnCorreo = "1";
        else if (texto.includes("perfil 2") || texto.includes(">2<")) perfilEnCorreo = "2";
        else if (texto.includes("perfil 3") || texto.includes(">3<")) perfilEnCorreo = "3";
        else if (texto.includes("perfil 4") || texto.includes(">4<")) perfilEnCorreo = "4";
        else if (texto.includes("perfil 5") || texto.includes(">5<")) perfilEnCorreo = "5";
        // Si tienes perfiles con nombres (ej: Cristal), añádelos aquí:
        else if (texto.includes("cristal")) perfilEnCorreo = "CRISTAL";

        return filas.find(f => {
            const correoMatch = f[4]?.toLowerCase() === correoNetflix.toLowerCase();
            const perfilMatch = f[6]?.toString() === perfilEnCorreo;
            const esCompleta = f[6]?.toLowerCase() === "completa";
            return correoMatch && (perfilMatch || esCompleta);
        });
    } catch (e) { console.error("Error Sheets:", e); return null; }
}

// --- 📲 FUNCIÓN ENVIAR WHATSAPP ---
async function enviarWA(tel, msj) {
    try {
        await axios.post(WA_URL, { token: WA_TOKEN, to: tel, body: msj });
        console.log("WhatsApp enviado a: " + tel);
    } catch (e) { console.error("Error WA API"); }
}

// --- 📧 RUTA PRINCIPAL ---
app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false, tls: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');
        let emailsVisibles = [];
        let list = await client.search({ from: "netflix" });

        for (let seq of list.slice(-8).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            const fechaCorreo = new Date(msg.envelope.date);
            const ahora = new Date();

            if ((ahora - fechaCorreo) / (1000 * 60) <= 15) {
                let parsed = await simpleParser(msg.source);
                let subject = (msg.envelope.subject || "").toLowerCase();
                let contenido = (parsed.text || "").toLowerCase();

                // Filtros de seguridad
                const esBasura = ["inicio", "sesión", "cuenta", "contraseña"].some(p => subject.includes(p));
                const esCodigo = ["temporal", "hogar", "viaje", "código", "codigo"].some(p => subject.includes(p) || contenido.includes(p));

                if (!esBasura && esCodigo) {
                    // Extraer código de 6 dígitos
                    const matchCodigo = contenido.match(/\b\d{6}\b/);
                    const codigo = matchCodigo ? matchCodigo[0] : null;

                    if (codigo) {
                        // Intentar enviar WhatsApp automáticamente
                        const fila = await buscarCliente(msg.envelope.to[0].address, contenido);
                        if (fila) {
                            const msj = `*NETFLIX CODIGO* 🍿\n\nHola *${fila[1]}*, tu acceso es:\n\n🔑 Código: *${codigo}*\n👤 Perfil: ${fila[6]}\n📍 PIN: ${fila[7] || 'N/A'}\n\n_Vence en 15 min._`;
                            await enviarWA(fila[2], msj);
                        }
                    }

                    emailsVisibles.push({
                        subject: msg.envelope.subject,
                        date: fechaCorreo.toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit' }),
                        to: msg.envelope.to[0].address,
                        html: parsed.html
                    });
                }
            }
        }
        await client.logout();
        res.json({ emails: emailsVisibles });
    } catch (error) {
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Panel con WhatsApp Auto Activo"); });
