const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// 🟢 LO QUE SÍ QUEREMOS VER
const PALABRAS_PERMITIDAS = ["código", "codigo", "temporal", "hogar", "viaje", "acceso"];

// 🔴 LO QUE QUEREMOS BLOQUEAR (Solo si NO es un código)
const PALABRAS_PROHIBIDAS = ["contraseña", "password", "correo", "email", "teléfono", "perfil", "factura", "pago"];

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
        await client.mailboxOpen('INBOX');
        
        let emails = [];
        let list = await client.search({ from: "netflix" });
        const ahora = new Date();

        // Revisamos los últimos 5 de Netflix
        for (let seq of list.slice(-5).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            // 1. Filtro de tiempo: máximo 15 minutos de antigüedad
            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                
                // 2. Lógica de filtrado inteligente:
                // Si dice "CÓDIGO", pasa directo (es lo que el cliente necesita).
                const esCodigo = PALABRAS_PERMITIDAS.some(p => subject.includes(p));
                
                // Si NO dice código y habla de cambios de cuenta, se bloquea.
                const esCambioDeCuenta = PALABRAS_PROHIBIDAS.some(p => subject.includes(p));

                if (esCodigo || !esCambioDeCuenta) {
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
        if (client) { try { await client.logout(); } catch(e) {} }
        res.status(500).json({ error: "Buscando..." });
    }
});

app.listen(PORT, '0.0.0.0', () => { console.log("✅ Panel Funcionando - Filtros Optimizados"); });
