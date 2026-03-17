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

// ================= API PANEL =================
app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");
        
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const spreadsheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Hoja1!A2:K500" });
            todosLosClientes = spreadsheet.data.values || [];
        } catch (e) { console.log("⚠️ Sheets error:", e.message); }

        // Buscamos solo los NO LEÍDOS para no repetir envíos constantes
        const list = await client.search({ unseen: true, from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-15).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "";
                
                const nroPerfil = extraerPerfilSolicitante(textoLimpio);
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                // MEJORA: Detectar el correo real de destino
                let correoDestino = (parsed.headers.get("delivered-to") || parsed.to?.value?.[0]?.address || "").toString().toLowerCase().trim();

                if (elLink) {
                    // FILTRADO ROBUSTO
                    let clientesAMensajear = todosLosClientes.filter(f => {
                        const correoExcel = (f[4] || "").toLowerCase().trim();
                        const perfilExcel = (f[6] || "").toString().replace(/[^0-9]/g, "").trim();
                        
                        // Si el correo no coincide, descartar
                        if (correoExcel !== correoDestino) return false;

                        // Si hay perfil en el correo, comparar. Si no, enviar a todos los de ese correo.
                        if (nroPerfil !== "") {
                            return (perfilExcel === nroPerfil || (f[6] || "").toLowerCase().includes("completa"));
                        }
                        return true;
                    });

                    if (clientesAMensajear.length > 0) {
                        for (let c of clientesAMensajear) {
                            const msj = `🏠 *ACTUALIZACIÓN NETFLIX*\n\nHola *${c[1]}*, pulsa el botón para activar tu TV:\n\n${elLink}`;
                            await enviarWA(c[2], msj);
                        }
                        // Marcamos como leído para que no se reenvíe al refrescar el panel
                        await client.messageFlagsAdd(seq, ['\\Seen']);
                    } else {
                        // SOLO envía al admin si de verdad NO existe el cliente en el Excel
                        console.log(`Log: No se encontró match para ${correoDestino}`);
                        // Opcional: comentar la siguiente línea para que no te llegue nada al admin
                        // await enviarWA(ADMIN_PHONE, `⚠️ SIN MATCH: ${correoDestino}`);
                    }
                }

                emailsParaPanel.push({
                    subject: msg.envelope.subject,
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoDestino,
                    html: `<div style="background:white;color:black;padding:10px;border:1px solid #ddd;">${htmlOriginal}</div>`
                });

            } catch (err) { console.log("Error seq:", seq); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Sistema Corregido"); });
