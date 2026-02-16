const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// 🟢 PALABRAS PERMITIDAS (Solo lo que sirve para entrar)
const PALABRAS_CLAVE = ["código", "hogar", "viaje", "temporal", "acceso", "confirmar", "iniciar"];

// 🔴 FILTRO DE SEGURIDAD (Si el correo tiene alguna de estas, SE BLOQUEA)
const PALABRAS_PROHIBIDAS = [
    "factura", "pago", "recibo", "actualizar tarjeta", "suscripción", 
    "cambio de contraseña", "cambio de correo", "actualizada", "modificada", 
    "teléfono", "restablecer", "reestablecer", "solicitud", "perfil", "miembro",
    "información de tu cuenta", "cambio en tu cuenta", "cambio de información" // <--- NUEVAS FRASES CRÍTICAS
];

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

        for (let seq of list.slice(-5).reverse()) {
            let msg = await client.fetchOne(seq, { source: true, envelope: true });
            const fechaCorreo = new Date(msg.envelope.date);
            const diferenciaMinutos = (ahora - fechaCorreo) / (1000 * 60);

            if (diferenciaMinutos <= 15) { 
                let subject = (msg.envelope.subject || "").toLowerCase();
                
                // Extraer también el texto del cuerpo para buscar palabras prohibidas ahí dentro
                let parsed = await simpleParser(msg.source);
                let cuerpoTexto = (parsed.text || "").toLowerCase();
                
                // 1. Verificar si tiene palabras clave en el ASUNTO
                const tieneClave = PALABRAS_CLAVE.some(p => subject.includes(p));
                
                // 2. Verificar si es BASURA (Buscamos en el ASUNTO y en el CUERPO del correo)
                const esBasura = PALABRAS_PROHIBIDAS.some(p => 
                    subject.includes(p) || cuerpoTexto.includes(p)
                );

                // Solo permitimos si tiene la clave Y NO ES BASURA
                if (tieneClave && !esBasura) {
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

app.listen(PORT, '0.0.0.0', () => { console.log("🔥 Panel Blindado: Filtro de seguridad nivel máximo"); });
