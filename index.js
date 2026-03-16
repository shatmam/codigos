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
    } catch (e) { console.log("Error WA:", e.message); }
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
        
        // Obtener Clientes (Con Try/Catch para que si falla el Excel, el panel cargue igual)
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const spreadsheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Hoja1!A2:K500" });
            todosLosClientes = spreadsheet.data.values || [];
        } catch (e) { console.log("Error Sheets:", e.message); }

        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        // Procesar los últimos 10
        for (let seq of list.slice(-10).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "Sin contenido";
                
                // 1. Detectar Perfil (Solicitud de X, Perfil X, Hola X:)
                let perfilDetectado = "";
                const pMatch = textoLimpio.match(/(?:solicitud de|perfil)\s*(\d+)/i) || textoLimpio.match(/hola,?\s*(\d+):/i);
                if (pMatch) perfilDetectado = pMatch[1].trim();

                // 2. Detectar Código o Link
                const codMatch = textoLimpio.match(/\b\d{4,6}\b/);
                const codigo = (codMatch && codMatch[0] !== "2026") ? codMatch[0] : null;
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/);

                let correoDestino = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                // 3. Filtrar clientes
                let clientesAMensajear = todosLosClientes.filter(f => {
                    const correoExcel = (f[4] || "").toLowerCase().trim();
                    const perfilExcel = (f[6] || "").toString().toLowerCase().trim();
                    if (correoExcel !== correoDestino) return false;
                    // Si el correo especifica perfil, filtramos. Si no, enviamos a todos los de ese correo.
                    if (perfilDetectado && perfilExcel !== perfilDetectado && perfilExcel !== "completa") return false;
                    return true;
                });

                // 4. Enviar Notificaciones
                if (codigo || linkMatch) {
                    const info = codigo || linkMatch[1];
                    const aviso = "\n\n*Nota:* Si no solicitaste este código, por favor ignora este mensaje.";
                    
                    if (clientesAMensajear.length > 0) {
                        for (let c of clientesAMensajear) {
                            let msj = codigo ? `🍿 *NETFLIX*\n\nHola *${c[1]}*, tu código es: *${codigo}*${aviso}` : 
                                               `🏠 *NETFLIX HOGAR*\n\nHola *${c[1]}*, activa aquí:\n${info}${aviso}`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        await enviarWA(ADMIN_PHONE, `⚠️ *ADMIN*\nCorreo: ${correoDestino}\nPerfil: ${perfilDetectado || "S/P"}\nDatos: ${codigo || "Link"}`);
                    }
                }

                // 5. Preparar para el Panel (Aseguramos que 'html' siempre tenga datos)
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Correo Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoDestino,
                    html: `
                        <div style="background: #222; color: #fff; padding: 10px; border-left: 4px solid #e50914; margin-bottom: 10px; font-family: sans-serif;">
                            <b>PERFIL DETECTADO:</b> ${perfilDetectado || "General / Todos"}<br>
                            <b>ESTADO:</b> ${clientesAMensajear.length > 0 ? 'Enviado a clientes' : 'Enviado al Admin'}
                        </div>
                        <div style="background: white; color: black; padding: 10px; border: 1px solid #ccc;">
                            ${htmlOriginal}
                        </div>`
                });

            } catch (err) { console.log("Error procesando correo individual:", err.message); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        console.log("Error Crítico:", e.message);
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error en el servidor" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor activo y reparado"); });
