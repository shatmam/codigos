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
        console.log(`✅ WhatsApp enviado al número: ${numero}`);
    } catch (e) { console.log("❌ Error enviando WA:", e.message); }
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
        
        // Cargar datos del Excel
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
                
                // 1. EXTRAER EL PERFIL (Cualquier número de pin o perfil 1-8)
                let perfilSolicitado = null;
                const matchSolicitud = textoLimpio.match(/solicitud de\s*(\d+)/i);
                if (matchSolicitud) {
                    perfilSolicitado = matchSolicitud[1].trim(); 
                }

                // 2. EXTRAER EL LINK
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                let correoCuenta = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                // 3. BUSCAR EN EXCEL (Filtro por Correo y Perfil sin comillas)
                let clienteDestino = todosLosClientes.find(f => {
                    const correoExcel = (f[4] || "").toLowerCase().trim();
                    // Limpiamos el perfil del Excel para comparar números puros
                    const perfilExcel = (f[6] || "").toString().replace(/[^0-9]/g, "").trim();
                    
                    return correoExcel === correoCuenta && perfilExcel === perfilSolicitado;
                });

                // 4. ENVÍO DE WHATSAPP
                if (elLink) {
                    const aviso = "\n\n*Nota:* Si no solicitaste este acceso, por favor ignora este mensaje.";
                    if (clienteDestino) {
                        const msj = `🏠 *NETFLIX HOGAR*\n\nHola *${clienteDestino[1]}*, activa tu TV pulsando el botón en este enlace:\n\n${elLink}${aviso}`;
                        await enviarWA(clienteDestino[2], msj);
                    } else {
                        // Si no hay match, enviarlo al Admin para no perder la venta
                        await enviarWA(ADMIN_PHONE, `⚠️ *REVISAR EXCEL*\nCuenta: ${correoCuenta}\nPerfil: ${perfilSolicitado || "Desconocido"}\nLink: ${elLink}`);
                    }
                }

                // 5. AGREGAR AL PANEL
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Correo Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoCuenta,
                    html: `
                        <div style="background: #111; color: #fff; padding: 10px; border-left: 5px solid #e50914;">
                            PERFIL SOLICITANTE: <b>${perfilSolicitado || "Desconocido"}</b>
                        </div>
                        <div style="background: white; color: black; padding: 10px; border: 1px solid #ddd;">
                            ${htmlOriginal}
                        </div>`
                });

            } catch (err) { console.log("Error procesando correo:", err.message); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Lector de Perfiles Dinámico Activo"); });
