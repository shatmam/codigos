const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ================= CONFIG =================
const EMAIL_USER = "digitalesservicios311@gmail.com";
const EMAIL_PASS = "rfbmuirunbfwcara";
const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY";
const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";

// ================= WHATSAPP =================
async function enviarWA(tel, msj) {
    try {

        let numero = tel.toString().replace(/[^0-9]/g, "");

        if (!numero.startsWith("1")) {
            numero = "1" + numero;
        }

        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WA_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                to: "+" + numero,
                text: msj
            })
        });

        console.log("WA enviado a:", numero);

    } catch (e) {
        console.log("Error WA:", e.message);
    }
}

// ================= API =================
app.get("/api/emails", async (req, res) => {

    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });

    try {

        await client.connect();
        await client.mailboxOpen("INBOX");

        // ================= GOOGLE SHEETS =================
        let todosLosClientes = [];

        try {

            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });

            const sheets = google.sheets({
                version: "v4",
                auth
            });

            const spreadsheet = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: "Hoja1!A2:K500"
            });

            todosLosClientes = spreadsheet.data.values || [];

        } catch (e) {
            console.log("Error Sheets:", e.message);
        }

        // ================= BUSCAR CORREOS NETFLIX =================
        const list = await client.search({ from: "netflix" });

        let emailsParaPanel = [];

        for (let seq of list.slice(-10).reverse()) {

            try {

                const msg = await client.fetchOne(seq, {
                    source: true,
                    envelope: true
                });

                const parsed = await simpleParser(msg.source);

                const htmlOriginal = parsed.html || parsed.textAsHtml || "";
                const texto = (parsed.text || "").toLowerCase();

                // ================= EXTRAER LINK =================
                const linkMatch =
                    htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) ||
                    htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/) ||
                    htmlOriginal.match(/href="([^"]*netflix.com\/browse[^"]*)"/);

                const elLink = linkMatch ? linkMatch[1] : null;

                let correoDestino =
                    parsed.to?.value?.[0]?.address ||
                    parsed.headers.get("delivered-to") ||
                    "";

                correoDestino = correoDestino.toLowerCase().trim();

                // ================= BUSCAR CLIENTES =================
                let clientesAMensajear = todosLosClientes.filter(f => {

                    const correoExcel = (f[4] || "").toLowerCase().trim();
                    const telefono = (f[2] || "").toString().trim();

                    return correoExcel === correoDestino && telefono !== "";

                });

                // ================= ENVIAR WHATSAPP =================
                if (elLink) {

                    for (let c of clientesAMensajear) {

                        const msj = `🏠 *ACTUALIZACIÓN NETFLIX*

Hola *${c[1]}*, pulsa el enlace para activar tu TV:

${elLink}

⚠️ Si no solicitaste esto ignora este mensaje.`;

                        await enviarWA(c[2], msj);

                    }

                }

                // ================= PANEL =================
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Correo Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoDestino,
                    html: `
<div style="background:white;color:black;padding:10px;border:1px solid #ddd;">
${htmlOriginal}
</div>`
                });

            } catch (err) {
                console.log("Error procesando correo:", err.message);
            }
        }

        await client.logout();

        res.json({
            emails: emailsParaPanel
        });

    } catch (e) {

        try { await client.logout(); } catch {}

        console.log("ERROR SERVER:", e.message);

        res.status(500).json({
            error: "Server error"
        });

    }

});

app.listen(PORT, "0.0.0.0", () => {

    console.log("🚀 Detector Netflix activo");

});
