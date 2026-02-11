const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// FILTROS: Solo entra si tiene estas palabras, y NO entra si tiene las prohibidas
const PALABRAS_CLAVE = ["código", "hogar", "viaje", "temporal", "acceso", "confirmar", "iniciar"];
const PALABRAS_PROHIBIDAS = ["factura", "pago", "recibo", "actualizar tarjeta", "suscripción"];

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
        
        for (let seq of list.slice(-8).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let subject = (msg.envelope.subject || "").toLowerCase();
            
            // Aplicar Filtros
            const tieneClave = PALABRAS_CLAVE.some(p => subject.includes(p));
            const esBasura = PALABRAS_PROHIBIDAS.some(p => subject.includes(p));

            if (tieneClave && !esBasura) {
                let parsed = await simpleParser(msg.source);
                emails.push({
                    subject: msg.envelope.subject,
                    date: msg.envelope.date.toLocaleString('es-ES'),
                    html: parsed.html || `<pre>${parsed.text}</pre>`
                });
            }
        }

        await client.logout();
        res.json({ emails });

    } catch (error) {
        res.status(500).json({ error: "Reintenta en 10 segundos..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("Servidor con filtros activos"); });
