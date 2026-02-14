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

        // --- MEJORA DE VELOCIDAD AQUÍ ---
        // Buscamos solo correos de Netflix que llegaron HOY. 
        // Esto hace que Gmail responda 3 veces más rápido.
        let list = await client.search({ 
            from: "netflix",
            since: new Date() 
        });
        
        const ahora = new Date();

        // Solo procesamos los últimos 5 para no saturar la memoria de Railway
        for (let seq of list.slice(-5).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            // Filtro estricto de 15 minutos
            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                const tieneClave = PALABRAS_CLAVE.some(p => subject.includes(p));
                const esBasura = PALABRAS_PROHIBIDAS.some(p => subject.includes(p));

                if (tieneClave && !esBasura) {
                    let parsed = await simpleParser(msg.source);
                    
                    const fechaRD = fechaCorreo.toLocaleString('es-DO', {
                        timeZone: 'America/Santo_Domingo',
                        hour: '2-digit', minute: '2-digit', hour12: true
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
        console.error("Error de conexión:", error.message);
        res.status(500).json({ error: "Buscando código..." });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor optimizado en puerto ${PORT}`);
});
