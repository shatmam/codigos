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
        
        const response = await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        const resData = await response.json();
        console.log(`✅ Intento WA a ${numero}:`, resData.status || "Enviado");
    } catch (e) { console.log("❌ Error fatal WA:", e.message); }
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
        } catch (e) { console.log("⚠️ Error Sheets:", e.message); }

        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-15).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "";
                
                // 1. DETECCIÓN DEL PERFIL (Busca "Solicitud de X")
                let perfilSolicitado = "";
                const matchSolicitud = textoLimpio.match(/solicitud de\s*([1-5])/i);
                if (matchSolicitud) {
                    perfilSolicitado = matchSolicitud[1].trim();
                }

                // 2. EXTRAER LINK
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                let correoCuenta = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                // 3. BUSCAR EN EXCEL (Cruzar Correo + Perfil)
                let clienteDestino = todosLosClientes.find(f => {
                    const correoExcel = (f[4] || "").toLowerCase().trim();
                    // Extraemos solo el número del perfil en el Excel (Columna G)
                    const perfilExcel = (f[6] || "").toString().replace(/[^0-9]/g, "").trim();
                    return correoExcel === correoCuenta && perfilExcel === perfilSolicitado;
                });

                // 4. ENVÍO DE NOTIFICACIÓN
                if (elLink) {
                    const aviso = "\n\n*Nota:* Si no solicitaste este acceso, por favor ignora este mensaje.";
                    if (clienteDestino && clienteDestino[2]) {
                        const msj = `🏠 *NETFLIX HOGAR*\n\nHola *${clienteDestino[1]}*, pulsa el botón en el siguiente enlace para activar tu TV:\n\n${elLink}${aviso}`;
                        await enviarWA(clienteDestino[2], msj);
                    } else {
                        // Respaldo: Si no hay match, enviarlo al Admin
                        await enviarWA(ADMIN_PHONE, `⚠️ *AVISO ADMIN*\nCuenta: ${correoCuenta}\nPerfil detectado: ${perfilSolicitado || "No leído"}\nLink: ${elLink}`);
                    }
                }

                // 5. PANEL
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Correo Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoCuenta,
                    html: `
                        <div style="background: #f8f9fa; color: #333; padding: 10px; border-bottom: 2px solid #e50914;">
                            <b>Perfil detectado:</b> ${perfilSolicitado || "Desconocido"} | 
                            <b>Enviado a:</b> ${clienteDestino ? clienteDestino[1] : "ADMIN"}
                        </div>
                        <div style="background: white; color: black; padding: 10px;">
                            ${htmlOriginal}
                        </div>`
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

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Lector reparado y enviando WA"); });
