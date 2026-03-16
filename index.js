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
        
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
        });
        const sheets = google.sheets({ version: "v4", auth });
        const spreadsheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Hoja1!A2:K500" });
        const todosLosClientes = spreadsheet.data.values || [];

        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-12).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "";
                
                // 1. EXTRAER PERFIL (Busca "Solicitud de X")
                let nroPerfil = "";
                const pMatch = textoLimpio.match(/solicitud de\s*(\d+)/i);
                if (pMatch) nroPerfil = pMatch[1].trim();

                // 2. EXTRAER LINK
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                const correoCuenta = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                // 3. LOGICA DE ENVÍO
                if (elLink) {
                    // BUSCAR CLIENTE: Comparamos convirtiendo todo a String y quitando espacios
                    let cliente = todosLosClientes.find(f => {
                        const emailExcel = (f[4] || "").toLowerCase().trim();
                        const perfilExcel = (f[6] || "").toString().replace(/[^0-9]/g, "").trim();
                        return emailExcel === correoCuenta && perfilExcel === nroPerfil;
                    });

                    const aviso = "\n\n*Nota:* Si no solicitaste este acceso, por favor ignora este mensaje.";
                    
                    if (cliente && cliente[2]) {
                        // Enviar al cliente encontrado
                        const msj = `🏠 *NETFLIX HOGAR*\n\nHola *${cliente[1]}*, activa tu TV aquí:\n\n${elLink}${aviso}`;
                        await enviarWA(cliente[2], msj);
                    } else {
                        // Si no hay cliente exacto, enviarte a ti
                        const msjAdmin = `⚠️ *REVISAR EXCEL*\nCuenta: ${correoCuenta}\nPerfil: ${nroPerfil || "???"}\nLink: ${elLink}`;
                        await enviarWA(ADMIN_PHONE, msjAdmin);
                    }
                }

                // 4. PANEL
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoCuenta,
                    html: `<div><b>Perfil leído: ${nroPerfil || "S/P"}</b><br>${htmlOriginal}</div>`
                });

            } catch (err) { console.log("Error seq:", err.message); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).send("Error");
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor en línea"); });
