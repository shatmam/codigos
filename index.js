const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ================= CONFIG =================
const EMAIL_USER = "digitalesservicios311@gmail.com";
const EMAIL_PASS = "rfbmuirunbfwcara";
const SPREADSHEET_ID = "1CtmcSFb2ScYXMAkK0EiKhmLJ1mwZRpGLTXZ8uXY-LRY";
const WA_TOKEN = "e8054f40611652ca1329c3a19e7250b4798095c7d0b9d2944b9f35a26b5dba78";
const ADMIN_PHONE = "18494736782";

// ================= WHATSAPP =================
async function enviarWA(tel, msj) {
    try {
        let numero = tel.toString().replace(/[^0-9]/g, "");
        if (!numero.startsWith("1")) numero = "1" + numero;
        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        console.log("✅ WA Enviado a:", numero);
    } catch (e) { console.log("❌ Error WA:", e.message); }
}

function extraerPerfilSolicitante(texto) {
    const match = texto.match(/(?:solicitud de|perfil|hola,?)\s*([1-5])/i) || texto.match(/\b([1-5])\b/);
    return match ? match[1] : "";
}

// ================= WORKER SEGURO =================
async function tareaAutomaticaWhatsApp() {
    console.log("--- INICIANDO REVISIÓN ---");
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");
        const list = await client.search({ unseen: true, from: "netflix" });

        if (list.length > 0) {
            // Obtener datos de Sheets
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const spreadsheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Hoja1!A2:K500" });
            const todosLosClientes = spreadsheet.data.values || [];

            for (let seq of list) {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                const html = parsed.html || parsed.textAsHtml || "";
                const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || html.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;
                const nroPerfil = extraerPerfilSolicitante(parsed.text.toLowerCase());
                const correoDestino = (parsed.to?.value?.[0]?.address || "").toLowerCase().trim();

                console.log(`📩 Correo de Netflix para: ${correoDestino} (Perfil detectado: ${nroPerfil})`);

                if (elLink) {
                    let encontrados = todosLosClientes.filter(f => {
                        const emailExcel = (f[4] || "").toLowerCase().trim();
                        return emailExcel === correoDestino;
                    });

                    console.log(`📊 Coincidencias de email en Excel: ${encontrados.length}`);

                    if (encontrados.length > 0) {
                        for (let c of encontrados) {
                            const perfilExcel = (c[6] || "").toString().replace(/[^0-9]/g, "");
                            // Solo enviamos si el perfil coincide o no se detectó perfil en el correo
                            if (nroPerfil === "" || perfilExcel === nroPerfil || (c[6] || "").toLowerCase().includes("completa")) {
                                await enviarWA(c[2], `🏠 *ACTUALIZACIÓN*\nLink: ${elLink}`);
                            }
                        }
                    } else {
                        console.log(`❌ NO EXISTE EL EMAIL ${correoDestino} EN TU EXCEL.`);
                    }
                }
                // Marcar como leído para que se detenga el bucle
                await client.messageFlagsAdd(seq, ['\\Seen']);
            }
        }
        await client.logout();
    } catch (e) {
        console.log("⚠️ ERROR:", e.message);
        try { await client.logout(); } catch {}
    }
}

// Lo ejecutamos manualmente o cada 2 minutos para pruebas
setInterval(tareaAutomaticaWhatsApp, 120000);

// API PANEL (SIN WHATSAPP)
app.get("/api/emails", async (req, res) => {
    // ... tu código anterior de la API está bien así ...
    res.json({ status: "Panel activo, revisa la consola para ver el worker" });
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor en modo DEBUG"); });
