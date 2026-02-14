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
        // ESTO ACELERA LA AUTENTICACIÓN:
        verifyOnly: false,
        maxConnections: 5,
        connectionTimeout: 3000, // Bajamos a 3 seg para que no se quede esperando
        greetingTimeout: 3000
    });

    try {
        await client.connect();
        
        // Seleccionamos la bandeja de entrada directamente
        let mailbox = await client.mailboxOpen('INBOX');
        
        // Solo pedimos los números de secuencia de los últimos 3 mensajes de Netflix
        // Esto evita que Gmail analice toda la cuenta
        let list = await client.search({ from: "netflix" });
        
        let emails = [];
        const ahora = new Date();

        // Tomamos solo los 3 más recientes
        for (let seq of list.slice(-3).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                
                // Filtro rápido de palabras clave
                if (["código", "hogar", "viaje", "temporal", "acceso"].some(p => subject.includes(p))) {
                    
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
        // En caso de error de autenticación, cerramos rápido para liberar el túnel
        if (client) { try { await client.logout(); } catch(e) {} }
        res.status(500).json({ error: "Buscando..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🔥 Autenticación Optimizada"); });
