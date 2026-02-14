const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// FILTROS MANTENIDOS
const PALABRAS_CLAVE = ["código", "hogar", "viaje", "temporal", "acceso", "confirmar", "iniciar"];
const PALABRAS_PROHIBIDAS = ["factura", "pago", "recibo", "actualizar tarjeta", "suscripción"];

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5000, // No espera más de 5 seg para conectar
        greetingTimeout: 5000
    });

    try {
        await client.connect();
        await client.mailboxOpen('INBOX');
        
        let emails = [];
        // Buscamos los más recientes de Netflix
        let list = await client.search({ from: "netflix" });
        const ahora = new Date();

        // Procesamos solo los 4 más recientes para máxima velocidad
        for (let seq of list.slice(-4).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            // 1. FILTRO DE TIEMPO (15 MINUTOS)
            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                
                // 2. FILTROS DE CONTENIDO (PALABRAS CLAVE Y PROHIBIDAS)
                const tieneClave = PALABRAS_CLAVE.some(p => subject.includes(p));
                const esBasura = PALABRAS_PROHIBIDAS.some(p => subject.includes(p));

                if (tieneClave && !esBasura) {
                    let parsed = await simpleParser(msg.source);
                    
                    // 3. HORA DE REPÚBLICA DOMINICANA
                    const fechaRD = fechaCorreo.toLocaleString('es-DO', {
                        timeZone: 'America/Santo_Domingo',
                        hour: '2-digit', minute: '2-digit', hour12: true
                    });

                    emails.push({
                        subject: msg.envelope.subject,
                        date: fechaRD,
                        to: msg.envelope.to[0].address, // MUESTRA LA CUENTA
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

app.listen(PORT, '0.0.0.0', () => { console.log("🔥 Panel RD: Filtros + Velocidad OK"); });
