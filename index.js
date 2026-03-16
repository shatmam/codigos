const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

        return [];
    }
}

// ================= 1. WORKER: AUTOMATIZACIÓN DE WHATSAPP =================
async function tareaAutomaticaWhatsApp() {
    console.log("🔍 Revisando correos nuevos...");
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");

        const list = await client.search({ unseen: true, from: "netflix" });

        if (list.length > 0) {
            const todosLosClientes = await obtenerClientesSheets();

            for (let seq of list) {
                const msg = await client.fetchOne(seq, { source: true, envelope: true });
                const parsed = await simpleParser(msg.source);
                const textoLimpio = (parsed.text || "").toLowerCase();
                const htmlOriginal = parsed.html || parsed.textAsHtml || "";
                
                const nroPerfil = extraerPerfilSolicitante(textoLimpio);
                const linkMatch = htmlOriginal.match(/href="([^"]*update-home[^"]*)"/) || 
                                  htmlOriginal.match(/href="([^"]*confirm-account[^"]*)"/) ||
                                  htmlOriginal.match(/href="([^"]*netflix.com\/browse[^"]*)"/);
                
                const elLink = linkMatch ? linkMatch[1] : null;
                // Obtenemos el correo al que Netflix envió el mensaje
                let correoDestino = (parsed.to?.value?.[0]?.address || parsed.headers.get("delivered-to") || "").toLowerCase().trim();

                if (elLink) {
                    // FILTRADO MEJORADO
                    let clientesAMensajear = todosLosClientes.filter(f => {
                        const correoExcel = (f[4] || "").toLowerCase().trim();
                        const perfilExcel = (f[6] || "").toString().toLowerCase().replace(/[^0-9]/g, "").trim();
                        
                        // Si el correo no coincide, fuera.
                        if (correoExcel !== correoDestino) return false;

                        // Si el correo coincide y detectamos un número de perfil (1-5)
                        if (nroPerfil !== "") {
                            // Enviamos si el perfil coincide O si el cliente tiene la "Cuenta Completa"
                            return (perfilExcel === nroPerfil || (f[6] || "").toLowerCase().includes("completa"));
                        }
                        
                        // Si no detectamos perfil en el correo, le enviamos a todos los que compartan ese correo
                        return true;
                    });

                    if (clientesAMensajear.length > 0) {
                        for (let c of clientesAMensajear) {
                            const msj = `🏠 *ACTUALIZACIÓN NETFLIX*\n\nHola *${c[1]}*, pulsa el botón para activar tu TV:\n\n${elLink}`;
                            await enviarWA(c[2], msj);
                        }
                    } else {
                        // Solo si de verdad no hay nadie en el Excel con ese correo, va al Admin
                        console.log(`No se encontró cliente para: ${correoDestino}`);
                        await enviarWA(ADMIN_PHONE, `⚠️ *SIN COINCIDENCIA*\nEmail: ${correoDestino}\nPerfil: ${nroPerfil || "No detectado"}\nLink: ${elLink}`);
                    }
                }
                await client.messageFlagsAdd(seq, ['\\Seen']);
            }
        }
        await client.logout();
    } catch (e) {
        try { await client.logout(); } catch {}
    }
}

setInterval(tareaAutomaticaWhatsApp, 60000);

// ================= 2. API: SOLO PANEL =================
app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");
        const list = await client.search({ from: "netflix" });
        let emailsParaPanel = [];

        for (let seq of list.slice(-10).reverse()) {
            const msg = await client.fetchOne(seq, { source: true, envelope: true });
            const parsed = await simpleParser(msg.source);
            emailsParaPanel.push({
                subject: msg.envelope.subject,
                date: new Date(msg.envelope.date).toLocaleString("es-DO"),
                to: (parsed.to?.value?.[0]?.address || "").toLowerCase(),
                html: `<div style="background:white;color:black;padding:10px;">${parsed.html || parsed.textAsHtml}</div>`
            });
        }
        await client.logout();
        res.json({ emails: emailsParaPanel });
    } catch (e) {
        try { await client.logout(); } catch {}
        res.status(500).json({ error: "Error" });
    }
});

app.listen(PORT, "0.0.0.0", () => { console.log("🚀 Sistema Activo"); });
