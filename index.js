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
        if (!numero.startsWith("1")) numero = "1" + numero;
        
        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        console.log("✅ WA Enviado a:", numero);
    } catch (e) { console.log("❌ Error WA:", e.message); }
}

// ================= LECTOR DE CUERPO (EXTERNO) =================
function extraerPerfilSolicitante(texto) {
    // 1. Buscamos específicamente "Solicitud de X" como en tu imagen
    let match = texto.match(/solicitud de\s*([1-5])/i);
    if (match) return match[1];

    // 2. Si no, buscamos "Perfil X"
    match = texto.match(/perfil\s*([1-5])/i);
    if (match) return match[1];

    // 3. Si no, buscamos cualquier número del 1 al 5 que esté suelto
    match = texto.match(/\b([1-5])\b/);
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

        // --- LEER GOOGLE SHEETS ---
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const response = await sheets.spreadsheets.values.get({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: "Hoja1!A2:K500" 
            });
            todosLosClientes = response.data.values || [];
            console.log(`📊 Leídos ${todosLosClientes.length} clientes del Excel.`);
        } catch (e) { console.log("⚠️ Error Sheets:", e.message); }

        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-10).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const textoCuerpo = (parsed.text || "").toLowerCase();
                const htmlCuerpo = (parsed.html || "").toLowerCase();
                const asunto = (msg.envelope.subject || "").toLowerCase();

                // FILTRO: Solo correos de Hogar o Acceso
                if (!asunto.includes("hogar") && !asunto.includes("confirm") && !textoCuerpo.includes("solicitud")) continue;

                // 1. EXTRAER PERFIL DEL CUERPO (Prioridad 1)
                const nroPerfil = extraerPerfilSolicitante(textoCuerpo);
                
                // 2. EXTRAER LINK DEL HTML
                const linkMatch = htmlCuerpo.match(/href="([^"]*update-home[^"]*)"/) || 
                                 htmlCuerpo.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                // 3. CORREO DE LA CUENTA
                let correoCuenta = (parsed.to?.value?.[0]?.address || "").toLowerCase().trim();

                if (elLink) {
                    // --- BÚSQUEDA AGRESIVA EN EL EXCEL ---
                    let clientesEncontrados = todosLosClientes.filter(fila => {
                        const emailExcel = (fila[4] || "").toLowerCase().trim();
                        const perfilExcel = (fila[6] || "").toString().replace(/[^0-9]/g, "").trim();
                        
                        // Si el correo coincide
                        if (emailExcel === correoCuenta) {
                            // Si detectamos perfil en el email, debe coincidir con el del excel
                            if (nroPerfil !== "") {
                                return perfilExcel === nroPerfil || (fila[6] || "").toLowerCase().includes("completa");
                            }
                            // Si el email no dice perfil, mandamos a todos los de ese correo
                            return true;
                        }
                        return false;
                    });

                    if (clientesEncontrados.length > 0) {
                        for (let c of clientesEncontrados) {
                            const msj = `🏠 *NETFLIX: ACCESO DETECTADO*\n\nHola *${c[1]}*, detectamos una solicitud para tu *Perfil ${nroPerfil || "asignado"}*.\n\nPulsa aquí para activar:\n${elLink}\n\n_Si no lo pediste, ignora este mensaje._`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        // Solo si NO hay nadie en el excel para ese correo/perfil, va al admin
                        await enviarWA(ADMIN_PHONE, `⚠️ *SISTEMA:* No encontré al cliente en el Excel.\n\nCuenta: ${correoCuenta}\nPerfil: ${nroPerfil}\nLink: ${elLink}`);
                    }
                }

                emailsParaPanel.push({
                    subject: msg.envelope.subject,
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoCuenta,
                    perfil: nroPerfil || "Desconocido",
                    html: parsed.html || parsed.textAsHtml
                });

            } catch (err) { console.log("Error en mensaje:", err); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Servidor listo y leyendo perfiles."); });
