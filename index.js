const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ================= CONFIGURACIÓN =================
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY"; 
const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78"; 
const ADMIN_PHONE = "18494736782"; 

async function enviarWA(tel, msj) {
    try {
        let numero = tel.toString().replace(/[^0-9]/g, "");
        if (!numero.startsWith("1")) numero = "1" + numero;
        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
    } catch (e) { console.log("❌ Error WA:", e.message); }
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

        // --- LECTURA DE EXCEL ---
        let todosLosClientes = [];
        const credsRaw = process.env.GOOGLE_CREDENTIALS;

        if (!credsRaw) {
            await enviarWA(ADMIN_PHONE, "❌ ERROR: Railway no tiene la variable GOOGLE_CREDENTIALS configurada.");
            return res.status(500).send("Faltan variables de entorno");
        }

        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(credsRaw), // Aquí es donde fallaba antes
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const spreadsheet = await sheets.spreadsheets.values.get({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: "Clientes!A2:K1000" 
            });
            todosLosClientes = spreadsheet.data.values || [];
        } catch (e) { 
            await enviarWA(ADMIN_PHONE, `❌ ERROR GOOGLE: ${e.message}`);
        }
        
        let emailsParaMostrar = [];
        let list = await client.search({ from: "netflix" });

        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let subject = (msg.envelope.subject || "").toLowerCase();
            let parsed = await simpleParser(msg.source);
            let contenido = (parsed.text || "").toLowerCase();
            let htmlOriginal = parsed.html || parsed.textAsHtml || "";

            const esCorreoDeCambio = subject.includes("cambio") || subject.includes("contraseña") || subject.includes("password");
            const esAccesoUtil = subject.includes("código") || subject.includes("codigo") || subject.includes("temporal") || subject.includes("hogar") || subject.includes("viaje");

            if (esAccesoUtil && !esCorreoDeCambio) {
                const correoDestino = (msg.envelope.to[0].address || "").toLowerCase().trim();
                
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/) ||
                                  htmlOriginal.match(/href="([^"]*netflix.com\/browse[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                if (elLink) {
                    // Buscar coincidencia en la hoja Clientes
                    let clientesMatch = todosLosClientes.filter(f => (f[4] || "").toLowerCase().trim() === correoDestino);
                    
                    if (clientesMatch.length > 0) {
                        for (let c of clientesMatch) {
                            const msj = `🏠 *ACTUALIZACIÓN NETFLIX*\n\nHola *${c[1]}*, pulsa el botón para activar tu TV:\n\n${elLink}`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        // Respaldo al Admin
                        const msjAdmin = `⚠️ *CUENTA NO ENCONTRADA*\n\nCorreo: ${correoDestino}\nFilas leídas: ${todosLosClientes.length}\n\nLink: ${elLink}`;
                        await enviarWA(ADMIN_PHONE, msjAdmin);
                    }
                }

                const fechaRD = new Date(msg.envelope.date).toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', hour12: true
                });

                emailsParaMostrar.push({ subject: msg.envelope.subject, date: fechaRD, to: correoDestino, html: htmlOriginal });
            }
        }
        await client.logout();
        res.json({ emails: emailsParaMostrar });
    } catch (error) {
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Sistema en línea"); });
