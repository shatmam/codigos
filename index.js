const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');
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

// ================= FUNCIÓN WHATSAPP =================
async function enviarWA(tel, msj) {
    try {
        let numero = tel.toString().replace(/[^0-9]/g, "");
        // Asegurar formato dominicano/internacional
        if (!numero.startsWith("1")) numero = "1" + numero;
        
        const response = await fetch("https://www.wasenderapi.com/api/send-message", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${WA_TOKEN}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({ to: "+" + numero, text: msj })
        });
        
        if (response.ok) {
            console.log("✅ WA Enviado a:", numero);
        } else {
            console.log("⚠️ Error API WA:", response.statusText);
        }
    } catch (e) { 
        console.log("❌ Error fatal WA:", e.message); 
    }
}

// ================= API PANEL =================
app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false,
        tls: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');

        // --- CONEXIÓN A GOOGLE SHEETS (Pestaña: Clientes) ---
        let todosLosClientes = [];
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
                scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
            });
            const sheets = google.sheets({ version: "v4", auth });
            const spreadsheet = await sheets.spreadsheets.values.get({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: "Clientes!A2:K500" // Nombre exacto de tu pestaña
            });
            todosLosClientes = spreadsheet.data.values || [];
            console.log(`📊 Datos cargados: ${todosLosClientes.length} filas del Excel.`);
        } catch (e) { 
            console.log("⚠️ Error conectando a Sheets:", e.message); 
        }
        
        let emailsParaMostrar = [];
        let list = await client.search({ from: "netflix" });

        // Procesar los últimos 10 correos
        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let subject = (msg.envelope.subject || "").toLowerCase();
            let parsed = await simpleParser(msg.source);
            let contenido = (parsed.text || "").toLowerCase();
            let htmlOriginal = parsed.html || parsed.textAsHtml || "";

            // 🚫 FILTROS DE BLOQUEO (Tu lógica original)
            const esCorreoDeCambio = 
                subject.includes("cambio") || 
                subject.includes("cuenta") || 
                subject.includes("contraseña") || 
                subject.includes("password") ||
                subject.includes("sesión") ||
                contenido.includes("cambiar la información") ||
                contenido.includes("restablecer tu contraseña");

            // ✅ FILTROS DE PERMISO
            const esAccesoUtil = 
                subject.includes("código") || 
                subject.includes("codigo") || 
                subject.includes("temporal") || 
                subject.includes("hogar") || 
                subject.includes("viaje");

            if (esAccesoUtil && !esCorreoDeCambio) {
                const correoDestino = (msg.envelope.to[0].address || "").toLowerCase().trim();
                
                // Extraer el link de Netflix
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/) ||
                                  htmlOriginal.match(/href="([^"]*netflix.com\/browse[^"]*)"/);
                const elLink = linkMatch ? linkMatch[1] : null;

                // --- SI HAY LINK, BUSCAR CLIENTE EN EXCEL Y ENVIAR ---
                if (elLink) {
                    // Columna E es índice 4
                    let clientesMatch = todosLosClientes.filter(f => 
                        (f[4] || "").toLowerCase().trim() === correoDestino
                    );
                    
                    if (clientesMatch.length > 0) {
                        for (let c of clientesMatch) {
                            // Nombre Col B (1), Teléfono Col C (2)
                            const nombre = c[1] || "Cliente";
                            const telefono = c[2];
                            if (telefono) {
                                const msj = `🏠 *ACTUALIZACIÓN NETFLIX*\n\nHola *${nombre}*, pulsa el botón en el siguiente enlace para activar tu TV:\n\n${elLink}`;
                                await enviarWA(telefono, msj);
                            }
                        }
                    } else {
                        console.log(`❌ No se encontró el correo ${correoDestino} en la pestaña Clientes.`);
                    }
                }

                const fechaRD = new Date(msg.envelope.date).toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });

                emailsParaMostrar.push({
                    subject: msg.envelope.subject,
                    date: fechaRD,
                    to: correoDestino, 
                    html: htmlOriginal
                });
            }
        }

        await client.logout();
        res.json({ emails: emailsParaMostrar });

    } catch (error) {
        if (client) await client.logout().catch(() => {});
        console.log("Error General:", error.message);
        res.status(500).json({ error: "Error al cargar correos" });
    }
});

app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log("✅ Pestaña configurada: Clientes");
});
