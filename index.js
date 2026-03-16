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
        const phone = "+" + numero;

        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: phone, text: msj })
        });
        console.log("✅ WA Enviado a:", phone);
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

        for (let seq of list.slice(-10).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "Sin contenido";
                
                // 1. Detectar Perfil (Solicitud de X, Perfil X, o Hola X:)
                let perfilDetectado = "";
                const pMatch = textoLimpio.match(/(?:solicitud de|perfil)\s*(\d+)/i) || textoLimpio.match(/hola,?\s*(\d+):/i);
                if (pMatch) perfilDetectado = pMatch[1].trim();

                // 2. Detectar Código o Link
                const codMatch = textoLimpio.match(/\b\d{4,6}\b/);
                const codigo = (codMatch && codMatch[0] !== "2026") ? codMatch[0] : null;
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/) ||
                                  htmlOriginal.match(/href="([^"]*netflix.com\/browse[^"]*)"/);

                let correoDestino = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                // 3. Filtrar clientes por correo y perfil
                // Si hay un perfil específico (1-5), buscamos ese. Si no, a todos los del correo.
                let clientesAMensajear = todosLosClientes.filter(f => {
                    const correoExcel = (f[4] || "").toLowerCase().trim();
                    const perfilExcel = (f[6] || "").toString().toLowerCase().trim();
                    
                    if (correoExcel !== correoDestino) return false;
                    if (perfilDetectado && perfilExcel !== perfilDetectado && perfilExcel !== "completa") return false;
                    return true;
                });

                // 4. Enviar Notificaciones
                if (codigo || linkMatch) {
                    const contenido = codigo || linkMatch[1];
                    const avisoSeguridad = "\n\n*Nota:* Si no solicitaste este código, por favor ignora este mensaje.";

                    if (clientesAMensajear.length > 0) {
                        for (let c of clientesAMensajear) {
                            let mensaje = codigo ? 
                                `🍿 *NETFLIX*\n\nHola *${c[1]}*, tu código es: *${codigo}*${avisoSeguridad}` :
                                `🏠 *NETFLIX HOGAR*\n\nHola *${c[1]}*, activa tu TV aquí:\n${contenido}${avisoSeguridad}`;
                            await enviarWA(c[2], mensaje);
                        }
                    } else {
                        await enviarWA(ADMIN_PHONE, `⚠️ *ADMIN*\nCorreo: ${correoDestino}\nPerfil: ${perfilDetectado || "S/P"}\nDatos: ${codigo || "Link"}`);
                    }
                }

                // 5. Agregar al Panel
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Correo Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoDestino,
                    html: `
                        <div style="background: #222; color: #fff; padding: 10px; border-left: 4px solid #e50914; margin-bottom: 10px;">
                            <b>PERFIL DETECTADO:</b> ${perfilDetectado || "General/Todos"}<br>
                            <b>DESTINATARIOS:</b> ${clientesAMensajear.length || "Solo Admin"}
                        </div>
                        <div style="background: white; color: black; padding: 10px; border: 1px solid #ccc;">
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

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Sistema listo en puerto", PORT); });
