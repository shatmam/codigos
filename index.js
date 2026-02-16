const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "rfbmuirunbfwcara"; 

// 🟢 PALABRAS QUE SÍ QUEREMOS (Acceso)
const PERMITIDOS = ["hogar", "viaje", "temporal", "acceso", "iniciar"];

// 🔴 FRASES QUE MATAN EL CORREO (Cambios de seguridad)
const PROHIBIDOS_CUERPO = ["cambio en tu cuenta", "cambiar la información", "restablecer tu contraseña", "reestablecer"];

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com", port: 993, secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false, tls: { rejectUnauthorized: false },
        connectionTimeout: 5000
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
                let parsed = await simpleParser(msg.source);
                let contenido = (parsed.text || "").toLowerCase();

                // LOGICA NINJA:
                // 1. ¿Es un correo de cambio? (Buscamos frases de tus fotos)
                const esCambioConfig = PROHIBIDOS_CUERPO.some(frase => contenido.includes(frase) || subject.includes(frase));
                
                // 2. ¿Es un código de acceso legal?
                const esAccesoLegal = PERMITIDOS.some(p => subject.includes(p) || contenido.includes(p));

                // REGLA DE ORO: Si es un cambio de configuración, BLOQUEAR SIEMPRE.
                if (esCambioConfig) {
                    continue; // Salta este correo, no lo agregues a la lista
                }

                // Si no es cambio, y es acceso legal o tiene la palabra código, mostrar.
                if (subject.includes("código") || esAccesoLegal) {
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

app.listen(PORT, '0.0.0.0', () => { console.log("✅ Filtro Anti-Cambios Activado"); });
