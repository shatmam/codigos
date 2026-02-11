const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; // MANTENEMOS LAS 16 LETRAS

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        },
        logger: false,
        // ESTO ES CLAVE: Configuramos el ID de cliente para que Google no sospeche
        clientInfo: {
            name: "Nodemailer",
            version: "1.0.0"
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        
        // Entramos solo a leer, sin bloquear la carpeta
        await client.mailboxOpen('INBOX', {readOnly: true});
        
        let emails = [];
        // Buscamos directamente correos de Netflix para no perder tiempo
        let list = await client.search({from: "netflix"});
        
        // Tomamos los últimos 3 correos encontrados
        for (let seq of list.slice(-3).reverse()) {
            let message = await client.fetchOne(seq, { source: true, envelope: true });
            emails.push({
                subject: message.envelope.subject,
                date: message.envelope.date.toLocaleString('es-ES'),
                html: message.source.toString()
            });
        }

        await client.logout();
        res.json({ emails });

    } catch (error) {
        console.error("LOG:", error);
        res.status(500).json({ error: "Fallo de acceso: " + error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor listo en puerto ${PORT}`);
});

