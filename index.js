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
// RECOMENDACIÓN: Mueve estos valores a variables de entorno (.env)
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
            headers: { 
                "Authorization": `Bearer ${WA_TOKEN}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        console.log("✅ WA Enviado a:", numero);
    } catch (e) { 
        console.log("❌ Error WA:", e.message); 
    }
}

// ================= DETECTOR DE PERFIL (1 al 5) =================
// Optimizado para detectar "Solicitud de 4" como en tu imagen
function extraerPerfilSolicitante(texto) {
    const match = texto.match(/solicitud de\s*([1-5])/i) || 
                  texto.match(/perfil\s*([1-5])/i) || 
                  texto.match(/\b([1-5])\b/);
    return match ? match[1] : "";
}

// ================= API PRINCIPAL DEL PANEL =================
app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", 
        port: 993, 
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");

        // 1. Obtener datos de Google Sheets
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const spreadsheet = await sheets.spreadsheets.values.get({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: "Hoja1!A2:K500" 
            });
            todosLosClientes = spreadsheet.data.values || [];
        } catch (e) { 
            console.log("⚠️ Error Sheets:", e.message); 
        }

        // 2. Buscar correos de Netflix
        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        // Revisamos los últimos 15 correos para tener margen
        for (let seq of list.slice(-15).reverse()) {
            try {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                
                const asunto = (msg.envelope.subject || "").toLowerCase();
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "";

                // --- FILTRO DE TIPO DE CORREO ---
                // Solo permitimos correos que traten sobre actualizar hogar o confirmar acceso
                const esEmailDeAcceso = asunto.includes("actualizar") || 
                                       asunto.includes("confirmar") || 
                                       asunto.includes("hogar") ||
                                       textoLimpio.includes("solicitud de");

                if (!esEmailDeAcceso) continue; 

                // 3. Extraer Perfil y Link
                const nroPerfil = extraerPerfilSolicitante(textoLimpio);
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                 htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/);
                
                const elLink = linkMatch ? linkMatch[1] : null;
                let correoDestino = (parsed.to?.value?.[0]?.address || 
                                     parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                // 4. Lógica de Envío Automático
                if (elLink) {
                    // Filtrar clientes que coincidan con Correo y Perfil
                    let clientesAMensajear = todosLosClientes.filter(f => {
                        const correoExcel = (f[4] || "").toLowerCase().trim();
                        const perfilExcel = (f[6] || "").toString().replace(/[^0-9]/g, "").trim();
                        
                        if (correoExcel !== correoDestino) return false;
                        
                        // Si detectamos perfil (1-5), enviamos a ese. 
                        // Si no detectamos perfil, enviamos a todos los que tengan ese correo.
                        if (nroPerfil !== "") {
                            return (perfilExcel === nroPerfil || (f[6] || "").toLowerCase().includes("completa"));
                        }
                        return true;
                    });

                    if (clientesAMensajear.length > 0) {
                        for (let c of clientesAMensajear) {
                            const msj = `🏠 *ACTUALIZACIÓN NETFLIX*\n\nHola *${c[1]}*, recibimos una solicitud para el *Perfil ${nroPerfil || "asignado"}*. Pulsa el botón para activar tu TV:\n\n${elLink}\n\n*Nota:* Si no lo solicitaste, ignora este mensaje.`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        // Si no hay match en el Excel, avisar al administrador
                        await enviarWA(ADMIN_PHONE, `⚠️ *SIN ASIGNAR*\nCuenta: ${correoDestino}\nPerfil: ${nroPerfil || "No detectado"}\nLink: ${elLink}`);
                    }
                }

                // 5. Estructura para mostrar en el Panel Web
                emailsParaPanel.push({
                    subject: msg.envelope.subject || "Correo Netflix",
                    date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                    to: correoDestino,
                    perfil: nroPerfil || "N/A",
                    html: `<div style="background: white; color: black; padding: 10px; border: 1px solid #ddd;">${htmlOriginal}</div>`
                });

            } catch (err) { 
                console.log("Error procesando mensaje individual:", err); 
            }
        }

        await client.logout();
        res.json({ emails: emailsParaPanel });

    } catch (e) {
        try { await client.logout(); } catch {}
        console.error("Error General:", e);
        res.status(500).json({ error: "Error de conexión" });
    }
});

app.listen(PORT, "0.0.0.0", () => { 
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`Filtros activos: Actualización de Hogar y Confirmación de Acceso.`);
});
