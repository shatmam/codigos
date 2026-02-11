const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

/* ================= CONFIGURACIÓN ================= */
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

const PALABRAS_CLAVE = ["código", "hogar", "viaje", "temporal", "acceso", "confirmar", "iniciar"];
const PALABRAS_PROHIBIDAS = ["factura", "pago", "recibo", "actualizar tarjeta", "suscripción"];
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
        let list = await client.search({ from: "netflix" });
        
        // Revisamos los últimos 8 mensajes
        for (let seq of list.slice(-8).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            let subject = (msg.envelope.subject || "").toLowerCase();
            
            const tieneClave = PALABRAS_CLAVE.some(p => subject.includes(p));
            const esBasura = PALABRAS_PROHIBIDAS.some(p => subject.includes(p));

            if (tieneClave && !esBasura) {
                let parsed = await simpleParser(msg.source);
                
                // HORA DE REPÚBLICA DOMINICANA (GMT-4)
                const fechaRD = msg.envelope.date.toLocaleString('es-DO', {
                    timeZone: 'America/Santo_Domingo',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
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
        console.error(error);
        res.status(500).json({ error: "Reintenta en 10 segundos..." });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Panel listo - Hora RD Configurada`);
});
