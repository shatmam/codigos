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
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5000,
        greetingTimeout: 5000
    });

    try {
        await client.connect();
        
        // FORZAR RE-LECTURA: Abrimos la caja de entrada en modo solo lectura pero forzando actualización
        await client.mailboxOpen('INBOX', { readOnly: true });
        
        let emails = [];
        
        // Buscamos solo los 3 más recientes de Netflix sin filtros de fecha pesados
        // Esto hace que Gmail responda lo que tiene "ahora mismo" en el tope
        let list = await client.search({ from: "netflix" });
        
        const ahora = new Date();

        for (let seq of list.slice(-3).reverse()) {
            // Usamos un fetch rápido solo para el sobre (header) primero
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            // Filtro de 15 minutos mantenido
            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                
                // Filtros de palabras clave
                if (subject.includes("código") || subject.includes("hogar") || subject.includes("temporal") || subject.includes("viaje") || subject.includes("acceso")) {
                    
                    let parsed = await simpleParser(msg.source);
                    
                    const fechaRD = fechaCorreo.toLocaleString('es-DO', {
                        timeZone: 'America/Santo_Domingo',
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                    });

                    emails.push({
                        subject: msg.envelope.subject,
                        date: fechaRD,
                        to: msg.envelope.to[0].address, 
                        html: parsed.html || `<pre>${parsed.text}</pre>`
                    });
                }
            }
        }

        await client.logout();
        res.json({ emails });

    } catch (error) {
        try { await client.logout(); } catch(e) {}
        res.status(500).json({ error: "Buscando..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("Panel RD: Sincronización Rápida"); });
