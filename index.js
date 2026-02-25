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
        
        // BUSQUEDA DIRECTA: Buscamos correos de Netflix que tengan la palabra "código" o "temporal"
        // Esto es mucho más eficiente que filtrar uno por uno después
        let list = await client.search({
            from: "netflix",
            or: [
                { subject: 'código' },
                { subject: 'temporal' },
                { subject: 'hogar' }
            ]
        });

        // Tomamos los últimos 5 resultados encontrados
        for (let seq of list.slice(-5).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            // Filtro de seguridad rápido para NO mostrar inicios de sesión o cambios
            let subject = (msg.envelope.subject || "").toLowerCase();
            if (subject.includes("inicio") || subject.includes("contraseña") || subject.includes("cuenta")) {
                continue; 
            }

            let parsed = await simpleParser(msg.source);
            
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

        await client.logout();
        res.json({ emails });

    } catch (error) {
        console.error(error);
        if (client) await client.logout().catch(() => {});
        res.status(500).json({ error: "Error buscando correos" });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Buscador de rescate activo"); });
