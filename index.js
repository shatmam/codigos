const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// Palabras clave que SI queremos
const PERMITIDOS = ["hogar", "viaje", "temporal", "acceso", "código", "codigo"];
// Lo que BLOQUEAMOS (Inicios de sesión y cambios)
const PROHIBIDOS = ["inicio de ses", "iniciar ses", "cambio en tu cuenta", "restablecer", "reestablecer"];

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000, // Más tiempo para evitar crashes por lentitud
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');
        
        let emails = [];
        // Buscamos solo los últimos 8 correos de Netflix para no saturar la memoria
        let list = await client.search({ from: "netflix" });
        const ahora = new Date();

        for (let seq of list.slice(-8).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            // Filtro de tiempo: 15 minutos
            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                
                // Primero revisamos el asunto que es lo más rápido
                const esProhibidoAsunto = PROHIBIDOS.some(p => subject.includes(p));
                const esPermitidoAsunto = PERMITIDOS.some(p => subject.includes(p));

                if (!esProhibidoAsunto && esPermitidoAsunto) {
                    let parsed = await simpleParser(msg.source);
                    let contenido = (parsed.text || "").toLowerCase();

                    // Doble check en el contenido para estar seguros
                    const esBasuraCuerpo = PROHIBIDOS.some(p => contenido.includes(p));
                    
                    if (!esBasuraCuerpo) {
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
        }
        lock.release();
        await client.logout();
        res.json({ emails });

    } catch (error) {
        console.error("Error en IMAP:", error);
        if (client) { try { await client.logout(); } catch(e) {} }
        // Enviamos un JSON vacío en lugar de romper la app
        res.status(500).json({ emails: [], error: "Reintentando conexión..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("🚀 Panel Estable y Filtrado"); });
