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
        if (numero.length === 10) numero = "1" + numero;
        
        await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        console.log("✅ WA Enviado a:", numero);
    } catch (e) { console.log("❌ Error WA:", e.message); }
}

// ================= LECTOR DE PERFIL (SOLO NÚMEROS) =================
function extraerPerfilSolicitante(texto, html) {
    const todo = (texto + " " + html).toLowerCase();
    // Busca "solicitud de 4", "perfil 4", o simplemente el número después de un saludo
    const match = todo.match(/solicitud de\s*([1-5])/i) || todo.match(/perfil\s*([1-5])/i);
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

        // 1. LEER EXCEL (Columnas: B=Nombre, C=Tel, E=Correo, G=Perfil)
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const response = await sheets.spreadsheets.values.get({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: "Hoja1!A2:G500" 
            });
            todosLosClientes = response.data.values || [];
        } catch (e) { console.log("⚠️ Error Sheets:", e.message); }

        // 2. BUSCAR CORREOS (Sin filtros raros, solo que sea de Netflix)
        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-10).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const texto = (parsed.text || "");
                const html = (parsed.html || "");
                
                // Extraer Perfil y Link
                const nroPerfil = extraerPerfilSolicitante(texto, html);
                const linkMatch = html.match(/href="([^"]*update-home[^"]*)"/) || 
                                 html.match(/href="([^"]*confirm-account[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                // Correo al que llegó el mensaje
                let correoCuenta = (parsed.headers.get("delivered-to") || 
                                   parsed.to?.value?.[0]?.address || "").toLowerCase().trim();

                if (elLink) {
                    // 3. BUSCAR EN TU HOJA (Basado en la foto que enviaste)
                    let clientesMatch = todosLosClientes.filter(f => {
                        const excelCorreo = (f[4] || "").toLowerCase().trim();
                        const excelPerfil = (f[6] || "").toString().trim();
                        
                        // Si el correo coincide
                        if (excelCorreo === correoCuenta) {
                            // Si el email trae un perfil (1-5), tiene que ser igual al del excel
                            if (nroPerfil !== "") {
                                return excelPerfil === nroPerfil;
                            }
                            return true; // Si el email no dice qué perfil es, se lo manda a todos los de ese correo
                        }
                        return false;
                    });

                    if (clientesMatch.length > 0) {
                        for (let c of clientesMatch) {
                            const msj = `🏠 *NETFLIX*\n\nHola *${c[1]}*, aquí tienes tu acceso para el *Perfil ${nroPerfil || c[6]}*:\n\n${elLink}`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        // Si no hay nadie en el excel, te avisa a ti
                        await enviarWA(ADMIN_PHONE, `⚠️ *SIN REGISTRO*\nCuenta: ${correoCuenta}\nPerfil: ${nroPerfil}\nLink: ${elLink}`);
                    }
                }

                // Guardar para mostrar en el panel
                emailsParaPanel.push({
                    subject: msg.envelope.subject,
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoCuenta,
                    perfil: nroPerfil || "N/A",
                    html: html
                });

            } catch (err) { console.log("Error en seq:", err); }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error de conexión" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Sistema funcionando con tu hoja de Clientes."); });
