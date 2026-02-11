const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser'); // Importación corregida

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

/* ================= CONFIGURACIÓN ================= */
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 
/* ================================================= */

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
        // Buscamos los últimos 5 correos de Netflix
        let list = await client.search({ from: "netflix" });
        
        for (let seq of list.slice(-5).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            // Aquí es donde ocurre la magia de limpieza
            let parsed = await simpleParser(msg.source);
            
            emails.push({
                subject: msg.envelope.subject,
                date: msg.envelope.date.toLocaleString('es-ES'),
                // Enviamos el HTML limpio, si no hay HTML enviamos el texto plano
                html: parsed.html || `<pre>${parsed.text}</pre>`
            });
        }

        await client.logout();
        res.json({ emails });

    } catch (error) {
        console.error("ERROR:", error.message);
        res.status(500).json({ error: "Reintenta en un momento: " + error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Panel listo y limpiando correos`);
});
