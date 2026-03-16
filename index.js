const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
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

// ================= FUNCIÓN WHATSAPP =================
async function enviarWA(tel, msj) {
    try {
        let numero = tel.toString().replace(/[^0-9]/g, "");
        // Si el número no tiene el código de país (1 para RD/USA), se lo ponemos
        if (numero.length === 10) numero = "1" + numero;
        
        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        console.log("✅ WA Enviado a:", numero);
    } catch (e) { console.log("❌ Error WA:", e.message); }
}

// ================= LECTOR DE PERFIL (SUPER AGRESIVO) =================
function extraerPerfilSolicitante(texto, html) {
    const contenidoCompleto = (texto + " " + html).toLowerCase();
    
    // 1. Buscar "Solicitud de X" o "Perfil X"
    const match = contenidoCompleto.match(/solicitud de\s*([1-7])/i) || 
                  contenidoCompleto.match(/perfil\s*([1-7])/i) ||
                  contenidoCompleto.match(/hola,?\s*([1-7])/i);
    
    return match ? match[1].trim() : "";
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

        // --- 1. LEER EXCEL (Basado en tu imagen) ---
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            // Leemos hasta la columna G (Perfil)
            const response = await sheets.spreadsheets.values.get({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: "Hoja1!A2:G500" 
            });
            todosLosClientes = response.data.values || [];
        } catch (e) { console.log("⚠️ Error Sheets:", e.message); }

        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-12).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const texto = (parsed.text || "");
                const html = (parsed.html || "");
                const asunto = (msg.envelope.subject || "").toLowerCase();

                // FILTRO ESTRICTO: Solo accesos y actualizaciones
                const esEmailValido = asunto.includes("actualizar") || 
                                     asunto.includes("confirmar") || 
                                     asunto.includes("hogar") || 
                                     texto.toLowerCase().includes("solicitud de");

                if (!esEmailValido) continue;

                // 2. Extraer Perfil y Link
                const nroPerfil = extraerPerfilSolicitante(texto, html);
                const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || 
                                 html.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                // 3. Correo enviado por Netflix (Delivered-To suele ser más exacto)
                let correoCuenta = (parsed.headers.get("delivered-to") || 
                                   parsed.to?.value?.[0]?.address || "").toLowerCase().trim();

                if (elLink) {
                    // --- 4. CRUCE CON TU HOJA REAL ---
                    let clientesEncontrados = todosLosClientes.filter(fila => {
                        const nombreExcel = (fila[1] || "").trim(); // Col B
                        const telExcel    = (fila[2] || "").trim(); // Col C
                        const emailExcel  = (fila[4] || "").toLowerCase().trim(); // Col E
                        const perfilExcel = (fila[6] || "").toString().trim(); // Col G

                        // Comparamos Correo
                        if (emailExcel === correoCuenta) {
                            // Si el correo trae perfil, comparamos perfil
                            if (nroPerfil !== "") {
                                return perfilExcel === nroPerfil;
                            }
                            // Si no hay perfil en el correo, enviamos a todos los de esa cuenta
                            return true;
                        }
                        return false;
                    });

                    if (clientesEncontrados.length > 0) {
                        for (let c of clientesEncontrados) {
                            const msj = `🏠 *NETFLIX: ACTUALIZACIÓN*\n\nHola *${c[1]}*, recibimos una solicitud para el *Perfil ${nroPerfil || c[6]}*.\n\nPulsa el botón para activar tu TV:\n${elLink}\n\n_Si no lo solicitaste, ignora este mensaje._`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        // Si no hay nadie, aviso al admin con detalles para que veas qué falló
                        await enviarWA(ADMIN_PHONE, `⚠️ *AVISO:* No encontré match.\nCuenta: ${correoCuenta}\nPerfil detectado: ${nroPerfil}\nLink: ${elLink}`);
                    }
                }

                emailsParaPanel.push({
                    subject: msg.envelope.subject,
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoCuenta,
                    perfil: nroPerfil || "Desconocido",
                    html: html
                });

            } catch (err) { console.log("Error procesando seq:", err); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor ajustado a tu Excel."); });
