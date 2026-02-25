const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

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
        
        let emails = [];
        // Buscamos correos de netflix con palabras clave
        let list = await client.search({ from: "netflix" });

        // Revisamos los últimos 10 de Netflix
        for (let seq of list.slice(-10).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            let subject = (msg.envelope.subject || "").toLowerCase();
            let parsed = await simpleParser(msg.source);
            let contenido = (parsed.text || "").toLowerCase();

            // 🚫 FILTRO DE BLOQUEO (Si dice algo de esto, NO PASA)
            const esCorreoDeCambio = 
                subject.includes("cambio") || 
                subject.includes("cuenta") || 
                subject.includes("contraseña") || 
                subject.includes("password") ||
                subject.includes("sesión") ||
                contenido.includes("cambiar la información") ||
                contenido.includes("restablecer tu contraseña");

            // ✅ FILTRO DE PERMISO (Solo si es algo de acceso)
            const esAccesoUtil = 
                subject.includes("código") || 
                subject.includes("codigo") || 
                subject.includes("temporal") || 
                subject.includes("hogar") || 
                subject.includes("viaje");

            // REGLA: Tiene que ser de acceso Y NO ser de cambio
            if (esAccesoUtil && !esCorreoDeCambio) {
                const fechaRD = new Date(msg.envelope.date).toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });

                emails.push({
                    subject: msg.envelope.subject,
                    date: fechaRD,
                    to: msg.envelope.to[0].address, 
                    html: parsed.html || `<pre>${parsed.text}</pre>`
                });
            }
        }

        await client.logout();
        res.json({ emails });

    } catch (error) {
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: "Reintentando..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Panel Blindado y Funcionando"); });
