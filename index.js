const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const simpleParser = require('mailparser').simpleParser; // Necesitamos esto para limpiar el texto

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
        let list = await client.search({ from: "netflix" });
        
        // Revisamos los 3 más recientes
        for (let seq of list.slice(-3).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            // PROCESAMIENTO DEL CORREO (Para quitar el texto raro)
            let parsed = await simpleParser(msg.source);
            
            emails.push({
                subject: msg.envelope.subject,
                date: msg.envelope.date.toLocaleString('es-ES'),
                html: parsed.html || parsed.textAsHtml || "Contenido no disponible"
            });
        }

        await client.logout();
        res.json({ emails });

    } catch (error) {
        res.status(500).json({ error: "Error: " + error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("Panel funcionando con limpieza activa"); });
